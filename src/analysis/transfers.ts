import type { FinanceDB } from "../db/database.js";

interface TransferMatch {
  id_a: number;
  date_a: string;
  description_a: string;
  amount_a: number;
  account_a: string;
  account_type_a: string;
  id_b: number;
  date_b: string;
  description_b: string;
  amount_b: number;
  account_b: string;
  account_type_b: string;
  date_diff_days: number;
  category: string;
}

interface TransferDetectionResult {
  matches: TransferMatch[];
  linked: number;
  dry_run: boolean;
}

export function detectTransfers(
  db: FinanceDB,
  options?: { dateWindowDays?: number; dryRun?: boolean }
): TransferDetectionResult {
  const dateWindow = options?.dateWindowDays ?? 3;
  const dryRun = options?.dryRun ?? false;

  const txns = db.getUnlinkedTransactions();

  // Group by absolute amount
  const byAmount = new Map<number, typeof txns>();
  for (const txn of txns) {
    const absAmount = Math.round(Math.abs(txn.amount as number) * 100) / 100;
    if (absAmount === 0) continue;
    if (!byAmount.has(absAmount)) {
      byAmount.set(absAmount, []);
    }
    byAmount.get(absAmount)!.push(txn);
  }

  const matches: TransferMatch[] = [];
  const linked = new Set<number>();

  for (const [, group] of byAmount) {
    if (group.length < 2) continue;

    // Separate outflows and inflows
    const outflows = group.filter((t) => (t.amount as number) < 0);
    const inflows = group.filter((t) => (t.amount as number) > 0);

    // Sort by date for greedy matching
    outflows.sort((a, b) => (a.date as string).localeCompare(b.date as string));
    inflows.sort((a, b) => (a.date as string).localeCompare(b.date as string));

    // Greedy match: for each outflow, find closest inflow within window
    for (const out of outflows) {
      if (linked.has(out.id as number)) continue;

      let bestMatch: typeof txns[0] | null = null;
      let bestDiff = Infinity;

      for (const inf of inflows) {
        if (linked.has(inf.id as number)) continue;
        if ((inf.account_id as number) === (out.account_id as number)) continue;

        const diffDays = Math.abs(
          (new Date(inf.date as string).getTime() - new Date(out.date as string).getTime()) / 86400000
        );

        if (diffDays <= dateWindow && diffDays < bestDiff) {
          bestDiff = diffDays;
          bestMatch = inf;
        }
      }

      if (bestMatch) {
        linked.add(out.id as number);
        linked.add(bestMatch.id as number);

        // Determine category
        const outType = out.account_type as string;
        const inType = bestMatch.account_type as string;
        let category: string;
        if (outType === "credit_card" || inType === "credit_card") {
          category = "Transfer > Credit Card Payment";
        } else if (
          ["brokerage", "401k", "ira", "roth_ira", "hsa"].includes(outType) ||
          ["brokerage", "401k", "ira", "roth_ira", "hsa"].includes(inType)
        ) {
          category = "Transfer > Investment Contribution";
        } else {
          category = "Transfer > Account Transfer";
        }

        matches.push({
          id_a: out.id as number,
          date_a: out.date as string,
          description_a: out.description as string,
          amount_a: out.amount as number,
          account_a: out.account_name as string,
          account_type_a: outType,
          id_b: bestMatch.id as number,
          date_b: bestMatch.date as string,
          description_b: bestMatch.description as string,
          amount_b: bestMatch.amount as number,
          account_b: bestMatch.account_name as string,
          account_type_b: inType,
          date_diff_days: Math.round(bestDiff),
          category,
        });
      }
    }
  }

  // Actually link if not dry run
  let linkedCount = 0;
  if (!dryRun) {
    for (const match of matches) {
      const cat = db.getCategoryByPath(match.category);
      db.linkTransferPair(match.id_a, match.id_b, cat?.id);
      linkedCount++;
    }
  }

  return {
    matches,
    linked: dryRun ? 0 : linkedCount,
    dry_run: dryRun,
  };
}
