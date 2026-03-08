import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import {
  generateBalanceSheet,
  generateIncomeStatement,
  generateCashFlow,
} from "../analysis/statements.js";
import { analyzeSpending } from "../analysis/spending.js";
import { calculateNetWorthHistory } from "../analysis/networth.js";
import { detectRecurring } from "../analysis/recurring.js";
import { detectTransfers } from "../analysis/transfers.js";
import { extractMerchant } from "../import/merchant.js";
import { decomposeContributionsVsGrowth } from "../analysis/wealth.js";
import { addMonths, today, monthsBetween } from "../utils/dates.js";
import { roundMoney } from "../utils/money.js";
import { jsonResponse, errorResponse, tableResponse } from "../utils/response.js";
import { formatTable } from "../utils/table.js";

export function registerAnalyzeTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "financial_summary",
    "Generate a balance sheet, income statement, or cash flow statement. Supports period comparison (vs previous period or year-over-year).",
    {
      type: z.enum(["balance_sheet", "income_statement", "cash_flow"]).describe("Statement type"),
      date_from: z.string().optional().describe("Period start (YYYY-MM-DD). Defaults to 3 months ago."),
      date_to: z.string().optional().describe("Period end (YYYY-MM-DD). Defaults to today."),
      compare: z
        .enum(["previous_period", "year_ago"])
        .optional()
        .describe("Add comparison to previous period or same period last year"),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({ type, date_from, date_to, compare }) => {
      const end = date_to || today();
      const start = date_from || addMonths(end, -3);

      let result;

      if (type === "balance_sheet") {
        result = generateBalanceSheet(db, end);
      } else if (type === "income_statement") {
        let comparePeriod: { start: string; end: string } | undefined;

        if (compare === "previous_period") {
          const periodLength = Math.ceil(
            (new Date(end).getTime() - new Date(start).getTime()) / 86400000
          );
          const prevEnd = new Date(start);
          prevEnd.setDate(prevEnd.getDate() - 1);
          const prevStart = new Date(prevEnd);
          prevStart.setDate(prevStart.getDate() - periodLength);
          comparePeriod = {
            start: prevStart.toISOString().slice(0, 10),
            end: prevEnd.toISOString().slice(0, 10),
          };
        } else if (compare === "year_ago") {
          comparePeriod = {
            start: addMonths(start, -12),
            end: addMonths(end, -12),
          };
        }

        result = generateIncomeStatement(db, start, end, comparePeriod);
      } else {
        result = generateCashFlow(db, start, end);
      }

      return jsonResponse(result);
    }
  );

  server.tool(
    "spending_analysis",
    "Analyze spending by category with trends, top merchants, and drill-down capability.",
    {
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD). Defaults to 1 month ago."),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD). Defaults to today."),
      category: z
        .string()
        .optional()
        .describe("Drill into a specific category (e.g., 'Food' to see subcategories)"),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({ date_from, date_to, category }) => {
      const end = date_to || today();
      const start = date_from || addMonths(end, -1);

      const result = analyzeSpending(db, start, end, category) as unknown as Record<string, unknown>;

      // Build table sections for by_category and top_merchants
      const tables: string[] = [];

      if (result.by_category && Array.isArray(result.by_category)) {
        tables.push(
          "## By Category\n" +
            formatTable(result.by_category as Record<string, unknown>[], {
              columns: ["category", "total", "count", "pct_of_spending"],
            })
        );
      }

      if (result.top_merchants && Array.isArray(result.top_merchants)) {
        tables.push(
          "## Top Merchants\n" +
            formatTable(result.top_merchants as Record<string, unknown>[], {
              columns: ["merchant", "total", "count", "category"],
            })
        );
      }

      if (tables.length > 0) {
        const { by_category, top_merchants, ...summary } = result;
        return tableResponse(summary, tables.join("\n\n"));
      }

      return jsonResponse(result);
    }
  );

  server.tool(
    "net_worth_history",
    "Track net worth over time with optional per-account breakdown, contribution vs growth decomposition, and trend analysis.",
    {
      months: z.number().optional().describe("How many months of history (default 12)"),
      include_accounts: z.boolean().optional().describe("Include per-account breakdown at each point"),
      decompose: z.boolean().optional().describe("Break each period's change into contributions vs investment growth"),
      trend: z.boolean().optional().describe("Include CAGR, average monthly growth, and milestone projections"),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({ months, include_accounts, decompose, trend }) => {
      const numMonths = months ?? 12;
      const result = calculateNetWorthHistory(db, numMonths, include_accounts ?? false);

      const output: Record<string, unknown> = {
        months: numMonths,
        data_points: result.length,
        summary:
          result.length >= 2
            ? {
                start: result[0],
                end: result[result.length - 1],
                change: roundMoney(result[result.length - 1].net_worth - result[0].net_worth),
              }
            : null,
      };

      if (decompose && result.length >= 2) {
        const dateFrom = result[0].date;
        const dateTo = result[result.length - 1].date;
        output.decomposition = decomposeContributionsVsGrowth(db, dateFrom, dateTo);
      }

      if (trend && result.length >= 2) {
        const startNw = result[0].net_worth;
        const endNw = result[result.length - 1].net_worth;
        const totalChange = endNw - startNw;
        const periodMonths = monthsBetween(result[0].date, result[result.length - 1].date) || 1;
        const avgMonthlyGrowth = totalChange / periodMonths;

        let cagr: number | null = null;
        if (startNw > 0 && periodMonths >= 12) {
          const years = periodMonths / 12;
          cagr = roundMoney((Math.pow(endNw / startNw, 1 / years) - 1) * 100);
        }

        const projections: Record<string, unknown> = {};
        if (avgMonthlyGrowth > 0) {
          for (const target of [100000, 250000, 500000, 1000000, 2000000]) {
            if (target > endNw) {
              const monthsNeeded = Math.ceil((target - endNw) / avgMonthlyGrowth);
              projections[`$${(target / 1000).toFixed(0)}k`] = {
                months_away: monthsNeeded,
                projected_date: addMonths(today(), monthsNeeded),
              };
            }
          }
        }

        output.trend = {
          cagr_pct: cagr,
          avg_monthly_growth: roundMoney(avgMonthlyGrowth),
          avg_monthly_growth_pct: startNw > 0 ? roundMoney((avgMonthlyGrowth / startNw) * 100) : null,
          milestone_projections: Object.keys(projections).length > 0 ? projections : "All standard milestones achieved",
        };
      }

      // Render history as table
      const historyRows = result as unknown as Record<string, unknown>[];
      if (historyRows.length > 0) {
        const columns = ["date", "net_worth", "assets", "liabilities"];
        // Only include account columns if present
        if (include_accounts && historyRows[0].accounts) {
          // Keep accounts in JSON summary, table shows core columns
        }
        return tableResponse(output, formatTable(historyRows, { columns }));
      }

      output.history = result;
      return jsonResponse(output);
    }
  );

  server.tool(
    "detect_recurring",
    "Scan transaction history to find recurring payments (subscriptions, bills) and income patterns. Returns total monthly subscription cost and income.",
    {
      lookback_months: z
        .number()
        .optional()
        .describe("How many months of history to scan (default 6)"),
    },
    { idempotentHint: true, openWorldHint: false },
    async ({ lookback_months }) => {
      const result = detectRecurring(db, lookback_months ?? 6) as unknown as Record<string, unknown>;

      // Render recurring items as table
      if (result.recurring && Array.isArray(result.recurring)) {
        const { recurring, ...summary } = result;
        const recurringRows = recurring as Record<string, unknown>[];
        return tableResponse(
          summary,
          formatTable(recurringRows, {
            columns: ["description", "frequency", "typical_amount", "monthly_cost", "is_income", "occurrences"],
          })
        );
      }

      return jsonResponse(result);
    }
  );

  server.tool(
    "categorize",
    "Manage transaction categorization. List uncategorized transactions, create rules, auto-apply rules, or manually assign categories.",
    {
      action: z
        .enum([
          "list_uncategorized",
          "create_rule",
          "auto_categorize",
          "assign",
          "list_rules",
          "list_categories",
          "renormalize",
          "detect_transfers",
          "link_transfer",
          "unlink_transfer",
          "list_transfers",
        ])
        .describe("Action to perform"),
      group_by_description: z
        .boolean()
        .optional()
        .describe("For list_uncategorized: group by description to see patterns"),
      pattern: z.string().optional().describe("For create_rule: text pattern to match"),
      category_path: z
        .string()
        .optional()
        .describe("Category full path (e.g. 'Food > Groceries'). For create_rule or assign."),
      match_type: z
        .enum(["contains", "starts_with", "exact", "regex"])
        .optional()
        .describe("For create_rule: how to match (default: contains)"),
      priority: z.number().optional().describe("For create_rule: higher = checked first"),
      transaction_ids: z
        .array(z.number())
        .optional()
        .describe("For assign: transaction IDs to categorize"),
      category_type: z
        .enum(["expense", "income", "transfer"])
        .optional()
        .describe("For list_categories: filter by type"),
      date_window_days: z
        .number()
        .optional()
        .describe("For detect_transfers: max days between matching transactions (default 3)"),
      dry_run: z
        .boolean()
        .optional()
        .describe("For detect_transfers: preview matches without linking"),
      transaction_id_a: z
        .number()
        .optional()
        .describe("For link_transfer: first transaction ID"),
      transaction_id_b: z
        .number()
        .optional()
        .describe("For link_transfer: second transaction ID"),
      transaction_id: z
        .number()
        .optional()
        .describe("For unlink_transfer: transaction ID to unlink"),
    },
    { openWorldHint: false },
    async ({
      action,
      group_by_description,
      pattern,
      category_path,
      match_type,
      priority,
      transaction_ids,
      category_type,
      date_window_days,
      dry_run,
      transaction_id_a,
      transaction_id_b,
      transaction_id,
    }) => {
      if (action === "list_uncategorized") {
        const result = db.listUncategorized(group_by_description);

        if (group_by_description) {
          const rows = result as Record<string, unknown>[];
          return tableResponse(
            {
              uncategorized_count: result.length,
              hint: "These are grouped by description. Create rules for frequent merchants to auto-categorize future imports.",
            },
            formatTable(rows, {
              columns: ["merchant", "description", "count", "total"],
            })
          );
        }

        return jsonResponse({
          uncategorized_count: result.length,
          items: result,
          hint: "Add group_by_description=true to see patterns.",
        });
      }

      if (action === "create_rule") {
        if (!pattern || !category_path) {
          return errorResponse("pattern and category_path required");
        }

        const cat = db.getCategoryByPath(category_path);
        if (!cat) {
          return errorResponse(`Category not found: ${category_path}`, {
            available: db.listCategories().map((c) => (c as { full_path: string }).full_path),
          });
        }

        const ruleId = db.createRule(pattern, cat.id, priority, match_type);
        const applied = db.applyCategorization();

        return jsonResponse({
          created: { id: ruleId, pattern, category: category_path, match_type: match_type ?? "contains" },
          auto_applied: applied,
        });
      }

      if (action === "auto_categorize") {
        const result = db.applyCategorization();
        return jsonResponse(result);
      }

      if (action === "assign") {
        if (!transaction_ids || !category_path) {
          return errorResponse("transaction_ids and category_path required");
        }

        const cat = db.getCategoryByPath(category_path);
        if (!cat) {
          return errorResponse(`Category not found: ${category_path}`);
        }

        const updated = db.assignCategory(transaction_ids, cat.id);
        return jsonResponse({ updated, category: category_path });
      }

      if (action === "list_rules") {
        const rules = db.listRules();
        return jsonResponse({ rules });
      }

      if (action === "list_categories") {
        const categories = db.listCategories(category_type);
        return jsonResponse({ categories });
      }

      if (action === "renormalize") {
        const updated = db.renormalizeMerchants(extractMerchant);
        return jsonResponse({ renormalized: updated });
      }

      if (action === "detect_transfers") {
        const result = detectTransfers(db, { dateWindowDays: date_window_days, dryRun: dry_run });
        return jsonResponse(result);
      }

      if (action === "link_transfer") {
        if (!transaction_id_a || !transaction_id_b) {
          return errorResponse("transaction_id_a and transaction_id_b required");
        }

        const txnA = db.getTransaction(transaction_id_a);
        const txnB = db.getTransaction(transaction_id_b);
        if (!txnA || !txnB) {
          return errorResponse("One or both transactions not found");
        }

        const categoryId = getTransferCategoryId(db, txnA, txnB);
        db.linkTransferPair(transaction_id_a, transaction_id_b, categoryId);

        return jsonResponse({
          linked: {
            a: { id: transaction_id_a, description: txnA.description, amount: txnA.amount, account: txnA.account_name },
            b: { id: transaction_id_b, description: txnB.description, amount: txnB.amount, account: txnB.account_name },
          },
        });
      }

      if (action === "unlink_transfer") {
        if (!transaction_id) {
          return errorResponse("transaction_id required");
        }
        db.unlinkTransferPair(transaction_id);
        return jsonResponse({ unlinked: transaction_id });
      }

      if (action === "list_transfers") {
        const transfers = db.getLinkedTransfers();
        return jsonResponse({ count: transfers.length, transfers });
      }

      return errorResponse("Unknown action");
    }
  );
}

function getTransferCategoryId(
  db: FinanceDB,
  txnA: Record<string, unknown>,
  txnB: Record<string, unknown>
): number | undefined {
  const accountA = db.getAccount(txnA.account_id as number);
  const accountB = db.getAccount(txnB.account_id as number);
  if (!accountA || !accountB) return undefined;

  let categoryPath: string;
  if (accountA.type === "credit_card" || accountB.type === "credit_card") {
    categoryPath = "Transfer > Credit Card Payment";
  } else if (
    accountA.is_investment || accountB.is_investment
  ) {
    categoryPath = "Transfer > Investment Contribution";
  } else {
    categoryPath = "Transfer > Account Transfer";
  }

  const cat = db.getCategoryByPath(categoryPath);
  return cat?.id;
}
