import type { FinanceDB } from "../db/database.js";
import { roundMoney } from "../utils/money.js";

export interface AllocationSummary {
  total_value: number;
  total_cost_basis: number;
  total_gain_loss: number;
  total_gain_loss_pct: number;
  by_asset_class: AllocationGroup[];
  by_account: AllocationGroup[];
}

interface AllocationGroup {
  name: string;
  value: number;
  cost_basis: number;
  gain_loss: number;
  gain_loss_pct: number;
  allocation_pct: number;
}

export function analyzeAllocations(db: FinanceDB, asOf?: string): AllocationSummary {
  const byClass = db.getHoldings({ group_by: "asset_class", as_of: asOf });
  const byAccount = db.getHoldings({ group_by: "account", as_of: asOf });
  const all = db.getHoldings({ as_of: asOf });

  const totalValue = all.total_value;
  const totalCostBasis = (all.holdings || []).reduce(
    (sum, h) => sum + ((h.cost_basis as number) || 0),
    0
  );

  function mapGroups(groups: Record<string, unknown>[]): AllocationGroup[] {
    return groups.map((g) => {
      const value = (g.total_value as number) || 0;
      const costBasis = (g.total_cost_basis as number) || 0;
      const gainLoss = value - costBasis;
      return {
        name: (g.group_key as string) || "Unknown",
        value: roundMoney(value),
        cost_basis: roundMoney(costBasis),
        gain_loss: roundMoney(gainLoss),
        gain_loss_pct: costBasis > 0 ? roundMoney((gainLoss / costBasis) * 100) : 0,
        allocation_pct: (g.allocation_pct as number) || 0,
      };
    });
  }

  const totalGainLoss = totalValue - totalCostBasis;

  return {
    total_value: roundMoney(totalValue),
    total_cost_basis: roundMoney(totalCostBasis),
    total_gain_loss: roundMoney(totalGainLoss),
    total_gain_loss_pct: totalCostBasis > 0 ? roundMoney((totalGainLoss / totalCostBasis) * 100) : 0,
    by_asset_class: mapGroups(byClass.groups || []),
    by_account: mapGroups(byAccount.groups || []),
  };
}
