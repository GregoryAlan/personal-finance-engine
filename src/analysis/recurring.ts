import type { FinanceDB } from "../db/database.js";
import { addMonths, today } from "../utils/dates.js";
import { roundMoney } from "../utils/money.js";

export interface RecurringDetectionResult {
  detected: DetectedPattern[];
  total_monthly_subscriptions: number;
  total_monthly_income: number;
}

interface DetectedPattern {
  description: string;
  frequency: string;
  typical_amount: number;
  amount_variance: number;
  occurrences: number;
  last_seen: string;
  next_expected: string;
  is_income: boolean;
  monthly_cost: number;
}

export function detectRecurring(db: FinanceDB, lookbackMonths: number = 6): RecurringDetectionResult {
  const dateFrom = addMonths(today(), -lookbackMonths);
  const dateTo = today();

  // Get all transactions grouped by merchant (or description as fallback)
  const grouped = db.db
    .prepare(
      `SELECT COALESCE(merchant, description) as description,
        COUNT(*) as count,
        AVG(amount) as avg_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount,
        MIN(date) as first_date,
        MAX(date) as last_date,
        GROUP_CONCAT(date, ',') as dates,
        GROUP_CONCAT(amount, ',') as amounts
      FROM transactions
      WHERE date >= ? AND date <= ? AND is_excluded = 0
      GROUP BY COALESCE(merchant, description)
      HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC`
    )
    .all(dateFrom, dateTo) as Record<string, unknown>[];

  const detected: DetectedPattern[] = [];

  for (const group of grouped) {
    const dates = (group.dates as string).split(",").sort();
    const amounts = (group.amounts as string).split(",").map(Number);
    const count = group.count as number;

    if (count < 2) continue;

    // Calculate intervals between consecutive dates
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.ceil(
        (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000
      );
      intervals.push(diff);
    }

    if (intervals.length === 0) continue;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const intervalVariance =
      intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const intervalStdDev = Math.sqrt(intervalVariance);

    // Only consider patterns with reasonably consistent intervals
    if (intervalStdDev > avgInterval * 0.5 && count < 4) continue;

    // Determine frequency
    let frequency: string;
    let monthlyMultiplier: number;

    if (avgInterval <= 10) {
      frequency = "weekly";
      monthlyMultiplier = 4.33;
    } else if (avgInterval <= 18) {
      frequency = "biweekly";
      monthlyMultiplier = 2.17;
    } else if (avgInterval <= 45) {
      frequency = "monthly";
      monthlyMultiplier = 1;
    } else if (avgInterval <= 100) {
      frequency = "quarterly";
      monthlyMultiplier = 1 / 3;
    } else {
      frequency = "annual";
      monthlyMultiplier = 1 / 12;
    }

    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountVariance =
      amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
    const amountStdDev = Math.sqrt(amountVariance);

    const isIncome = avgAmount > 0;
    const lastDate = dates[dates.length - 1];
    const nextExpected = new Date(lastDate);
    nextExpected.setDate(nextExpected.getDate() + Math.round(avgInterval));

    const pattern: DetectedPattern = {
      description: group.description as string,
      frequency,
      typical_amount: roundMoney(avgAmount),
      amount_variance: roundMoney(amountStdDev),
      occurrences: count,
      last_seen: lastDate,
      next_expected: nextExpected.toISOString().slice(0, 10),
      is_income: isIncome,
      monthly_cost: roundMoney(Math.abs(avgAmount) * monthlyMultiplier),
    };

    detected.push(pattern);

    // Persist to DB
    db.upsertRecurring({
      description_pattern: pattern.description,
      frequency: pattern.frequency,
      typical_amount: pattern.typical_amount,
      amount_variance: pattern.amount_variance,
      last_seen: pattern.last_seen,
      next_expected: pattern.next_expected,
      is_income: pattern.is_income,
    });
  }

  const subscriptions = detected.filter((d) => !d.is_income);
  const incomePatterns = detected.filter((d) => d.is_income);

  return {
    detected,
    total_monthly_subscriptions: roundMoney(
      subscriptions.reduce((sum, s) => sum + s.monthly_cost, 0)
    ),
    total_monthly_income: roundMoney(
      incomePatterns.reduce((sum, s) => sum + s.monthly_cost, 0)
    ),
  };
}
