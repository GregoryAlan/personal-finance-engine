import type { FinanceDB } from "../db/database.js";
import { roundMoney } from "../utils/money.js";

export interface SpendingBreakdown {
  period: { start: string; end: string };
  total_spending: number;
  by_category: CategorySpending[];
  top_merchants: MerchantSpending[];
  daily_average: number;
}

interface CategorySpending {
  category: string;
  total: number;
  count: number;
  pct_of_total: number;
  subcategories?: CategorySpending[];
}

interface MerchantSpending {
  description: string;
  total: number;
  count: number;
}

export function analyzeSpending(
  db: FinanceDB,
  dateFrom: string,
  dateTo: string,
  drillCategory?: string
): SpendingBreakdown {
  const expenses = db.getTransactionsForPeriod(dateFrom, dateTo, "expense");

  let filtered = expenses;
  if (drillCategory) {
    filtered = expenses.filter((t) => {
      const path = (t.category_path as string) || "";
      return path.startsWith(drillCategory);
    });
  }

  const totalSpending = filtered.reduce((sum, t) => sum + Math.abs((t.amount as number) || 0), 0);

  // Group by top-level category
  const catMap = new Map<string, { total: number; count: number; subs: Map<string, { total: number; count: number }> }>();

  for (const t of filtered) {
    const path = (t.category_path as string) || "Uncategorized";
    const parts = path.split(" > ");
    const topLevel = parts[0];
    const sub = parts.length > 1 ? path : null;
    const amt = Math.abs((t.amount as number) || 0);

    if (!catMap.has(topLevel)) {
      catMap.set(topLevel, { total: 0, count: 0, subs: new Map() });
    }
    const cat = catMap.get(topLevel)!;
    cat.total += amt;
    cat.count++;

    if (sub && sub !== topLevel) {
      if (!cat.subs.has(sub)) {
        cat.subs.set(sub, { total: 0, count: 0 });
      }
      const s = cat.subs.get(sub)!;
      s.total += amt;
      s.count++;
    }
  }

  const byCategory: CategorySpending[] = Array.from(catMap.entries())
    .map(([cat, data]) => {
      const subcategories = Array.from(data.subs.entries())
        .map(([subCat, subData]) => ({
          category: subCat,
          total: roundMoney(subData.total),
          count: subData.count,
          pct_of_total: totalSpending > 0 ? roundMoney((subData.total / totalSpending) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total);

      return {
        category: cat,
        total: roundMoney(data.total),
        count: data.count,
        pct_of_total: totalSpending > 0 ? roundMoney((data.total / totalSpending) * 100) : 0,
        subcategories: subcategories.length > 0 ? subcategories : undefined,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Top merchants
  const merchantMap = new Map<string, { total: number; count: number }>();
  for (const t of filtered) {
    const desc = (t.merchant as string) || (t.description as string) || "Unknown";
    const amt = Math.abs((t.amount as number) || 0);
    if (!merchantMap.has(desc)) {
      merchantMap.set(desc, { total: 0, count: 0 });
    }
    const m = merchantMap.get(desc)!;
    m.total += amt;
    m.count++;
  }

  const topMerchants: MerchantSpending[] = Array.from(merchantMap.entries())
    .map(([desc, data]) => ({
      description: desc,
      total: roundMoney(data.total),
      count: data.count,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  const daysDiff = Math.max(1, Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000));

  return {
    period: { start: dateFrom, end: dateTo },
    total_spending: roundMoney(totalSpending),
    by_category: byCategory,
    top_merchants: topMerchants,
    daily_average: roundMoney(totalSpending / daysDiff),
  };
}
