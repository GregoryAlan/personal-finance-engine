import type { FinanceDB } from "../db/database.js";
import { roundMoney } from "../utils/money.js";
import { today, addMonths } from "../utils/dates.js";

// --- Helpers ---

function normalRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

interface MonthlyValue {
  month: string;
  investment_value: number;
  net_worth: number;
}

function getMonthlyPortfolioValues(db: FinanceDB, months?: number): MonthlyValue[] {
  const monthsBack = months ?? 120;
  return db.db
    .prepare(
      `WITH monthly_latest AS (
        SELECT
          bs.account_id,
          substr(bs.as_of, 1, 7) as month,
          bs.balance,
          ROW_NUMBER() OVER (PARTITION BY bs.account_id, substr(bs.as_of, 1, 7) ORDER BY bs.as_of DESC) as rn
        FROM balance_snapshots bs
        WHERE bs.as_of >= date('now', ?)
      )
      SELECT
        ml.month,
        SUM(CASE WHEN a.is_asset = 1 AND a.is_investment = 1 THEN ml.balance ELSE 0 END) as investment_value,
        SUM(CASE WHEN a.is_asset = 1 THEN ml.balance ELSE 0 END) -
        SUM(CASE WHEN a.is_asset = 0 THEN ABS(ml.balance) ELSE 0 END) as net_worth
      FROM monthly_latest ml
      JOIN accounts a ON ml.account_id = a.id
      WHERE ml.rn = 1 AND a.closed_at IS NULL
      GROUP BY ml.month
      ORDER BY ml.month ASC`
    )
    .all(`-${monthsBack} months`) as MonthlyValue[];
}

