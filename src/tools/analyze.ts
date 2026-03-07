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
import { addMonths, today } from "../utils/dates.js";

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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
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
    async ({ date_from, date_to, category }) => {
      const end = date_to || today();
      const start = date_from || addMonths(end, -1);

      const result = analyzeSpending(db, start, end, category);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "net_worth_history",
    "Track net worth over time with optional per-account breakdown.",
    {
      months: z.number().optional().describe("How many months of history (default 12)"),
      include_accounts: z.boolean().optional().describe("Include per-account breakdown at each point"),
    },
    async ({ months, include_accounts }) => {
      const result = calculateNetWorthHistory(db, months ?? 12, include_accounts ?? false);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                months: months ?? 12,
                data_points: result.length,
                history: result,
                summary:
                  result.length >= 2
                    ? {
                        start: result[0],
                        end: result[result.length - 1],
                        change: Math.round((result[result.length - 1].net_worth - result[0].net_worth) * 100) / 100,
                      }
                    : null,
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
    "detect_recurring",
    "Scan transaction history to find recurring payments (subscriptions, bills) and income patterns. Returns total monthly subscription cost and income.",
    {
      lookback_months: z
        .number()
        .optional()
        .describe("How many months of history to scan (default 6)"),
    },
    async ({ lookback_months }) => {
      const result = detectRecurring(db, lookback_months ?? 6);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
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
    },
    async ({
      action,
      group_by_description,
      pattern,
      category_path,
      match_type,
      priority,
      transaction_ids,
      category_type,
    }) => {
      if (action === "list_uncategorized") {
        const result = db.listUncategorized(group_by_description);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  uncategorized_count: result.length,
                  items: result,
                  hint: group_by_description
                    ? "These are grouped by description. Create rules for frequent merchants to auto-categorize future imports."
                    : "Add group_by_description=true to see patterns.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === "create_rule") {
        if (!pattern || !category_path) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "pattern and category_path required" }),
              },
            ],
          };
        }

        const cat = db.getCategoryByPath(category_path);
        if (!cat) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Category not found: ${category_path}`,
                  available: db.listCategories().map((c) => (c as { full_path: string }).full_path),
                }),
              },
            ],
          };
        }

        const ruleId = db.createRule(pattern, cat.id, priority, match_type);

        // Auto-apply the new rule
        const applied = db.applyCategorization();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  created: { id: ruleId, pattern, category: category_path, match_type: match_type ?? "contains" },
                  auto_applied: applied,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === "auto_categorize") {
        const result = db.applyCategorization();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (action === "assign") {
        if (!transaction_ids || !category_path) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "transaction_ids and category_path required" }),
              },
            ],
          };
        }

        const cat = db.getCategoryByPath(category_path);
        if (!cat) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `Category not found: ${category_path}` }),
              },
            ],
          };
        }

        const updated = db.assignCategory(transaction_ids, cat.id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ updated, category: category_path }),
            },
          ],
        };
      }

      if (action === "list_rules") {
        const rules = db.listRules();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ rules }, null, 2),
            },
          ],
        };
      }

      if (action === "list_categories") {
        const categories = db.listCategories(category_type);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ categories }, null, 2),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown action" }) }],
      };
    }
  );
}
