import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { basename } from "path";
import { randomUUID } from "crypto";
import type { FinanceDB } from "../db/database.js";
import { parseCSV } from "../import/parser.js";
import { detectInstitution, INSTITUTION_MAPPINGS } from "../import/mappings.js";
import { normalizeTransaction, generateFingerprint } from "../import/normalizer.js";
import type { ImportConfig } from "../import/types.js";

export function registerImportTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "import_csv",
    "Import transactions from a CSV file. Auto-detects institution format (Chase, BoA, Schwab, Fidelity, Vanguard, Amex, Discover, Apple Card, Capital One, Citi, Wells Fargo, USAA). Falls back to manual column mapping for unknown formats.",
    {
      file_path: z.string().describe("Absolute path to the CSV file"),
      account_id: z.number().describe("Account ID to import into"),
      institution: z
        .string()
        .optional()
        .describe(
          "Force institution format instead of auto-detect. One of: chase, chase_credit, bank_of_america, amex, discover, schwab_checking, schwab_brokerage, fidelity, vanguard, apple_card, capital_one, citi, wells_fargo, usaa"
        ),
      column_mapping: z
        .object({
          date: z.string(),
          description: z.string(),
          amount: z.string().optional(),
          debit: z.string().optional(),
          credit: z.string().optional(),
          category: z.string().optional(),
        })
        .optional()
        .describe("Manual column mapping for unknown CSV formats"),
      invert_amount: z
        .boolean()
        .optional()
        .describe("Set true if positive amounts are charges (like Amex/Discover)"),
    },
    async ({ file_path, account_id, institution, column_mapping, invert_amount }) => {
      const account = db.getAccount(account_id);
      if (!account) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Account not found", account_id }) }] };
      }

      let content: string;
      try {
        content = readFileSync(file_path, "utf-8");
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read file: ${file_path}` }) }],
        };
      }

      const { headers, rows } = parseCSV(content);
      if (rows.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No data rows found in CSV", headers }) }],
        };
      }

      // Determine mapping
      let config: ImportConfig | null = null;

      if (column_mapping) {
        config = {
          institution: "custom",
          columns: column_mapping as ImportConfig["columns"],
          invertAmount: invert_amount,
        };
      } else if (institution) {
        config = INSTITUTION_MAPPINGS.find((m) => m.institution === institution) ?? null;
      } else {
        config = detectInstitution(headers);
      }

      if (!config) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Could not auto-detect CSV format",
                headers,
                hint: "Provide institution name or column_mapping parameter. Available institutions: " +
                  INSTITUTION_MAPPINGS.map((m) => m.institution).join(", "),
                sample_row: rows[0],
              }),
            },
          ],
        };
      }

      const batchId = randomUUID().slice(0, 8);
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      let dateMin = "9999";
      let dateMax = "0000";

      for (let i = 0; i < rows.length; i++) {
        const normalized = normalizeTransaction(rows[i], config);
        if (!normalized) {
          errors.push(`Row ${i + 1}: could not parse`);
          continue;
        }

        const fingerprint = generateFingerprint(
          account_id,
          normalized.date,
          normalized.description,
          normalized.amount
        );

        // Look up institution category
        let categoryId: number | undefined;
        if (normalized.category) {
          const cat = db.getCategoryByPath(normalized.category);
          if (cat) categoryId = cat.id;
        }

        const result = db.insertTransaction({
          account_id,
          date: normalized.date,
          description: normalized.description,
          amount: normalized.amount,
          category_id: categoryId,
          fingerprint,
          institution_category: normalized.category,
          check_number: normalized.check_number,
          batch_id: batchId,
        });

        if (result.action === "inserted") {
          imported++;
          if (normalized.date < dateMin) dateMin = normalized.date;
          if (normalized.date > dateMax) dateMax = normalized.date;
        } else {
          skipped++;
        }

        // Record balance if available
        if (normalized.balance) {
          const bal = parseFloat(normalized.balance.replace(/[$,]/g, ""));
          if (!isNaN(bal)) {
            db.recordBalance(account_id, bal, normalized.date);
          }
        }
      }

      // Auto-categorize new transactions
      const catResult = db.applyCategorization();

      // Log import
      db.logImport({
        batch_id: batchId,
        filename: basename(file_path),
        institution: config.institution,
        account_id,
        rows_imported: imported,
        rows_skipped: skipped,
        rows_errored: errors.length,
        date_range_start: dateMin !== "9999" ? dateMin : undefined,
        date_range_end: dateMax !== "0000" ? dateMax : undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                batch_id: batchId,
                institution: config.institution,
                account: account.name,
                imported,
                skipped,
                errors: errors.length,
                error_details: errors.slice(0, 10),
                date_range: dateMin !== "9999" ? { start: dateMin, end: dateMax } : null,
                auto_categorized: catResult.updated,
                rules_applied: catResult.rules_applied,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "manage_accounts",
    "Create, list, or update financial accounts (checking, savings, credit card, brokerage, 401k, IRA, HSA, loan, mortgage)",
    {
      action: z.enum(["create", "list", "update"]).describe("Action to perform"),
      name: z.string().optional().describe("Account name (required for create)"),
      institution: z.string().optional().describe("Institution name (e.g., Chase, Schwab)"),
      type: z
        .enum([
          "checking", "savings", "credit_card", "brokerage",
          "401k", "ira", "roth_ira", "hsa", "loan", "mortgage", "other",
        ])
        .optional()
        .describe("Account type (required for create)"),
      is_asset: z.boolean().optional().describe("Is this an asset? (default true, false for credit cards/loans)"),
      is_investment: z.boolean().optional().describe("Is this an investment account?"),
      account_id: z.number().optional().describe("Account ID (required for update)"),
      updates: z
        .record(z.unknown())
        .optional()
        .describe("Fields to update (for update action)"),
      balance: z.number().optional().describe("Current balance to record"),
      balance_date: z.string().optional().describe("Date for balance snapshot (defaults to today)"),
    },
    async ({ action, name, institution, type, is_asset, is_investment, account_id, updates, balance, balance_date }) => {
      if (action === "list") {
        const accounts = db.listAccounts();
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ accounts }, null, 2) }],
        };
      }

      if (action === "create") {
        if (!name || !type) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "name and type are required for create" }) }],
          };
        }

        // Auto-set is_asset based on type
        const autoIsAsset = is_asset !== undefined
          ? is_asset
          : !["credit_card", "loan", "mortgage"].includes(type);

        const autoIsInvestment = is_investment !== undefined
          ? is_investment
          : ["brokerage", "401k", "ira", "roth_ira"].includes(type);

        const id = db.createAccount({
          name,
          institution,
          type,
          is_asset: autoIsAsset,
          is_investment: autoIsInvestment,
        });

        if (balance !== undefined) {
          db.recordBalance(id, balance, balance_date || new Date().toISOString().slice(0, 10));
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ created: { id, name, type, institution, is_asset: autoIsAsset, is_investment: autoIsInvestment } }, null, 2),
            },
          ],
        };
      }

      if (action === "update") {
        if (!account_id) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "account_id required for update" }) }],
          };
        }
        if (updates) {
          db.updateAccount(account_id, updates);
        }
        if (balance !== undefined) {
          db.recordBalance(account_id, balance, balance_date || new Date().toISOString().slice(0, 10));
        }
        const updated = db.getAccount(account_id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ updated }, null, 2) }],
        };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown action" }) }] };
    }
  );

  server.tool(
    "import_holdings",
    "Import investment holdings (positions) from CSV or manual entry. Snapshots positions for an account as of a given date.",
    {
      account_id: z.number().describe("Investment account ID"),
      as_of: z.string().describe("Date these holdings are as-of (YYYY-MM-DD)"),
      file_path: z.string().optional().describe("Path to holdings CSV (columns: Symbol, Name/Description, Shares/Quantity, Cost Basis, Current Value/Market Value)"),
      holdings: z
        .array(
          z.object({
            symbol: z.string(),
            name: z.string().optional(),
            shares: z.number(),
            cost_basis: z.number().optional(),
            current_value: z.number().optional(),
            asset_class: z
              .enum(["us_stock", "intl_stock", "bond", "real_estate", "cash", "crypto", "commodity", "other"])
              .optional(),
          })
        )
        .optional()
        .describe("Manual holdings array"),
    },
    async ({ account_id, as_of, file_path, holdings: manualHoldings }) => {
      const account = db.getAccount(account_id);
      if (!account) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Account not found" }) }] };
      }

      let holdingsToImport: {
        symbol: string;
        name?: string;
        shares: number;
        cost_basis?: number;
        current_value?: number;
        asset_class?: string;
      }[] = [];

      if (manualHoldings) {
        holdingsToImport = manualHoldings;
      } else if (file_path) {
        let content: string;
        try {
          content = readFileSync(file_path, "utf-8");
        } catch {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot read file: ${file_path}` }) }] };
        }

        const { headers, rows } = parseCSV(content);

        // Try to auto-detect columns
        const symbolCol = headers.find((h) => /symbol|ticker/i.test(h));
        const nameCol = headers.find((h) => /^(name|description|security)/i.test(h));
        const sharesCol = headers.find((h) => /shares|quantity|qty/i.test(h));
        const costCol = headers.find((h) => /cost.?basis|book.?value/i.test(h));
        const valueCol = headers.find((h) => /current.?value|market.?value|value/i.test(h));

        if (!symbolCol) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Could not detect Symbol column",
                  headers,
                  sample_row: rows[0],
                }),
              },
            ],
          };
        }

        for (const row of rows) {
          const symbol = row[symbolCol]?.trim();
          if (!symbol) continue;

          const cleanNum = (val: string | undefined) => {
            if (!val) return undefined;
            const n = parseFloat(val.replace(/[$,%\s"]/g, ""));
            return isNaN(n) ? undefined : n;
          };

          holdingsToImport.push({
            symbol,
            name: nameCol ? row[nameCol]?.trim() : undefined,
            shares: cleanNum(sharesCol ? row[sharesCol] : undefined) ?? 0,
            cost_basis: cleanNum(costCol ? row[costCol] : undefined),
            current_value: cleanNum(valueCol ? row[valueCol] : undefined),
          });
        }
      } else {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Provide file_path or holdings array" }) }],
        };
      }

      const count = db.upsertHoldings(account_id, as_of, holdingsToImport);
      const totalValue = holdingsToImport.reduce((sum, h) => sum + (h.current_value ?? 0), 0);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                account: account.name,
                as_of,
                positions_imported: count,
                total_value: Math.round(totalValue * 100) / 100,
                holdings: holdingsToImport.map((h) => ({
                  symbol: h.symbol,
                  shares: h.shares,
                  value: h.current_value,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
