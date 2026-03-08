import type { FinanceDB } from "../db/database.js";
import { roundMoney } from "../utils/money.js";
import { today, addMonths, monthsBetween } from "../utils/dates.js";

export interface DriftItem {
  asset_class: string;
  current_value: number;
  current_pct: number;
  target_pct: number;
  drift_pct: number;
  drift_amount: number;
  action: "buy" | "sell" | "hold";
}

export interface RebalanceTrade {
  asset_class: string;
  action: "buy" | "sell";
  amount: number;
}

export interface AllocationDriftResult {
  target_name: string;
  as_of: string;
  total_investment_value: number;
  drift: DriftItem[];
  rebalance_trades: RebalanceTrade[];
  max_drift_pct: number;
}

export function calculateAllocationDrift(
  db: FinanceDB,
  targetName: string = "default",
  asOf?: string
): AllocationDriftResult | { error: string } {
  const targets = db.getAllocationTargets(targetName);
  if (targets.length === 0) {
    return { error: `No allocation targets found for profile '${targetName}'` };
  }

  const holdingsResult = db.getHoldings({ group_by: "asset_class", as_of: asOf });
  const totalValue = holdingsResult.total_value;

  if (totalValue === 0) {
    return { error: "No holdings found to calculate drift" };
  }

  // Build current allocation map
  const currentAlloc = new Map<string, number>();
  for (const g of holdingsResult.groups || []) {
    const key = (g.group_key as string) || "other";
    currentAlloc.set(key, (g.total_value as number) || 0);
  }

  const drift: DriftItem[] = [];
  const rebalanceTrades: RebalanceTrade[] = [];

  // Track asset classes covered by targets
  const targetClasses = new Set<string>();

  for (const t of targets) {
    const assetClass = t.asset_class as string;
    const targetPct = t.target_pct as number;
    targetClasses.add(assetClass);

    const currentValue = currentAlloc.get(assetClass) || 0;
    const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const driftPct = currentPct - targetPct;
    const targetValue = totalValue * (targetPct / 100);
    const driftAmount = currentValue - targetValue;

    const action: "buy" | "sell" | "hold" =
      Math.abs(driftPct) < 0.5 ? "hold" : driftPct > 0 ? "sell" : "buy";

    drift.push({
      asset_class: assetClass,
      current_value: roundMoney(currentValue),
      current_pct: roundMoney(currentPct),
      target_pct: roundMoney(targetPct),
      drift_pct: roundMoney(driftPct),
      drift_amount: roundMoney(driftAmount),
      action,
    });

    if (action !== "hold") {
      rebalanceTrades.push({
        asset_class: assetClass,
        action: driftAmount > 0 ? "sell" : "buy",
        amount: roundMoney(Math.abs(driftAmount)),
      });
    }
  }

  // Include any current holdings not in targets
  for (const [assetClass, value] of currentAlloc) {
    if (!targetClasses.has(assetClass)) {
      const currentPct = (value / totalValue) * 100;
      drift.push({
        asset_class: assetClass,
        current_value: roundMoney(value),
        current_pct: roundMoney(currentPct),
        target_pct: 0,
        drift_pct: roundMoney(currentPct),
        drift_amount: roundMoney(value),
        action: "sell",
      });
      rebalanceTrades.push({
        asset_class: assetClass,
        action: "sell",
        amount: roundMoney(value),
      });
    }
  }

  const maxDrift = drift.reduce((max, d) => Math.max(max, Math.abs(d.drift_pct)), 0);

  return {
    target_name: targetName,
    as_of: asOf || today(),
    total_investment_value: roundMoney(totalValue),
    drift,
    rebalance_trades: rebalanceTrades.sort((a, b) => b.amount - a.amount),
    max_drift_pct: roundMoney(maxDrift),
  };
}

export interface PerformanceResult {
  date_from: string;
  date_to: string;
  start_value: number;
  end_value: number;
  absolute_return: number;
  percentage_return: number;
  annualized_return: number | null;
  by_asset_class: {
    asset_class: string;
    start_value: number;
    end_value: number;
    change: number;
    change_pct: number;
  }[];
}

