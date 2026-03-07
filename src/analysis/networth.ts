import type { FinanceDB } from "../db/database.js";
import { roundMoney } from "../utils/money.js";

export interface NetWorthPoint {
  date: string;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  accounts?: Record<string, number>;
}

export function calculateNetWorthHistory(
  db: FinanceDB,
  months: number = 12,
  includeAccounts: boolean = false
): NetWorthPoint[] {
  const snapshots = db.getNetWorthHistory(months);

  // Group by date
  const dateMap = new Map<string, { assets: number; liabilities: number; accounts: Map<string, number> }>();

  for (const s of snapshots) {
    const date = (s.date as string) || "";
    if (!dateMap.has(date)) {
      dateMap.set(date, { assets: 0, liabilities: 0, accounts: new Map() });
    }
    const entry = dateMap.get(date)!;
    const balance = (s.balance as number) || 0;
    const name = s.account_name as string;

    if (s.is_asset) {
      entry.assets += balance;
    } else {
      entry.liabilities += Math.abs(balance);
    }

    entry.accounts.set(name, balance);
  }

  const points: NetWorthPoint[] = Array.from(dateMap.entries())
    .map(([date, data]) => {
      const point: NetWorthPoint = {
        date,
        total_assets: roundMoney(data.assets),
        total_liabilities: roundMoney(data.liabilities),
        net_worth: roundMoney(data.assets - data.liabilities),
      };
      if (includeAccounts) {
        point.accounts = Object.fromEntries(
          Array.from(data.accounts.entries()).map(([k, v]) => [k, roundMoney(v)])
        );
      }
      return point;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return points;
}
