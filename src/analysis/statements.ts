import type { FinanceDB } from "../db/database.js";
import { addMonths, today } from "../utils/dates.js";
import { roundMoney } from "../utils/money.js";

export interface FinancialStatement {
  type: "balance_sheet" | "income_statement" | "cash_flow";
  period: { start: string; end: string };
  comparison_period?: { start: string; end: string };
  data: Record<string, unknown>;
}

export function generateBalanceSheet(
  db: FinanceDB,
  asOf?: string
): FinancialStatement {
  const date = asOf || today();
  const balances = db.getBalances(date);

  let totalAssets = 0;
  let totalLiabilities = 0;
  const assets: Record<string, unknown>[] = [];
  const liabilities: Record<string, unknown>[] = [];

  for (const acct of balances) {
    const balance = (acct.balance as number) || 0;
    if (acct.is_asset) {
      assets.push({ name: acct.name, type: acct.type, balance });
      totalAssets += balance;
    } else {
      liabilities.push({ name: acct.name, type: acct.type, balance: Math.abs(balance) });
      totalLiabilities += Math.abs(balance);
    }
  }

  return {
    type: "balance_sheet",
    period: { start: date, end: date },
    data: {
      assets,
      total_assets: roundMoney(totalAssets),
      liabilities,
      total_liabilities: roundMoney(totalLiabilities),
      net_worth: roundMoney(totalAssets - totalLiabilities),
    },
  };
}

export function generateIncomeStatement(
  db: FinanceDB,
  dateFrom: string,
  dateTo: string,
  compareTo?: { start: string; end: string }
): FinancialStatement {
  const income = db.getTransactionsForPeriod(dateFrom, dateTo, "income");
  const expenses = db.getTransactionsForPeriod(dateFrom, dateTo, "expense");

  const incomeByCategory = groupByCategory(income);
  const expenseByCategory = groupByCategory(expenses);

  const totalIncome = income.reduce((sum, t) => sum + ((t.amount as number) || 0), 0);
  const totalExpenses = expenses.reduce((sum, t) => sum + Math.abs((t.amount as number) || 0), 0);

  const data: Record<string, unknown> = {
    income: incomeByCategory,
    total_income: roundMoney(totalIncome),
    expenses: expenseByCategory,
    total_expenses: roundMoney(totalExpenses),
    net_income: roundMoney(totalIncome - totalExpenses),
    savings_rate: totalIncome > 0 ? roundMoney(((totalIncome - totalExpenses) / totalIncome) * 100) : 0,
  };

  const result: FinancialStatement = {
    type: "income_statement",
    period: { start: dateFrom, end: dateTo },
    data,
  };

  if (compareTo) {
    const prevIncome = db.getTransactionsForPeriod(compareTo.start, compareTo.end, "income");
    const prevExpenses = db.getTransactionsForPeriod(compareTo.start, compareTo.end, "expense");
    const prevTotalIncome = prevIncome.reduce((sum, t) => sum + ((t.amount as number) || 0), 0);
    const prevTotalExpenses = prevExpenses.reduce((sum, t) => sum + Math.abs((t.amount as number) || 0), 0);

    result.comparison_period = compareTo;
    data.comparison = {
      income: groupByCategory(prevIncome),
      total_income: roundMoney(prevTotalIncome),
      expenses: groupByCategory(prevExpenses),
      total_expenses: roundMoney(prevTotalExpenses),
      net_income: roundMoney(prevTotalIncome - prevTotalExpenses),
      income_change_pct: prevTotalIncome > 0 ? roundMoney(((totalIncome - prevTotalIncome) / prevTotalIncome) * 100) : null,
      expense_change_pct: prevTotalExpenses > 0 ? roundMoney(((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100) : null,
    };
  }

  return result;
}

export function generateCashFlow(
  db: FinanceDB,
  dateFrom: string,
  dateTo: string
): FinancialStatement {
  const monthly = db.getMonthlyTotals(dateFrom, dateTo);

  let cumulativeNet = 0;
  const monthlyWithCumulative = monthly.map((m) => {
    cumulativeNet += (m.net as number) || 0;
    return { ...m, cumulative_net: roundMoney(cumulativeNet) };
  });

  const totalIncome = monthly.reduce((sum, m) => sum + ((m.income as number) || 0), 0);
  const totalExpenses = monthly.reduce((sum, m) => sum + ((m.expenses as number) || 0), 0);
  const monthCount = monthly.length || 1;

  return {
    type: "cash_flow",
    period: { start: dateFrom, end: dateTo },
    data: {
      monthly: monthlyWithCumulative,
      total_income: roundMoney(totalIncome),
      total_expenses: roundMoney(totalExpenses),
      total_net: roundMoney(totalIncome - totalExpenses),
      avg_monthly_income: roundMoney(totalIncome / monthCount),
      avg_monthly_expenses: roundMoney(totalExpenses / monthCount),
      avg_monthly_net: roundMoney((totalIncome - totalExpenses) / monthCount),
    },
  };
}

function groupByCategory(transactions: Record<string, unknown>[]): Record<string, number> {
  const grouped: Record<string, number> = {};
  for (const t of transactions) {
    const cat = (t.category_path as string) || "Uncategorized";
    const topLevel = cat.split(" > ")[0];
    grouped[topLevel] = roundMoney((grouped[topLevel] || 0) + Math.abs((t.amount as number) || 0));
  }
  return grouped;
}
