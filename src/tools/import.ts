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
import { importAggregatorCSV } from "../import/aggregator.js";
import { classifyAsset } from "../import/asset-classes.js";
import { importHoldingsCSV } from "../import/holdings-csv.js";
import { jsonResponse, errorResponse } from "../utils/response.js";

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
    { idempotentHint: true, openWorldHint: false },
    async ({ file_path, account_id, institution, column_mapping, invert_amount }) => {
      const account = db.getAccount(account_id);
      if (!account) {
        return errorResponse("Account not found", { account_id });
      }

      let content: string;
      try {
        content = readFileSync(file_path, "utf-8");
      } catch (e) {
        return errorResponse(`Cannot read file: ${file_path}`);
      }

      const { headers, rows } = parseCSV(content);
      if (rows.length === 0) {
        return errorResponse("No data rows found in CSV", { headers });
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
        return errorResponse("Could not auto-detect CSV format", {
          headers,
          hint: "Provide institution name or column_mapping parameter. Available institutions: " +
            INSTITUTION_MAPPINGS.map((m) => m.institution).join(", "),
          sample_row: rows[0],
        });
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
          merchant: normalized.merchant,
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

      return jsonResponse({
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
      });
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
    { openWorldHint: false },
    async ({ action, name, institution, type, is_asset, is_investment, account_id, updates, balance, balance_date }) => {
      if (action === "list") {
        const accounts = db.listAccounts();
        return jsonResponse({ accounts });
      }

      if (action === "create") {
        if (!name || !type) {
          return errorResponse("name and type are required for create");
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

        return jsonResponse({ created: { id, name, type, institution, is_asset: autoIsAsset, is_investment: autoIsInvestment } });
      }

      if (action === "update") {
        if (!account_id) {
          return errorResponse("account_id required for update");
        }
        if (updates) {
          db.updateAccount(account_id, updates);
        }
        if (balance !== undefined) {
          db.recordBalance(account_id, balance, balance_date || new Date().toISOString().slice(0, 10));
        }
        const updated = db.getAccount(account_id);
        return jsonResponse({ updated });
      }

      return errorResponse("Unknown action");
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
    { idempotentHint: true, openWorldHint: false },
    async ({ account_id, as_of, file_path, holdings: manualHoldings }) => {
      const account = db.getAccount(account_id);
      if (!account) {
        return errorResponse("Account not found");
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
          return errorResponse(`Cannot read file: ${file_path}`);
        }

        const { headers, rows } = parseCSV(content);

        // Try to auto-detect columns
        const symbolCol = headers.find((h) => /symbol|ticker/i.test(h));
        const nameCol = headers.find((h) => /^(name|description|security)/i.test(h));
        const sharesCol = headers.find((h) => /shares|quantity|qty/i.test(h));
        const costCol = headers.find((h) => /cost.?basis|book.?value/i.test(h));
        const valueCol = headers.find((h) => /current.?value|market.?value|value/i.test(h));

        if (!symbolCol) {
          return errorResponse("Could not detect Symbol column", {
            headers,
            sample_row: rows[0],
          });
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
        return errorResponse("Provide file_path or holdings array");
      }

      // Auto-classify asset classes
      const unclassified: string[] = [];
      for (const h of holdingsToImport) {
        if (!h.asset_class) {
          const detected = classifyAsset(h.symbol, h.name);
          if (detected) {
            h.asset_class = detected;
          } else {
            unclassified.push(h.symbol);
          }
        }
      }

      const count = db.upsertHoldings(account_id, as_of, holdingsToImport);
      const totalValue = holdingsToImport.reduce((sum, h) => sum + (h.current_value ?? 0), 0);

      // Build allocation summary
      const allocationMap: Record<string, number> = {};
      for (const h of holdingsToImport) {
        const cls = h.asset_class ?? "other";
        allocationMap[cls] = (allocationMap[cls] ?? 0) + (h.current_value ?? 0);
      }
      const allocation_summary = Object.entries(allocationMap)
        .map(([asset_class, value]) => ({
          asset_class,
          value: Math.round(value * 100) / 100,
          pct: totalValue > 0 ? Math.round((value / totalValue) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.value - a.value);

      return jsonResponse({
        account: account.name,
        as_of,
        positions_imported: count,
        total_value: Math.round(totalValue * 100) / 100,
        holdings: holdingsToImport.map((h) => ({
          symbol: h.symbol,
          shares: h.shares,
          value: h.current_value,
          asset_class: h.asset_class ?? "other",
        })),
        allocation_summary,
        unclassified: unclassified.length > 0 ? unclassified : undefined,
      });
    }
  );

  server.tool(
    "record_balances",
    "Record current balances for multiple accounts at once. Creates balance snapshots used by net_worth_history, get_balances, and balance_sheet.",
    {
      balances: z
        .array(
          z.object({
            account_id: z.number().optional().describe("Account ID"),
            account_name: z.string().optional().describe("Account name (alternative to account_id)"),
            balance: z.number().describe("Current balance (positive for assets, negative for liabilities)"),
            date: z.string().optional().describe("Snapshot date (defaults to today)"),
          })
        )
        .describe("Array of account balances to record"),
    },
    { idempotentHint: true, openWorldHint: false },
    async ({ balances }) => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const results: { account: string; balance: number; date: string }[] = [];
      const notFound: string[] = [];

      for (const entry of balances) {
        let account: Record<string, unknown> | undefined;
        if (entry.account_id) {
          account = db.getAccount(entry.account_id);
        } else if (entry.account_name) {
          account = db.getAccountByName(entry.account_name);
        }

        if (!account) {
          notFound.push(entry.account_name ?? `id:${entry.account_id}`);
          continue;
        }

        const date = entry.date ?? todayStr;
        db.recordBalance(account.id as number, entry.balance, date, "manual");
        results.push({
          account: account.name as string,
          balance: entry.balance,
          date,
        });
      }

      return jsonResponse({
        recorded: results.length,
        snapshots: results,
        not_found: notFound.length > 0 ? notFound : undefined,
      });
    }
  );

  server.tool(
    "compute_balances",
    "Given a known current balance and transaction history, reconstruct monthly balance snapshots going backward (and forward). Refuses investment accounts — their balances depend on market prices, not transaction math.",
    {
      account_id: z.number().describe("Account ID"),
      anchor_balance: z.number().describe("Known balance at anchor_date"),
      anchor_date: z.string().describe("Date of the known balance (YYYY-MM-DD)"),
    },
    { idempotentHint: true, openWorldHint: false },
    async ({ account_id, anchor_balance, anchor_date }) => {
      const account = db.getAccount(account_id);
      if (!account) {
        return errorResponse("Account not found");
      }

      if (account.is_investment) {
        return errorResponse("Cannot compute balances for investment accounts — their balances depend on market prices, not transaction math. Use import_holdings instead.");
      }

      const snapshots = db.computeBalancesFromAnchor(account_id, anchor_balance, anchor_date);

      if (snapshots.length === 0) {
        return errorResponse("No transactions found for this account to compute balances from");
      }

      // Save all computed snapshots
      for (const snap of snapshots) {
        db.recordBalance(account_id, snap.balance, snap.date, "computed");
      }

      return jsonResponse({
        account: account.name,
        snapshots_created: snapshots.length,
        date_range: {
          start: snapshots[0].date,
          end: snapshots[snapshots.length - 1].date,
        },
        anchor: { date: anchor_date, balance: anchor_balance },
        sample: snapshots.slice(0, 5).concat(
          snapshots.length > 5 ? [{ date: "...", balance: 0 }] : []
        ).concat(
          snapshots.length > 5 ? snapshots.slice(-3) : []
        ),
      });
    }
  );

  server.tool(
    "import_holdings_csv",
    "Import investment holdings from a multi-account CSV. Auto-creates accounts, detects asset classes. CSV columns: Institution, Account Name, Account Type, Symbol, Name, Shares, Cost Basis, Current Value, Asset Class.",
    {
      file_path: z.string().describe("Path to the holdings CSV file"),
      as_of: z.string().describe("Date these holdings are as-of (YYYY-MM-DD)"),
      institution: z.string().optional().describe("Override institution for all accounts"),
    },
    { idempotentHint: true, openWorldHint: false },
    async ({ file_path, as_of, institution }) => {
      try {
        const result = importHoldingsCSV(db, file_path, as_of, {
          institution_override: institution,
        });
        return jsonResponse(result);
      } catch (e) {
        return errorResponse((e as Error).message);
      }
    }
  );

  server.tool(
    "import_aggregator_csv",
    "Import multi-account CSV from Mint, Monarch, or similar aggregators. Auto-creates accounts, maps categories. CSV needs: Date, Account, Description, Category, Amount columns.",
    {
      file_path: z.string().describe("Path to the aggregator CSV"),
      skip_accounts: z
        .array(z.string())
        .optional()
        .describe("Account names to skip (e.g., summary/duplicate accounts)"),
    },
    { idempotentHint: true, openWorldHint: false },
    async ({ file_path, skip_accounts }) => {
      try {
        const result = importAggregatorCSV(db, file_path, { skip_accounts });
        return jsonResponse(result);
      } catch (e) {
        return errorResponse((e as Error).message);
      }
    }
  );
}
