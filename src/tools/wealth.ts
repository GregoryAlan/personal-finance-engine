import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import { roundMoney } from "../utils/money.js";
import { today, addMonths } from "../utils/dates.js";
import {
  calculateAllocationDrift,
  calculatePerformance,
  decomposeContributionsVsGrowth,
  checkMilestones,
} from "../analysis/wealth.js";

function periodToDateRange(period: string): { from: string; to: string } {
  const to = today();
  let from: string;
  switch (period) {
    case "1m":
      from = addMonths(to, -1);
      break;
    case "3m":
      from = addMonths(to, -3);
      break;
    case "6m":
      from = addMonths(to, -6);
      break;
    case "ytd":
      from = `${to.slice(0, 4)}-01-01`;
      break;
    case "1y":
      from = addMonths(to, -12);
      break;
    case "2y":
      from = addMonths(to, -24);
      break;
    case "all":
      from = "2000-01-01";
      break;
    default:
      from = addMonths(to, -12);
  }
  return { from, to };
}

export function registerWealthTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "wealth_summary",
    "Primary wealth dashboard: net worth breakdown, investment performance, contribution vs growth decomposition, allocation drift, and milestone progress.",
    {
      as_of: z.string().optional().describe("Snapshot date (YYYY-MM-DD). Defaults to today."),
      period: z
        .enum(["1m", "3m", "6m", "ytd", "1y", "2y", "all"])
        .optional()
        .describe("Performance lookback period (default 1y)"),
      include_drift: z
        .boolean()
        .optional()
        .describe("Include allocation drift analysis (default: true if targets exist)"),
      include_rebalance: z
        .boolean()
        .optional()
        .describe("Include suggested rebalance trades"),
    },
    async ({ as_of, period, include_drift, include_rebalance }) => {
      const asOf = as_of || today();
      const { from: dateFrom, to: dateTo } = periodToDateRange(period || "1y");

      // Net worth breakdown
      const balances = db.getBalances(asOf);
      let totalAssets = 0;
      let totalLiabilities = 0;
      let investmentTotal = 0;
      let cashTotal = 0;
      let debtTotal = 0;

      const accountBreakdown: Record<string, unknown>[] = [];

      for (const b of balances) {
        const bal = (b.balance as number) || 0;
        if (b.is_asset) {
          totalAssets += bal;
          if (b.is_investment) {
            investmentTotal += bal;
          } else {
            cashTotal += bal;
          }
        } else {
          totalLiabilities += Math.abs(bal);
          debtTotal += Math.abs(bal);
        }
        accountBreakdown.push({
          name: b.name,
          type: b.type,
          balance: roundMoney(bal),
          is_investment: !!b.is_investment,
        });
      }

      const netWorth = totalAssets - totalLiabilities;

      // Current allocation
      const holdingsResult = db.getHoldings({ group_by: "asset_class", as_of: asOf });
      const allocation = (holdingsResult.groups || []).map((g) => ({
        asset_class: g.group_key,
        value: roundMoney((g.total_value as number) || 0),
        pct: g.allocation_pct,
      }));

      // Performance
      const performance = calculatePerformance(db, dateFrom, dateTo);

      // Contribution vs growth
      const decomposition = decomposeContributionsVsGrowth(db, dateFrom, dateTo);

      // Allocation drift
      let drift: unknown = undefined;
      const targets = db.getAllocationTargets("default");
      const shouldIncludeDrift = include_drift !== undefined ? include_drift : targets.length > 0;

      if (shouldIncludeDrift) {
        const driftResult = calculateAllocationDrift(db, "default", asOf);
        if ("error" in driftResult) {
          drift = { error: driftResult.error };
        } else {
          drift = {
            max_drift_pct: driftResult.max_drift_pct,
            drift: driftResult.drift,
            rebalance_trades: include_rebalance ? driftResult.rebalance_trades : undefined,
          };
        }
      }

      // Milestones
      const milestones = checkMilestones(db);

      const result: Record<string, unknown> = {
        as_of: asOf,
        period: period || "1y",
        net_worth: roundMoney(netWorth),
        investment_total: roundMoney(investmentTotal),
        cash_total: roundMoney(cashTotal),
        debt_total: roundMoney(debtTotal),
        accounts: accountBreakdown,
        allocation,
        performance: "error" in performance ? performance : {
          period: `${dateFrom} to ${dateTo}`,
          start_value: performance.start_value,
          end_value: performance.end_value,
          return_pct: performance.percentage_return,
          annualized_return: performance.annualized_return,
          by_asset_class: performance.by_asset_class,
        },
        contribution_vs_growth: {
          net_worth_change: decomposition.net_worth_change,
          contributions: decomposition.net_contributions,
          investment_growth: decomposition.investment_growth,
          growth_pct_of_change: decomposition.growth_pct_of_change,
          savings_rate: decomposition.savings_rate,
        },
      };

      if (drift !== undefined) {
        result.allocation_drift = drift;
      }

      if (milestones.length > 0) {
        result.milestones = milestones;
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
    "allocation",
    "Manage target asset allocation. View current allocation, set targets, check drift, and get rebalance suggestions.",
    {
      action: z
        .enum(["view", "set_target", "view_targets", "drift", "delete_target"])
        .describe("Action to perform"),
      target_name: z
        .string()
        .optional()
        .describe("Allocation profile name (default: 'default')"),
      targets: z
        .array(
          z.object({
            asset_class: z.string().describe("Asset class (us_stock, intl_stock, bond, real_estate, cash, crypto, commodity, other)"),
            target_pct: z.number().describe("Target percentage (all targets must sum to 100)"),
          })
        )
        .optional()
        .describe("For set_target: target allocations (must sum to 100)"),
      as_of: z.string().optional().describe("Snapshot date for drift calculation"),
    },
    async ({ action, target_name, targets, as_of }) => {
      const name = target_name || "default";

      if (action === "view") {
        const holdingsResult = db.getHoldings({ group_by: "asset_class", as_of: as_of });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  as_of: as_of || "latest",
                  total_value: roundMoney(holdingsResult.total_value),
                  allocation: (holdingsResult.groups || []).map((g) => ({
                    asset_class: g.group_key,
                    value: roundMoney((g.total_value as number) || 0),
                    pct: g.allocation_pct,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === "set_target") {
        if (!targets || targets.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "targets array required" }),
              },
            ],
          };
        }

        const sum = targets.reduce((s, t) => s + t.target_pct, 0);
        if (Math.abs(sum - 100) > 0.01) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Target percentages must sum to 100, got ${roundMoney(sum)}`,
                }),
              },
            ],
          };
        }

        db.setAllocationTargets(name, targets);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  saved: { name, targets },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === "view_targets") {
        const allTargets = db.getAllocationTargets(target_name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  profiles: allTargets.length > 0 ? allTargets : "No allocation targets set",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === "drift") {
        const driftResult = calculateAllocationDrift(db, name, as_of);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(driftResult, null, 2),
            },
          ],
        };
      }

      if (action === "delete_target") {
        const deleted = db.deleteAllocationTargets(name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ deleted_count: deleted, profile: name }),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown action" }) }],
      };
    }
  );

  server.tool(
    "milestones",
    "Track wealth milestones and goals. Create net worth or account targets, check progress, and see projected achievement dates.",
    {
      action: z
        .enum(["list", "create", "delete", "check"])
        .describe("Action to perform"),
      name: z.string().optional().describe("Milestone name (for create)"),
      target_amount: z.number().optional().describe("Target amount (for create)"),
      target_type: z
        .enum(["net_worth", "account", "investment_total"])
        .optional()
        .describe("What to measure against (for create)"),
      account_id: z
        .number()
        .optional()
        .describe("Account ID (required if target_type is 'account')"),
      milestone_id: z.number().optional().describe("Milestone ID (for delete)"),
    },
    async ({ action, name, target_amount, target_type, account_id, milestone_id }) => {
      if (action === "create") {
        if (!name || target_amount === undefined || !target_type) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "name, target_amount, and target_type required",
                }),
              },
            ],
          };
        }

        if (target_type === "account" && !account_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "account_id required when target_type is 'account'",
                }),
              },
            ],
          };
        }

        const id = db.createMilestone({
          name,
          target_amount,
          target_type,
          account_id,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { created: { id, name, target_amount, target_type } },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === "list") {
        const milestones = db.listMilestones();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ milestones }, null, 2),
            },
          ],
        };
      }

      if (action === "delete") {
        if (!milestone_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "milestone_id required" }),
              },
            ],
          };
        }
        const deleted = db.deleteMilestone(milestone_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ deleted: deleted > 0 }),
            },
          ],
        };
      }

      if (action === "check") {
        const progress = checkMilestones(db);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  milestones: progress.length > 0 ? progress : "No milestones set",
                },
                null,
                2
              ),
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
