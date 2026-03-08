import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import { addMonths, today } from "../utils/dates.js";
import { roundMoney } from "../utils/money.js";

export function registerProjectTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "forecast",
    "Project cash flow or net worth N months into the future. Uses detected recurring patterns as baseline. Accepts adjustments for what-if tweaks.",
    {
      type: z.enum(["cash_flow", "net_worth"]).describe("What to forecast"),
      months: z.number().optional().describe("How many months ahead (default 12)"),
      adjustments: z
        .array(
          z.object({
            description: z.string(),
            monthly_amount: z.number().describe("Positive = income, negative = expense"),
            start_month: z.number().optional().describe("Month offset to start (0 = next month)"),
            end_month: z.number().optional().describe("Month offset to end"),
          })
        )
        .optional()
        .describe("Adjustments to apply on top of baseline recurring patterns"),
      investment_return: z
        .number()
        .optional()
        .describe("Expected annual investment return % (e.g., 7 for 7%). Applies monthly compounding to investment balance."),
      monthly_contribution: z
        .number()
        .optional()
        .describe("Monthly investment contribution amount added to investment balance each month"),
    },
    async ({ type, months: forecastMonths, adjustments, investment_return, monthly_contribution }) => {
      const numMonths = forecastMonths ?? 12;
      const recurring = db.getRecurringPatterns();

      // Calculate baseline monthly cash flow from recurring
      let baselineMonthlyIncome = 0;
      let baselineMonthlyExpenses = 0;

      for (const r of recurring) {
        const amount = Math.abs((r.typical_amount as number) || 0);
        const freq = r.frequency as string;
        let monthly: number;

        switch (freq) {
          case "weekly": monthly = amount * 4.33; break;
          case "biweekly": monthly = amount * 2.17; break;
          case "monthly": monthly = amount; break;
          case "quarterly": monthly = amount / 3; break;
          case "annual": monthly = amount / 12; break;
          default: monthly = amount;
        }

        if (r.is_income) {
          baselineMonthlyIncome += monthly;
        } else {
          baselineMonthlyExpenses += monthly;
        }
      }

      // If no recurring patterns, estimate from recent history
      if (recurring.length === 0) {
        const recentTotals = db.getMonthlyTotals(addMonths(today(), -3), today());
        if (recentTotals.length > 0) {
          baselineMonthlyIncome = recentTotals.reduce((s, m) => s + ((m.income as number) || 0), 0) / recentTotals.length;
          baselineMonthlyExpenses = recentTotals.reduce((s, m) => s + ((m.expenses as number) || 0), 0) / recentTotals.length;
        }
      }

      // Get current balances for net_worth forecast
      const balances = db.getBalances();
      let currentNetWorth = 0;
      let currentInvestmentBalance = 0;
      let currentCashBalance = 0;
      for (const b of balances) {
        const bal = (b.balance as number) || 0;
        if (b.is_asset) {
          currentNetWorth += bal;
          if (b.is_investment) currentInvestmentBalance += bal;
          else currentCashBalance += bal;
        } else {
          currentNetWorth -= Math.abs(bal);
        }
      }

      const monthlyReturn = investment_return ? investment_return / 12 / 100 : 0;
      const monthlyContrib = monthly_contribution ?? 0;

      const projection: {
        month: string;
        income: number;
        expenses: number;
        net: number;
        cumulative_net: number;
        net_worth?: number;
        investment_balance?: number;
        investment_growth?: number;
        adjustments_applied?: string[];
      }[] = [];

      let cumulativeNet = 0;
      let investmentBalance = currentInvestmentBalance;
      let totalInvestmentGrowth = 0;

      for (let i = 0; i < numMonths; i++) {
        const monthDate = addMonths(today(), i + 1);
        let income = baselineMonthlyIncome;
        let expenses = baselineMonthlyExpenses;
        const appliedAdjustments: string[] = [];

        if (adjustments) {
          for (const adj of adjustments) {
            const startMonth = adj.start_month ?? 0;
            const endMonth = adj.end_month ?? numMonths;
            if (i >= startMonth && i < endMonth) {
              if (adj.monthly_amount > 0) {
                income += adj.monthly_amount;
              } else {
                expenses += Math.abs(adj.monthly_amount);
              }
              appliedAdjustments.push(adj.description);
            }
          }
        }

        const net = income - expenses;
        cumulativeNet += net;

        // Apply investment compounding and contributions
        if (monthlyReturn > 0 || monthlyContrib > 0) {
          const monthGrowth = investmentBalance * monthlyReturn;
          totalInvestmentGrowth += monthGrowth;
          investmentBalance += monthGrowth + monthlyContrib;
        }

        const entry: typeof projection[0] = {
          month: monthDate.slice(0, 7),
          income: roundMoney(income),
          expenses: roundMoney(expenses),
          net: roundMoney(net),
          cumulative_net: roundMoney(cumulativeNet),
        };

        if (type === "net_worth") {
          const projectedCash = currentCashBalance + cumulativeNet - (monthlyContrib * (i + 1));
          const projectedDebt = currentNetWorth - currentInvestmentBalance - currentCashBalance;
          entry.net_worth = roundMoney(investmentBalance + projectedCash - Math.abs(projectedDebt));
          entry.investment_balance = roundMoney(investmentBalance);
          entry.investment_growth = roundMoney(totalInvestmentGrowth);
        }

        if (appliedAdjustments.length > 0) {
          entry.adjustments_applied = appliedAdjustments;
        }

        projection.push(entry);
      }

      const endNetWorth = type === "net_worth" && projection.length > 0
        ? projection[projection.length - 1].net_worth
        : undefined;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                forecast_type: type,
                months: numMonths,
                baseline: {
                  monthly_income: roundMoney(baselineMonthlyIncome),
                  monthly_expenses: roundMoney(baselineMonthlyExpenses),
                  monthly_net: roundMoney(baselineMonthlyIncome - baselineMonthlyExpenses),
                  source: recurring.length > 0 ? "recurring_patterns" : "recent_averages",
                },
                current_net_worth: type === "net_worth" ? roundMoney(currentNetWorth) : undefined,
                investment_assumptions: (investment_return || monthlyContrib)
                  ? {
                      annual_return_pct: investment_return ?? 0,
                      monthly_contribution: monthlyContrib,
                      starting_investment_balance: roundMoney(currentInvestmentBalance),
                    }
                  : undefined,
                projection,
                end_state: {
                  total_saved: roundMoney(cumulativeNet),
                  projected_net_worth: endNetWorth,
                  total_investment_growth: (investment_return || monthlyContrib)
                    ? roundMoney(totalInvestmentGrowth)
                    : undefined,
                  projected_investment_balance: (investment_return || monthlyContrib)
                    ? roundMoney(investmentBalance)
                    : undefined,
                },
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
    "scenario",
    "Full what-if modeling. Compare baseline trajectory vs modified scenario. Adjust spending, income, add one-time events, start/stop recurring items. Optionally evaluate against a savings target.",
    {
      name: z.string().describe("Scenario name (e.g., 'Cut subscriptions and invest')"),
      months: z.number().optional().describe("Projection period in months (default 12)"),
      adjustments: z
        .array(
          z.object({
            type: z
              .enum([
                "adjust_spending",
                "adjust_income",
                "one_time",
                "start_recurring",
                "stop_recurring",
                "increase_contribution",
                "change_return_assumption",
              ])
              .describe("Type of adjustment"),
            description: z.string().describe("What this adjustment represents"),
            category: z.string().optional().describe("Category to adjust (for adjust_spending)"),
            amount: z.number().describe("Amount (positive=income/savings, negative=expense)"),
            month: z.number().optional().describe("For one_time: which month (0 = next month)"),
          })
        )
        .describe("List of scenario adjustments"),
      savings_target: z.number().optional().describe("Target savings amount to evaluate against"),
      investment_return: z
        .number()
        .optional()
        .describe("Baseline annual investment return % (e.g., 7). Applied to both baseline and scenario unless overridden."),
    },
    async ({ name, months: scenarioMonths, adjustments, savings_target, investment_return }) => {
      const numMonths = scenarioMonths ?? 12;

      // Get baseline recurring
      const recurring = db.getRecurringPatterns();

      let baseIncome = 0;
      let baseExpenses = 0;

      for (const r of recurring) {
        const amount = Math.abs((r.typical_amount as number) || 0);
        const freq = r.frequency as string;
        let monthly: number;

        switch (freq) {
          case "weekly": monthly = amount * 4.33; break;
          case "biweekly": monthly = amount * 2.17; break;
          case "monthly": monthly = amount; break;
          case "quarterly": monthly = amount / 3; break;
          case "annual": monthly = amount / 12; break;
          default: monthly = amount;
        }

        if (r.is_income) baseIncome += monthly;
        else baseExpenses += monthly;
      }

      // Fallback to recent averages
      if (recurring.length === 0) {
        const recent = db.getMonthlyTotals(addMonths(today(), -3), today());
        if (recent.length > 0) {
          baseIncome = recent.reduce((s, m) => s + ((m.income as number) || 0), 0) / recent.length;
          baseExpenses = recent.reduce((s, m) => s + ((m.expenses as number) || 0), 0) / recent.length;
        }
      }

      // Get investment balance for compounding
      const balances = db.getBalances();
      let investmentBalance = 0;
      for (const b of balances) {
        if (b.is_asset && b.is_investment) {
          investmentBalance += (b.balance as number) || 0;
        }
      }

      const baseReturnRate = investment_return ? investment_return / 12 / 100 : 0;
      let baselineInvestBal = investmentBalance;
      let scenarioInvestBal = investmentBalance;
      let scenarioReturnRate = baseReturnRate;
      let scenarioExtraContrib = 0;

      // Pre-scan adjustments for investment-specific types
      for (const adj of adjustments) {
        if (adj.type === "change_return_assumption") {
          scenarioReturnRate = adj.amount / 12 / 100;
        }
        if (adj.type === "increase_contribution") {
          scenarioExtraContrib += adj.amount;
        }
      }

      const baseline: { month: string; net: number; cumulative: number; investment_balance?: number }[] = [];
      const scenario: { month: string; net: number; cumulative: number; investment_balance?: number; events: string[] }[] = [];

      let baselineCum = 0;
      let scenarioCum = 0;

      for (let i = 0; i < numMonths; i++) {
        const monthStr = addMonths(today(), i + 1).slice(0, 7);

        // Baseline
        const baseNet = baseIncome - baseExpenses;
        baselineCum += baseNet;
        if (baseReturnRate > 0) {
          baselineInvestBal += baselineInvestBal * baseReturnRate;
        }
        baseline.push({
          month: monthStr,
          net: roundMoney(baseNet),
          cumulative: roundMoney(baselineCum),
          investment_balance: investment_return ? roundMoney(baselineInvestBal) : undefined,
        });

        // Scenario
        let scenarioIncome = baseIncome;
        let scenarioExpenses = baseExpenses;
        const events: string[] = [];

        for (const adj of adjustments) {
          switch (adj.type) {
            case "adjust_spending":
              scenarioExpenses += adj.amount;
              events.push(adj.description);
              break;
            case "adjust_income":
              scenarioIncome += adj.amount;
              events.push(adj.description);
              break;
            case "one_time":
              if (i === (adj.month ?? 0)) {
                if (adj.amount > 0) scenarioIncome += adj.amount;
                else scenarioExpenses += Math.abs(adj.amount);
                events.push(adj.description);
              }
              break;
            case "start_recurring":
              if (adj.amount > 0) scenarioIncome += adj.amount;
              else scenarioExpenses += Math.abs(adj.amount);
              if (i === 0) events.push(adj.description);
              break;
            case "stop_recurring":
              scenarioExpenses -= Math.abs(adj.amount);
              if (i === 0) events.push(adj.description);
              break;
            case "increase_contribution":
              // Handled via scenarioExtraContrib
              if (i === 0) events.push(adj.description);
              break;
            case "change_return_assumption":
              if (i === 0) events.push(adj.description);
              break;
          }
        }

        // Apply scenario investment compounding
        scenarioInvestBal += scenarioInvestBal * scenarioReturnRate + scenarioExtraContrib;

        const scenarioNet = scenarioIncome - scenarioExpenses;
        scenarioCum += scenarioNet;
        scenario.push({
          month: monthStr,
          net: roundMoney(scenarioNet),
          cumulative: roundMoney(scenarioCum),
          investment_balance: (investment_return || scenarioExtraContrib) ? roundMoney(scenarioInvestBal) : undefined,
          events: events.length > 0 ? events : [],
        });
      }

      const result: Record<string, unknown> = {
        scenario_name: name,
        months: numMonths,
        baseline_monthly: {
          income: roundMoney(baseIncome),
          expenses: roundMoney(baseExpenses),
          net: roundMoney(baseIncome - baseExpenses),
        },
        investment_assumptions: (investment_return || scenarioExtraContrib)
          ? {
              baseline_annual_return: investment_return ?? 0,
              scenario_annual_return: scenarioReturnRate * 12 * 100,
              scenario_extra_monthly_contribution: scenarioExtraContrib,
              starting_investment_balance: roundMoney(investmentBalance),
            }
          : undefined,
        baseline,
        scenario,
        comparison: {
          baseline_total_saved: roundMoney(baselineCum),
          scenario_total_saved: roundMoney(scenarioCum),
          difference: roundMoney(scenarioCum - baselineCum),
          monthly_improvement: roundMoney((scenarioCum - baselineCum) / numMonths),
          baseline_investment_balance: investment_return ? roundMoney(baselineInvestBal) : undefined,
          scenario_investment_balance: (investment_return || scenarioExtraContrib) ? roundMoney(scenarioInvestBal) : undefined,
          investment_difference: (investment_return || scenarioExtraContrib)
            ? roundMoney(scenarioInvestBal - baselineInvestBal)
            : undefined,
        },
      };

      if (savings_target !== undefined) {
        const baselineMonthsToTarget = baseIncome > baseExpenses
          ? Math.ceil(savings_target / (baseIncome - baseExpenses))
          : null;

        const scenarioMonthlyNet = scenarioCum / numMonths;
        const scenarioMonthsToTarget = scenarioMonthlyNet > 0
          ? Math.ceil(savings_target / scenarioMonthlyNet)
          : null;

        result.savings_target = {
          target: savings_target,
          baseline_months_to_target: baselineMonthsToTarget,
          scenario_months_to_target: scenarioMonthsToTarget,
          months_saved: baselineMonthsToTarget && scenarioMonthsToTarget
            ? baselineMonthsToTarget - scenarioMonthsToTarget
            : null,
        };
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
}