export function calculatePerformance(
  db: FinanceDB,
  dateFrom: string,
  dateTo: string
): PerformanceResult | { error: string } {
  const startHoldings = db.getHoldingsAtDate(dateFrom);
  const endHoldings = db.getHoldingsAtDate(dateTo);

  if (startHoldings.length === 0 && endHoldings.length === 0) {
    return { error: "No holdings snapshots found for the given period" };
  }

  // Sum start and end values
  const startValue = startHoldings.reduce((sum, h) => sum + ((h.current_value as number) || 0), 0);
  const endValue = endHoldings.reduce((sum, h) => sum + ((h.current_value as number) || 0), 0);
  const absoluteReturn = endValue - startValue;
  const percentageReturn = startValue > 0 ? (absoluteReturn / startValue) * 100 : 0;

  // Annualize if period > 1 year
  const months = monthsBetween(dateFrom, dateTo);
  let annualizedReturn: number | null = null;
  if (months >= 12 && startValue > 0) {
    const years = months / 12;
    annualizedReturn = roundMoney((Math.pow(endValue / startValue, 1 / years) - 1) * 100);
  }

  // Breakdown by asset class
  const startByClass = new Map<string, number>();
  for (const h of startHoldings) {
    const cls = (h.asset_class as string) || "other";
    startByClass.set(cls, (startByClass.get(cls) || 0) + ((h.current_value as number) || 0));
  }
  const endByClass = new Map<string, number>();
  for (const h of endHoldings) {
    const cls = (h.asset_class as string) || "other";
    endByClass.set(cls, (endByClass.get(cls) || 0) + ((h.current_value as number) || 0));
  }

  const allClasses = new Set([...startByClass.keys(), ...endByClass.keys()]);
  const byAssetClass = Array.from(allClasses).map((cls) => {
    const sv = startByClass.get(cls) || 0;
    const ev = endByClass.get(cls) || 0;
    const change = ev - sv;
    return {
      asset_class: cls,
      start_value: roundMoney(sv),
      end_value: roundMoney(ev),
      change: roundMoney(change),
      change_pct: sv > 0 ? roundMoney((change / sv) * 100) : 0,
    };
  });

  return {
    date_from: dateFrom,
    date_to: dateTo,
    start_value: roundMoney(startValue),
    end_value: roundMoney(endValue),
    absolute_return: roundMoney(absoluteReturn),
    percentage_return: roundMoney(percentageReturn),
    annualized_return: annualizedReturn,
    by_asset_class: byAssetClass.sort(
      (a, b) => Math.abs(b.change) - Math.abs(a.change)
    ),
  };
}

export interface ContributionDecomposition {
  date_from: string;
  date_to: string;
  net_worth_start: number;
  net_worth_end: number;
  net_worth_change: number;
  net_contributions: number;
  investment_growth: number;
  growth_pct_of_change: number | null;
  income_total: number;
  expense_total: number;
  savings_rate: number | null;
}

export function decomposeContributionsVsGrowth(
  db: FinanceDB,
  dateFrom: string,
  dateTo: string
): ContributionDecomposition {
  // Get net worth at start and end via balance snapshots
  const startBalances = db.getBalances(dateFrom);
  const endBalances = db.getBalances(dateTo);

  let startNetWorth = 0;
  for (const b of startBalances) {
    const bal = (b.balance as number) || 0;
    if (b.is_asset) startNetWorth += bal;
    else startNetWorth -= Math.abs(bal);
  }

  let endNetWorth = 0;
  for (const b of endBalances) {
    const bal = (b.balance as number) || 0;
    if (b.is_asset) endNetWorth += bal;
    else endNetWorth -= Math.abs(bal);
  }

  const netWorthChange = endNetWorth - startNetWorth;

  // Get transactions categorized as transfer > investment contribution
  const contributions = db.db
    .prepare(
      `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ? AND t.date <= ?
        AND t.is_excluded = 0
        AND c.full_path LIKE 'Transfer > Investment%'
        AND t.amount > 0`
    )
    .get(dateFrom, dateTo) as { total: number };

  const netContributions = contributions.total || 0;
  const investmentGrowth = netWorthChange - netContributions;

  // Get income and expenses for savings rate
  const income = db.db
    .prepare(
      `SELECT COALESCE(SUM(t.amount), 0) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ? AND t.date <= ?
        AND t.is_excluded = 0
        AND t.amount > 0
        AND c.type = 'income'
        AND t.transfer_pair_id IS NULL`
    )
    .get(dateFrom, dateTo) as { total: number };

  const expenses = db.db
    .prepare(
      `SELECT COALESCE(SUM(t.amount), 0) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ? AND t.date <= ?
        AND t.is_excluded = 0
        AND t.amount < 0
        AND (c.type = 'expense' OR c.type IS NULL)
        AND t.transfer_pair_id IS NULL
        AND (c.type IS NULL OR c.type != 'transfer')`
    )
    .get(dateFrom, dateTo) as { total: number };

  const incomeTotal = income.total || 0;
  const expenseTotal = Math.abs(expenses.total || 0);

  return {
    date_from: dateFrom,
    date_to: dateTo,
    net_worth_start: roundMoney(startNetWorth),
    net_worth_end: roundMoney(endNetWorth),
    net_worth_change: roundMoney(netWorthChange),
    net_contributions: roundMoney(netContributions),
    investment_growth: roundMoney(investmentGrowth),
    growth_pct_of_change:
      netWorthChange !== 0
        ? roundMoney((investmentGrowth / Math.abs(netWorthChange)) * 100)
        : null,
    income_total: roundMoney(incomeTotal),
    expense_total: roundMoney(expenseTotal),
    savings_rate:
      incomeTotal > 0
        ? roundMoney(((incomeTotal - expenseTotal) / incomeTotal) * 100)
        : null,
  };
}