function computeMonthlyReturns(values: { value: number; month: string }[]): { month: string; return_pct: number }[] {
  const returns: { month: string; return_pct: number }[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1].value;
    if (prev > 0) {
      returns.push({
        month: values[i].month,
        return_pct: ((values[i].value - prev) / prev) * 100,
      });
    }
  }
  return returns;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[], avg?: number): number {
  const m = avg ?? mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// --- Risk Metrics ---

export interface RiskMetricsResult {
  period: { from: string; to: string };
  data_points: number;
  monthly_returns: { month: string; return_pct: number }[];
  annualized_return_pct: number;
  annualized_volatility_pct: number;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: {
    pct: number;
    peak_month: string;
    trough_month: string;
    peak_value: number;
    trough_value: number;
    recovered: boolean;
  };
  risk_free_rate_pct: number;
}

export function calculateRiskMetrics(
  db: FinanceDB,
  options: { risk_free_rate?: number; months?: number } = {}
): RiskMetricsResult | { error: string } {
  const riskFreeRate = options.risk_free_rate ?? 4.5;
  const monthlyValues = getMonthlyPortfolioValues(db, options.months);

  if (monthlyValues.length < 3) {
    return { error: `Insufficient data: need at least 3 months of balance history, found ${monthlyValues.length}` };
  }

  const values = monthlyValues.map((v) => ({ value: v.investment_value, month: v.month }));
  const returns = computeMonthlyReturns(values);

  if (returns.length < 2) {
    return { error: `Insufficient return data: need at least 2 monthly returns, found ${returns.length}` };
  }

  const returnValues = returns.map((r) => r.return_pct);
  const meanMonthly = mean(returnValues);
  const stdMonthly = stdDev(returnValues, meanMonthly);

  const annualizedReturn = roundMoney(meanMonthly * 12);
  const annualizedVol = roundMoney(stdMonthly * Math.sqrt(12));

  // Sharpe: (annualized return - risk-free rate) / annualized volatility
  const sharpe = annualizedVol > 0 ? roundMoney((annualizedReturn - riskFreeRate) / annualizedVol) : null;

  // Sortino: uses only downside deviation
  const monthlyRiskFree = riskFreeRate / 12;
  const downsideReturns = returnValues.filter((r) => r < monthlyRiskFree);
  let sortino: number | null = null;
  if (downsideReturns.length > 0) {
    const downsideDev = Math.sqrt(
      downsideReturns.reduce((s, r) => s + (r - monthlyRiskFree) ** 2, 0) / returnValues.length
    );
    const annualizedDownsideDev = downsideDev * Math.sqrt(12);
    sortino = annualizedDownsideDev > 0
      ? roundMoney((annualizedReturn - riskFreeRate) / annualizedDownsideDev)
      : null;
  }

  // Max drawdown from investment values
  let peak = values[0].value;
  let peakMonth = values[0].month;
  let maxDd = 0;
  let ddPeakMonth = values[0].month;
  let ddTroughMonth = values[0].month;
  let ddPeakValue = values[0].value;
  let ddTroughValue = values[0].value;

  for (const v of values) {
    if (v.value > peak) {
      peak = v.value;
      peakMonth = v.month;
    }
    const dd = peak > 0 ? ((peak - v.value) / peak) * 100 : 0;
    if (dd > maxDd) {
      maxDd = dd;
      ddPeakMonth = peakMonth;
      ddTroughMonth = v.month;
      ddPeakValue = peak;
      ddTroughValue = v.value;
    }
  }

  // Check recovery
  const troughIdx = values.findIndex((v) => v.month === ddTroughMonth);
  const recovered = values.slice(troughIdx + 1).some((v) => v.value >= ddPeakValue);

  return {
    period: { from: monthlyValues[0].month, to: monthlyValues[monthlyValues.length - 1].month },
    data_points: monthlyValues.length,
    monthly_returns: returns.map((r) => ({ month: r.month, return_pct: roundMoney(r.return_pct) })),
    annualized_return_pct: annualizedReturn,
    annualized_volatility_pct: annualizedVol,
    sharpe_ratio: sharpe,
    sortino_ratio: sortino,
    max_drawdown: {
      pct: roundMoney(maxDd),
      peak_month: ddPeakMonth,
      trough_month: ddTroughMonth,
      peak_value: roundMoney(ddPeakValue),
      trough_value: roundMoney(ddTroughValue),
      recovered,
    },
    risk_free_rate_pct: riskFreeRate,
  };
}

// --- Concentration ---

export interface ConcentrationResult {
  as_of: string;
  total_value: number;
  position_count: number;
  hhi: number;
  effective_positions: number;
  top_holdings: {
    symbol: string;
    name: string | null;
    account: string;
    value: number;
    weight_pct: number;
    flag: "high" | "elevated" | null;
  }[];
  concentration_flags: {
    symbol: string;
    weight_pct: number;
    level: "high" | "elevated";
    threshold_pct: number;
  }[];
  diversification_rating: "well_diversified" | "moderately_concentrated" | "concentrated" | "highly_concentrated";
}

export function calculateConcentration(
  db: FinanceDB,
  options: { as_of?: string; top_n?: number } = {}
): ConcentrationResult | { error: string } {
  const asOf = options.as_of || today();
  const topN = options.top_n ?? 10;

  const holdingsResult = db.getHoldings({ as_of: asOf });
  const holdings = holdingsResult.holdings || [];
  const totalValue = holdingsResult.total_value;

  if (holdings.length === 0 || totalValue === 0) {
    return { error: "No holdings found" };
  }

  // Compute weights and HHI
  const weights = holdings.map((h) => ((h.current_value as number) || 0) / totalValue);
  const hhi = roundMoney(weights.reduce((s, w) => s + w * w, 0) * 10000);
  const effectivePositions = roundMoney(1 / (weights.reduce((s, w) => s + w * w, 0)));

  // Top holdings
  const topHoldings = holdings.slice(0, topN).map((h) => {
    const value = (h.current_value as number) || 0;
    const weightPct = roundMoney((value / totalValue) * 100);
    let flag: "high" | "elevated" | null = null;
    if (weightPct >= 20) flag = "high";
    else if (weightPct >= 10) flag = "elevated";

    return {
      symbol: h.symbol as string,
      name: (h.name as string) || null,
      account: h.account_name as string,
      value: roundMoney(value),
      weight_pct: weightPct,
      flag,
    };
  });

  // Concentration flags
  const flags = topHoldings
    .filter((h) => h.flag !== null)
    .map((h) => ({
      symbol: h.symbol,
      weight_pct: h.weight_pct,
      level: h.flag as "high" | "elevated",
      threshold_pct: h.flag === "high" ? 20 : 10,
    }));

  // Diversification rating
  let rating: ConcentrationResult["diversification_rating"];
  if (effectivePositions >= 20) rating = "well_diversified";
  else if (effectivePositions >= 10) rating = "moderately_concentrated";
  else if (effectivePositions >= 5) rating = "concentrated";
  else rating = "highly_concentrated";

  return {
    as_of: asOf,
    total_value: roundMoney(totalValue),
    position_count: holdings.length,
    hhi,
    effective_positions: effectivePositions,
    top_holdings: topHoldings,
    concentration_flags: flags,
    diversification_rating: rating,
  };
}

// --- Monte Carlo ---

export interface MonteCarloResult {
  assumptions: {
    observed_mean_monthly_return_pct: number;
    observed_monthly_volatility_pct: number;
    simulations: number;
    months: number;
    monthly_contribution: number;
    starting_value: number;
    total_invested: number;
  };
  percentile_bands: {
    year: number;
    month: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  }[];
  probability_of_loss: number;
  median_final_value: number;
  median_total_return_pct: number;
}

export function runMonteCarlo(
  db: FinanceDB,
  options: {
    simulations?: number;
    months?: number;
    monthly_contribution?: number;
  } = {}
): MonteCarloResult | { error: string } {
  const numSims = Math.min(options.simulations ?? 1000, 10000);
  const projMonths = options.months ?? 120;
  const monthlyContribution = options.monthly_contribution ?? 0;

  // Get historical data
  const monthlyValues = getMonthlyPortfolioValues(db);
  if (monthlyValues.length < 6) {
    return { error: `Insufficient data: need at least 6 months of balance history for Monte Carlo, found ${monthlyValues.length}` };
  }

  const values = monthlyValues.map((v) => ({ value: v.investment_value, month: v.month }));
  const returns = computeMonthlyReturns(values);
  if (returns.length < 3) {
    return { error: `Insufficient return data: need at least 3 monthly returns, found ${returns.length}` };
  }

  const returnValues = returns.map((r) => r.return_pct / 100);
  const meanReturn = mean(returnValues);
  const stdReturn = Math.max(stdDev(returnValues, meanReturn), 0.001);

  // Current portfolio value
  const startingValue = values[values.length - 1].value;
  if (startingValue <= 0) {
    return { error: "Current investment portfolio value is zero" };
  }

  // Yearly checkpoints
  const checkpoints = new Set<number>();
  for (let m = 12; m <= projMonths; m += 12) {
    checkpoints.add(m);
  }
  if (!checkpoints.has(projMonths)) {
    checkpoints.add(projMonths);
  }

  // Run simulations
  const resultsByMonth = new Map<number, number[]>();
  for (const cp of checkpoints) {
    resultsByMonth.set(cp, []);
  }

  for (let sim = 0; sim < numSims; sim++) {
    let value = startingValue;
    for (let m = 1; m <= projMonths; m++) {
      const r = normalRandom(meanReturn, stdReturn);
      value = value * (1 + r) + monthlyContribution;
      if (value < 0) value = 0;
      if (checkpoints.has(m)) {
        resultsByMonth.get(m)!.push(value);
      }
    }
  }

  // Compute percentiles
  const bands: MonteCarloResult["percentile_bands"] = [];
  for (const cp of Array.from(checkpoints).sort((a, b) => a - b)) {
    const vals = resultsByMonth.get(cp)!.sort((a, b) => a - b);
    bands.push({
      year: Math.round((cp / 12) * 10) / 10,
      month: cp,
      p10: roundMoney(percentile(vals, 10)),
      p25: roundMoney(percentile(vals, 25)),
      p50: roundMoney(percentile(vals, 50)),
      p75: roundMoney(percentile(vals, 75)),
      p90: roundMoney(percentile(vals, 90)),
    });
  }

  // Final stats
  const finalValues = resultsByMonth.get(projMonths)!;
  const finalSorted = finalValues.sort((a, b) => a - b);
  const medianFinal = percentile(finalSorted, 50);
  const totalInvested = startingValue + monthlyContribution * projMonths;
  const lossCount = finalValues.filter((v) => v < totalInvested).length;

  return {
    assumptions: {
      observed_mean_monthly_return_pct: roundMoney(meanReturn * 100),
      observed_monthly_volatility_pct: roundMoney(stdReturn * 100),
      simulations: numSims,
      months: projMonths,
      monthly_contribution: monthlyContribution,
      starting_value: roundMoney(startingValue),
      total_invested: roundMoney(totalInvested),
    },
    percentile_bands: bands,
    probability_of_loss: roundMoney((lossCount / numSims) * 100),
    median_final_value: roundMoney(medianFinal),
    median_total_return_pct: roundMoney(((medianFinal - totalInvested) / totalInvested) * 100),
  };
}

// --- Financial Independence ---

export interface FinancialIndependenceResult {
  annual_spending: number;
  spending_source: "calculated" | "override";
  withdrawal_rate_pct: number;
  fi_number: number;
  current_investment_total: number;
  current_net_worth: number;
  fi_progress_pct: number;
  fi_achieved: boolean;
  surplus_or_deficit: number;
  years_of_expenses_covered: number;
  projected_fi_date: string | null;
  months_to_fi: number | null;
  assumptions: {
    annual_return_pct: number;
    monthly_savings: number;
    monthly_expenses: number;
    monthly_income: number;
  };
  withdrawal_analysis: {
    rate_pct: number;
    annual_income: number;
    monthly_income: number;
  }[];
}

export function calculateFinancialIndependence(
  db: FinanceDB,
  options: {
    annual_spending?: number;
    withdrawal_rate?: number;
    investment_return?: number;
    lookback_months?: number;
  } = {}
): FinancialIndependenceResult | { error: string } {
  const withdrawalRate = options.withdrawal_rate ?? 4.0;
  const investmentReturn = options.investment_return ?? 7.0;
  const lookbackMonths = options.lookback_months ?? 12;

  // Current balances
  const balances = db.getBalances();
  let investmentTotal = 0;
  let netWorth = 0;
  for (const b of balances) {
    const bal = (b.balance as number) || 0;
    if (b.is_asset) {
      netWorth += bal;
      if (b.is_investment) investmentTotal += bal;
    } else {
      netWorth -= Math.abs(bal);
    }
  }

  // Spending calculation
  let annualSpending: number;
  let spendingSource: "calculated" | "override";
  let monthlyIncome = 0;
  let monthlyExpenses = 0;

  if (options.annual_spending !== undefined) {
    annualSpending = options.annual_spending;
    spendingSource = "override";
    // Still get income/expense for context
    const dateTo = today();
    const dateFrom = addMonths(dateTo, -lookbackMonths);
    const totals = db.getMonthlyTotals(dateFrom, dateTo);
    if (totals.length > 0) {
      const totalIncome = totals.reduce((s, t) => s + ((t.income as number) || 0), 0);
      const totalExpenses = totals.reduce((s, t) => s + ((t.expenses as number) || 0), 0);
      monthlyIncome = totalIncome / totals.length;
      monthlyExpenses = totalExpenses / totals.length;
    }
  } else {
    const dateTo = today();
    const dateFrom = addMonths(dateTo, -lookbackMonths);
    const totals = db.getMonthlyTotals(dateFrom, dateTo);
    if (totals.length === 0) {
      return { error: "No spending data found. Provide annual_spending override or import transactions." };
    }
    const totalExpenses = totals.reduce((s, t) => s + ((t.expenses as number) || 0), 0);
    const totalIncome = totals.reduce((s, t) => s + ((t.income as number) || 0), 0);
    monthlyExpenses = totalExpenses / totals.length;
    monthlyIncome = totalIncome / totals.length;
    annualSpending = monthlyExpenses * 12;
    spendingSource = "calculated";
  }

  if (annualSpending <= 0) {
    return { error: "Annual spending must be positive" };
  }

  // FI number
  const fiNumber = annualSpending / (withdrawalRate / 100);
  const fiProgressPct = (investmentTotal / fiNumber) * 100;
  const fiAchieved = investmentTotal >= fiNumber;
  const surplus = investmentTotal - fiNumber;
  const yearsOfExpenses = investmentTotal / annualSpending;

  // Monthly savings
  const monthlySavings = monthlyIncome - monthlyExpenses;

  // Project FI date
  let projectedFiDate: string | null = null;
  let monthsToFi: number | null = null;

  if (!fiAchieved && monthlySavings > 0) {
    const monthlyReturn = investmentReturn / 12 / 100;
    let projected = investmentTotal;
    for (let m = 1; m <= 1200; m++) {
      projected = projected * (1 + monthlyReturn) + monthlySavings;
      if (projected >= fiNumber) {
        monthsToFi = m;
        projectedFiDate = addMonths(today(), m);
        break;
      }
    }
  }

  // Withdrawal analysis at various rates
  const rates = [3.0, 3.5, 4.0, 4.5, 5.0];
  const withdrawalAnalysis = rates.map((rate) => {
    const annual = investmentTotal * (rate / 100);
    return {
      rate_pct: rate,
      annual_income: roundMoney(annual),
      monthly_income: roundMoney(annual / 12),
    };
  });

  return {
    annual_spending: roundMoney(annualSpending),
    spending_source: spendingSource,
    withdrawal_rate_pct: withdrawalRate,
    fi_number: roundMoney(fiNumber),
    current_investment_total: roundMoney(investmentTotal),
    current_net_worth: roundMoney(netWorth),
    fi_progress_pct: roundMoney(Math.min(fiProgressPct, 999)),
    fi_achieved: fiAchieved,
    surplus_or_deficit: roundMoney(surplus),
    years_of_expenses_covered: roundMoney(yearsOfExpenses),
    projected_fi_date: projectedFiDate,
    months_to_fi: monthsToFi,
    assumptions: {
      annual_return_pct: investmentReturn,
      monthly_savings: roundMoney(monthlySavings),
      monthly_expenses: roundMoney(monthlyExpenses),
      monthly_income: roundMoney(monthlyIncome),
    },
    withdrawal_analysis: withdrawalAnalysis,
  };
}
