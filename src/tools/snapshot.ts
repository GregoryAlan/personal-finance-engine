import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import { today } from "../utils/dates.js";
import { roundMoney } from "../utils/money.js";

function jsonResponse(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function registerSnapshotTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "snapshot_holdings",
    "Carry forward holdings snapshots to new dates, update individual positions, and list snapshot history. Lighter than full CSV re-import for tracking net worth over time.",
    {
      action: z
        .enum(["carry_forward", "update_position", "list_snapshots"])
        .describe(
          "carry_forward: copy latest holdings to a new date; update_position: modify positions in an existing snapshot; list_snapshots: show all snapshot dates"
        ),
      as_of: z
        .string()
        .optional()
        .describe("Target date YYYY-MM-DD (default today)"),
      source_date: z
        .string()
        .optional()
        .describe("For carry_forward: copy from this date instead of latest"),
      account_id: z
        .number()
        .optional()
        .describe("Specific account (default: all investment accounts)"),
      updates: z
        .array(
          z.object({
            symbol: z.string().describe("Ticker symbol"),
            current_value: z.number().optional().describe("New market value"),
            shares: z.number().optional().describe("New share count"),
            cost_basis: z.number().optional().describe("New cost basis"),
          })
        )
        .optional()
        .describe("Position updates to apply"),
    },
    async ({ action, as_of, source_date, account_id, updates }) => {
      const targetDate = as_of || today();

      if (action === "list_snapshots") {
        const summaries = db.getHoldingsSnapshotSummaries(account_id);
        if (summaries.length === 0) {
          return jsonResponse({ message: "No holdings snapshots found." });
        }
        return jsonResponse({
          snapshot_count: summaries.length,
          snapshots: summaries.map((s) => ({
            date: s.as_of,
            accounts: s.account_count,
            positions: s.position_count,
            total_value: roundMoney(Number(s.total_value) || 0),
          })),
        });
      }

      // Resolve target accounts
      const investmentAccounts: Record<string, unknown>[] = account_id
        ? [db.getAccount(account_id)].filter(
            (a): a is Record<string, unknown> => a !== undefined
          )
        : db
            .listAccounts()
            .filter((a) => a.is_investment === 1 || a.is_investment === true);

      if (investmentAccounts.length === 0) {
        return jsonResponse({
          error: account_id
            ? `Account ${account_id} not found`
            : "No investment accounts found",
        });
      }

      if (action === "carry_forward") {
        // Build updates lookup
        const updatesMap = new Map<
          string,
          { current_value?: number; shares?: number; cost_basis?: number }
        >();
        if (updates) {
          for (const u of updates) {
            updatesMap.set(u.symbol.toUpperCase(), u);
          }
        }

        const accountResults: unknown[] = [];
        const accountsSkipped: string[] = [];
        let totalPositions = 0;
        let totalValue = 0;
        let updatesApplied = 0;
        const unmatchedSymbols = new Set(updatesMap.keys());

        for (const acct of investmentAccounts) {
          const acctId = acct.id as number;
          const acctName = acct.name as string;

          // Get holdings from source date (or latest as of target date)
          const sourceHoldings = db.getHoldingsAtDate(
            source_date || targetDate,
            acctId
          );

          if (sourceHoldings.length === 0) {
            accountsSkipped.push(acctName);
            continue;
          }

          const newHoldings = sourceHoldings.map((h) => {
            const sym = (h.symbol as string).toUpperCase();
            const update = updatesMap.get(sym);
            if (update) {
              unmatchedSymbols.delete(sym);
              updatesApplied++;
            }
            return {
              symbol: h.symbol as string,
              name: (h.name as string) || undefined,
              shares: update?.shares ?? (h.shares as number),
              cost_basis:
                update?.cost_basis ?? ((h.cost_basis as number) || undefined),
              current_value:
                update?.current_value ??
                ((h.current_value as number) || undefined),
              asset_class: (h.asset_class as string) || undefined,
            };
          });

          db.upsertHoldings(acctId, targetDate, newHoldings);

          const acctValue = newHoldings.reduce(
            (s, h) => s + (h.current_value ?? 0),
            0
          );
          totalPositions += newHoldings.length;
          totalValue += acctValue;

          accountResults.push({
            account: acctName,
            positions: newHoldings.length,
            total_value: roundMoney(acctValue),
          });
        }

        const result: Record<string, unknown> = {
          action: "carry_forward",
          target_date: targetDate,
          source: source_date || "latest",
          accounts_processed: accountResults.length,
          accounts_skipped: accountsSkipped.length > 0 ? accountsSkipped : undefined,
          total_positions: totalPositions,
          total_value: roundMoney(totalValue),
          updates_applied: updatesApplied,
          unmatched_symbols:
            unmatchedSymbols.size > 0
              ? Array.from(unmatchedSymbols)
              : undefined,
          accounts: accountResults,
        };

        if (source_date && source_date > targetDate) {
          result.warning =
            "Target date is before source date — backfilling historical snapshot";
        }

        return jsonResponse(result);
      }

      if (action === "update_position") {
        if (!updates || updates.length === 0) {
          return jsonResponse({
            error: "updates array is required and must not be empty",
          });
        }

        const updatesMap = new Map<
          string,
          { current_value?: number; shares?: number; cost_basis?: number }
        >();
        for (const u of updates) {
          updatesMap.set(u.symbol.toUpperCase(), u);
        }

        const accountResults: unknown[] = [];
        const changes: unknown[] = [];
        const notFound: string[] = [];
        let autoCarried = false;

        for (const acct of investmentAccounts) {
          const acctId = acct.id as number;
          const acctName = acct.name as string;

          // Check for existing holdings at target date
          let holdings = db.getHoldingsAtDate(targetDate, acctId);

          if (holdings.length === 0) continue;

          // Check if holdings are from an earlier date (auto-carry-forward needed)
          const holdingsDate = holdings[0].as_of as string;
          if (holdingsDate !== targetDate) {
            // Auto-carry-forward
            const newHoldings = holdings.map((h) => ({
              symbol: h.symbol as string,
              name: (h.name as string) || undefined,
              shares: h.shares as number,
              cost_basis: (h.cost_basis as number) || undefined,
              current_value: (h.current_value as number) || undefined,
              asset_class: (h.asset_class as string) || undefined,
            }));
            db.upsertHoldings(acctId, targetDate, newHoldings);
            holdings = db.getHoldingsAtDate(targetDate, acctId);
            autoCarried = true;
          }

          // Apply updates
          const acctNotFound = new Set(updatesMap.keys());
          const updatedHoldings = holdings.map((h) => {
            const sym = (h.symbol as string).toUpperCase();
            const update = updatesMap.get(sym);
            if (update) {
              acctNotFound.delete(sym);
              const changeRecord: Record<string, unknown> = {
                account: acctName,
                symbol: sym,
              };
              if (update.current_value !== undefined) {
                changeRecord.current_value = {
                  old: h.current_value,
                  new: update.current_value,
                };
              }
              if (update.shares !== undefined) {
                changeRecord.shares = { old: h.shares, new: update.shares };
              }
              if (update.cost_basis !== undefined) {
                changeRecord.cost_basis = {
                  old: h.cost_basis,
                  new: update.cost_basis,
                };
              }
              changes.push(changeRecord);
            }
            return {
              symbol: h.symbol as string,
              name: (h.name as string) || undefined,
              shares: update?.shares ?? (h.shares as number),
              cost_basis:
                update?.cost_basis ?? ((h.cost_basis as number) || undefined),
              current_value:
                update?.current_value ??
                ((h.current_value as number) || undefined),
              asset_class: (h.asset_class as string) || undefined,
            };
          });

          // Only collect not-found if this account had holdings (relevant account)
          for (const sym of acctNotFound) {
            if (!notFound.includes(sym)) notFound.push(sym);
          }
          // Remove from notFound if found in any account
          for (const c of changes) {
            const idx = notFound.indexOf((c as Record<string, unknown>).symbol as string);
            if (idx !== -1) notFound.splice(idx, 1);
          }

          db.upsertHoldings(acctId, targetDate, updatedHoldings);

          const acctValue = updatedHoldings.reduce(
            (s, h) => s + (h.current_value ?? 0),
            0
          );
          accountResults.push({
            account: acctName,
            positions: updatedHoldings.length,
            total_value: roundMoney(acctValue),
          });
        }

        return jsonResponse({
          action: "update_position",
          target_date: targetDate,
          auto_carried_forward: autoCarried,
          changes,
          not_found: notFound.length > 0 ? notFound : undefined,
          accounts: accountResults,
        });
      }

      return jsonResponse({ error: "Unknown action" });
    }
  );
}