export interface MilestoneProgress {
  id: number;
  name: string;
  target_amount: number;
  target_type: string;
  account_name: string | null;
  current_value: number;
  progress_pct: number;
  amount_remaining: number;
  achieved: boolean;
  achieved_at: string | null;
  projected_date: string | null;
}

export function checkMilestones(db: FinanceDB): MilestoneProgress[] {
  const milestones = db.listMilestones();
  if (milestones.length === 0) return [];

  // Get current values
  const balances = db.getBalances();
  let currentNetWorth = 0;
  let investmentTotal = 0;
  const accountBalances = new Map<number, number>();

  for (const b of balances) {
    const bal = (b.balance as number) || 0;
    const id = b.id as number;
    accountBalances.set(id, bal);
    if (b.is_asset) {
      currentNetWorth += bal;
      if (b.is_investment) investmentTotal += bal;
    } else {
      currentNetWorth -= Math.abs(bal);
    }
  }

  // Get 3-month growth rate for projections
  const threeMonthsAgo = addMonths(today(), -3);
  const pastBalances = db.getBalances(threeMonthsAgo);
  let pastNetWorth = 0;
  let pastInvestmentTotal = 0;
  const pastAccountBalances = new Map<number, number>();

  for (const b of pastBalances) {
    const bal = (b.balance as number) || 0;
    const id = b.id as number;
    pastAccountBalances.set(id, bal);
    if (b.is_asset) {
      pastNetWorth += bal;
      if (b.is_investment) pastInvestmentTotal += bal;
    } else {
      pastNetWorth -= Math.abs(bal);
    }
  }

  const results: MilestoneProgress[] = [];

  for (const m of milestones) {
    const targetAmount = m.target_amount as number;
    const targetType = m.target_type as string;
    const accountId = m.account_id as number | null;

    let currentValue: number;
    let pastValue: number;

    switch (targetType) {
      case "net_worth":
        currentValue = currentNetWorth;
        pastValue = pastNetWorth;
        break;
      case "investment_total":
        currentValue = investmentTotal;
        pastValue = pastInvestmentTotal;
        break;
      case "account":
        currentValue = accountId ? (accountBalances.get(accountId) || 0) : 0;
        pastValue = accountId ? (pastAccountBalances.get(accountId) || 0) : 0;
        break;
      default:
        currentValue = 0;
        pastValue = 0;
    }

    const progressPct = targetAmount > 0 ? (currentValue / targetAmount) * 100 : 0;
    const amountRemaining = Math.max(0, targetAmount - currentValue);
    const achieved = currentValue >= targetAmount;

    // Project date based on monthly growth
    let projectedDate: string | null = null;
    if (!achieved && amountRemaining > 0) {
      const monthlyGrowth = (currentValue - pastValue) / 3;
      if (monthlyGrowth > 0) {
        const monthsToTarget = Math.ceil(amountRemaining / monthlyGrowth);
        projectedDate = addMonths(today(), monthsToTarget);
      }
    }

    // Mark as achieved if newly achieved
    if (achieved && !m.achieved_at) {
      db.updateMilestone(m.id as number, { achieved_at: today() });
    }

    results.push({
      id: m.id as number,
      name: m.name as string,
      target_amount: targetAmount,
      target_type: targetType,
      account_name: (m.account_name as string) || null,
      current_value: roundMoney(currentValue),
      progress_pct: roundMoney(Math.min(progressPct, 100)),
      amount_remaining: roundMoney(amountRemaining),
      achieved,
      achieved_at: (m.achieved_at as string) || null,
      projected_date: projectedDate,
    });
  }

  return results;
}
