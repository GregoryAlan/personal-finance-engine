import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import { jsonResponse, tableResponse } from "../utils/response.js";
import { formatTable } from "../utils/table.js";

export function registerQueryTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "query_transactions",
    "Query transactions with flexible filtering and grouping. The group_by parameter transforms this into any report — spending by category, monthly totals, per-account breakdown, or merchant frequency analysis.",
    {
      account_id: z.number().optional().describe("Filter by account ID"),
      category: z.string().optional().describe("Filter by category path (prefix match, e.g. 'Food' matches 'Food > Groceries')"),
      date_from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      min_amount: z.number().optional().describe("Minimum amount (use negative for expenses)"),
      max_amount: z.number().optional().describe("Maximum amount"),
      description: z.string().optional().describe("Search description (partial match)"),
      merchant: z.string().optional().describe("Search by normalized merchant name (partial match)"),
      uncategorized: z.boolean().optional().describe("Only show uncategorized transactions"),
      group_by: z
        .enum(["category", "month", "account", "description", "merchant"])
        .optional()
        .describe("Group results and return aggregates instead of individual transactions"),
      limit: z.number().optional().describe("Max results (default 100)"),
      offset: z.number().optional().describe("Skip N results for pagination"),
      tags: z.string().optional().describe("Filter by tag (partial match)"),
      include_excluded: z.boolean().optional().describe("Include excluded/split-parent transactions"),
      exclude_transfers: z.boolean().optional().describe("Exclude transfer transactions from results"),
    },
    { readOnlyHint: true, openWorldHint: false },
    async (filters) => {
      const result = db.queryTransactions({
        account_id: filters.account_id,
        category_path: filters.category,
        date_from: filters.date_from,
        date_to: filters.date_to,
        min_amount: filters.min_amount,
        max_amount: filters.max_amount,
        description: filters.description,
        merchant: filters.merchant,
        uncategorized: filters.uncategorized,
        group_by: filters.group_by,
        limit: filters.limit,
        offset: filters.offset,
        tags: filters.tags,
        include_excluded: filters.include_excluded,
        exclude_transfers: filters.exclude_transfers,
      });

      const summary: Record<string, unknown> = {
        ...result,
        query: {
          ...filters,
          note: filters.group_by
            ? `Grouped by ${filters.group_by}. Each row shows total, count, avg, min, max.`
            : undefined,
        },
      };

      // Render tabular output for row data
      if (filters.group_by && result.groups) {
        // Remove groups from summary since they'll be in the table
        const { groups, ...rest } = summary;
        const groupRows = result.groups as Record<string, unknown>[];
        return tableResponse(
          rest,
          formatTable(groupRows, {
            columns: ["group_key", "total", "count", "avg_amount", "min_amount", "max_amount"],
          })
        );
      }

      if (!filters.group_by && result.transactions) {
        const { transactions, ...rest } = summary;
        const txnRows = result.transactions as Record<string, unknown>[];
        return tableResponse(
          rest,
          formatTable(txnRows, {
            columns: ["date", "account_name", "merchant", "amount", "category_path", "description"],
          })
        );
      }

      return jsonResponse(summary);
    }
  );

  server.tool(
    "get_balances",
    "Get account balances at any point in time. Returns totals for assets, liabilities, and net worth.",
    {
      as_of: z.string().optional().describe("Balance as of this date (YYYY-MM-DD). Defaults to latest."),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({ as_of }) => {
      const balances = db.getBalances(as_of);

      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const b of balances) {
        const bal = (b.balance as number) || 0;
        if (b.is_asset) {
          totalAssets += bal;
        } else {
          totalLiabilities += Math.abs(bal);
        }
      }

      return jsonResponse({
        as_of: as_of || "latest",
        accounts: balances,
        summary: {
          total_assets: Math.round(totalAssets * 100) / 100,
          total_liabilities: Math.round(totalLiabilities * 100) / 100,
          net_worth: Math.round((totalAssets - totalLiabilities) * 100) / 100,
        },
      });
    }
  );

  server.tool(
    "get_holdings",
    "Get investment holdings (positions). Use group_by for allocation analysis by asset_class, account, or symbol.",
    {
      account_id: z.number().optional().describe("Filter by account ID"),
      symbol: z.string().optional().describe("Filter by ticker symbol"),
      as_of: z.string().optional().describe("Holdings as of date (defaults to latest)"),
      group_by: z
        .enum(["asset_class", "account", "symbol"])
        .optional()
        .describe("Group holdings and show allocation percentages"),
    },
    { readOnlyHint: true, openWorldHint: false },
    async (filters) => {
      const result = db.getHoldings(filters);

      const summary: Record<string, unknown> = {
        ...result,
        query: filters,
      };

      // Render tabular output for ungrouped holdings
      if (!filters.group_by && result.holdings) {
        const { holdings, ...rest } = summary;
        const holdingRows = result.holdings as Record<string, unknown>[];
        return tableResponse(
          rest,
          formatTable(holdingRows, {
            columns: ["symbol", "name", "shares", "cost_basis", "current_value", "asset_class", "account_name"],
          })
        );
      }

      return jsonResponse(summary);
    }
  );
}
