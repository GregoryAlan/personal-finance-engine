import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "setup-finances",
    { description: "Step-by-step onboarding: create accounts, import CSVs, categorize, and verify" },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Help me set up my finances step by step. Follow this workflow:

1. **Create accounts** — Ask me about my bank accounts, credit cards, and investment accounts. For each one, use \`manage_accounts\` with action=create. Include institution name and account type (checking, savings, credit_card, brokerage, 401k, ira, etc.). Set is_asset=false for credit cards and loans.

2. **Import transactions** — Ask me to drop CSV files into the data/imports/ folder. For each file, use \`import_csv\` with the file path and matching account_id. The system auto-detects formats for Chase, BoA, Schwab, Fidelity, Vanguard, Amex, Discover, Apple Card, Capital One, Citi, Wells Fargo, and USAA. For unknown formats, read the CSV headers and provide a column_mapping.

3. **Import investment holdings** — For any brokerage/retirement accounts, use \`import_holdings\` with a positions CSV to capture current holdings and allocation.

4. **Categorize transactions** — Run \`categorize\` with action=list_uncategorized and group_by_description=true to see what needs categorization. Create rules for common merchants with action=create_rule. Then run action=auto_categorize to apply all rules.

5. **Detect transfers** — Run \`categorize\` with action=detect_transfers to link matching cross-account transactions. This prevents double-counting in income/expense reports.

6. **Verify** — Run \`wealth_summary\` to confirm everything looks correct. Check that account balances, net worth, and allocation make sense.

Walk me through each step one at a time, confirming completion before moving to the next.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "monthly-review",
    {
      description: "Guided monthly financial review: income, spending, net worth, and milestones",
      argsSchema: { month: z.string().optional().describe("Month to review in YYYY-MM format, e.g. 2026-02. Defaults to last month.") },
    },
    async (args) => {
      const month = args.month || "last month";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Run my monthly financial review for ${month}. Go through each step and present findings:

1. **Income statement** — Use \`financial_summary\` with type="income_statement" and compare="previous_period" for ${month}. Highlight any unusual changes in income or expenses.

2. **Spending breakdown** — Use \`spending_analysis\` to show category-level spending. Call out the top 3 categories and any that are significantly higher than usual.

3. **Top merchants** — Use \`query_transactions\` with group_by="merchant" and exclude_transfers=true for ${month}. Show where the most money went.

4. **Net worth update** — Use \`get_balances\` to show current account balances and net worth. Then use \`net_worth_history\` with months=3 to show the recent trend.

5. **Milestone progress** — Use \`milestones\` with action=check to see progress toward financial goals.

6. **Recurring charges** — Use \`detect_recurring\` to review subscriptions and regular payments. Flag anything new or that seems off.

Summarize with key takeaways and any action items.`,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "investment-checkup",
    { description: "Review portfolio allocation, drift, risk metrics, and rebalancing needs" },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Run an investment checkup on my portfolio. Go through each analysis:

1. **Current allocation** — Use \`allocation\` with action=view to show my current asset class breakdown.

2. **Drift analysis** — Use \`allocation\` with action=drift to compare current allocation against targets. Highlight any asset classes that are significantly over- or under-weight.

3. **Risk metrics** — Use \`portfolio_risk\` with analysis=risk_metrics to show Sharpe ratio, Sortino ratio, volatility, and max drawdown.

4. **Concentration risk** — Use \`portfolio_risk\` with analysis=concentration and top_n=10 to check if any single holdings are too large a share of the portfolio.

5. **Rebalance suggestions** — If drift is significant, use \`allocation\` with action=rebalance to get specific trade suggestions to get back to target.

Summarize the portfolio health and recommend any actions.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "financial-independence",
    {
      description: "FI planning: calculate FI number, run Monte Carlo, forecast net worth, and model scenarios",
      argsSchema: {
        annual_spending: z.number().optional().describe("Annual spending in dollars for FI calculation"),
        withdrawal_rate: z.number().optional().describe("Safe withdrawal rate percentage (default: 4.0)"),
      },
    },
    async (args) => {
      const withdrawalRate = args.withdrawal_rate ?? 4.0;
      const spendingNote = args.annual_spending
        ? `My annual spending is $${args.annual_spending.toLocaleString()} and I'm using a ${withdrawalRate}% withdrawal rate.`
        : `Use a ${withdrawalRate}% withdrawal rate. Estimate my annual spending from recent transaction data using \`financial_summary\` with type="income_statement".`;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Help me plan for financial independence. ${spendingNote}

1. **FI number** — Use \`portfolio_risk\` with analysis=independence${args.annual_spending ? `, annual_spending=${args.annual_spending}` : ""}, and withdrawal_rate=${withdrawalRate}. Show my FI target number and current progress.

2. **Monte Carlo simulation** — Use \`portfolio_risk\` with analysis=monte_carlo, simulations=5000, and months=240 (20 years). Include monthly_contribution if I have regular investment contributions. Show the probability distribution of outcomes.

3. **Net worth forecast** — Use \`forecast\` with type="net_worth" and months=120 (10 years) with a reasonable investment_return assumption. Show projected growth trajectory.

4. **Scenario modeling** — Run two scenarios with \`scenario\`:
   - **Aggressive saving**: Increase monthly contributions by 50%
   - **Market downturn**: Model with -5% returns for the first 2 years

5. **Trend analysis** — Use \`net_worth_history\` with decompose=true and trend=true to show how contributions vs market growth have driven my net worth changes.

Summarize my FI timeline, key risks, and the most impactful levers I can pull to reach FI sooner.`,
            },
          },
        ],
      };
    }
  );
}
