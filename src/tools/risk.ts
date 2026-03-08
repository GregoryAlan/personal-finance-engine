import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import {
  calculateRiskMetrics,
  calculateConcentration,
  runMonteCarlo,
  calculateFinancialIndependence,
} from "../analysis/risk.js";
import { jsonResponse, errorResponse } from "../utils/response.js";

export function registerRiskTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "portfolio_risk",
    "Portfolio risk analysis: volatility, Sharpe/Sortino ratios, max drawdown, concentration/HHI, Monte Carlo simulation, and financial independence planning.",
    {
      analysis: z
        .enum(["risk_metrics", "concentration", "monte_carlo", "independence"])
        .describe("Type of analysis: risk_metrics (Sharpe, Sortino, volatility, max drawdown), concentration (HHI, position weights), monte_carlo (probability bands), independence (FI number, SWR)"),

      // risk_metrics options
      risk_free_rate: z
        .number()
        .optional()
        .describe("Annual risk-free rate % for Sharpe/Sortino (default 4.5)"),
      period: z
        .enum(["1y", "2y", "3y", "5y", "all"])
        .optional()
        .describe("Lookback period for risk_metrics (default 'all')"),

      // concentration options
      as_of: z
        .string()
        .optional()
        .describe("Snapshot date YYYY-MM-DD (default today)"),
      top_n: z
        .number()
        .optional()
        .describe("Number of top holdings to show for concentration (default 10)"),

      // monte_carlo options
      simulations: z
        .number()
        .optional()
        .describe("Number of Monte Carlo simulations (default 1000, max 10000)"),
      months: z
        .number()
        .optional()
        .describe("Projection horizon in months for monte_carlo (default 120)"),
      monthly_contribution: z
        .number()
        .optional()
        .describe("Monthly contribution for monte_carlo projections"),

      // independence options
      annual_spending: z
        .number()
        .optional()
        .describe("Override annual spending for FI calculation (otherwise computed from transactions)"),
      withdrawal_rate: z
        .number()
        .optional()
        .describe("Safe withdrawal rate % for FI number (default 4.0)"),
      investment_return: z
        .number()
        .optional()
        .describe("Expected annual investment return % for FI projections (default 7.0)"),
      lookback_months: z
        .number()
        .optional()
        .describe("Months of spending history to average for independence (default 12)"),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({
      analysis,
      risk_free_rate,
      period,
      as_of,
      top_n,
      simulations,
      months,
      monthly_contribution,
      annual_spending,
      withdrawal_rate,
      investment_return,
      lookback_months,
    }) => {
      let result: unknown;

      if (analysis === "risk_metrics") {
        const periodMonths: Record<string, number> = {
          "1y": 12,
          "2y": 24,
          "3y": 36,
          "5y": 60,
        };
        result = calculateRiskMetrics(db, {
          risk_free_rate,
          months: period ? periodMonths[period] : undefined,
        });
      } else if (analysis === "concentration") {
        result = calculateConcentration(db, { as_of, top_n });
      } else if (analysis === "monte_carlo") {
        result = runMonteCarlo(db, {
          simulations,
          months,
          monthly_contribution,
        });
      } else if (analysis === "independence") {
        result = calculateFinancialIndependence(db, {
          annual_spending,
          withdrawal_rate,
          investment_return,
          lookback_months,
        });
      } else {
        return errorResponse("Unknown analysis type");
      }

      return jsonResponse(result);
    }
  );
}
