import { createHash } from "crypto";
import { parseDate } from "../utils/dates.js";
import { extractMerchant } from "./merchant.js";
import type { ImportConfig, RawTransaction } from "./types.js";

export function normalizeTransaction(
  row: Record<string, string>,
  config: ImportConfig
): RawTransaction | null {
  const cols = config.columns;

  const rawDate = row[cols.date]?.trim();
  if (!rawDate) return null;

  const date = parseDate(rawDate, config.dateFormat);
  if (!date) return null;

  const description = (row[cols.description] || "").trim();
  if (!description) return null;

  let amount: number;

  if (cols.amount) {
    const rawAmount = (row[cols.amount] || "").replace(/[$,\s"]/g, "").trim();
    if (!rawAmount || rawAmount === "") return null;
    amount = parseFloat(rawAmount);
    if (isNaN(amount)) return null;
    if (config.invertAmount) {
      amount = -amount;
    }
  } else if (cols.debit && cols.credit) {
    const rawDebit = (row[cols.debit] || "").replace(/[$,\s"]/g, "").trim();
    const rawCredit = (row[cols.credit] || "").replace(/[$,\s"]/g, "").trim();
    if (rawDebit && rawDebit !== "") {
      amount = -Math.abs(parseFloat(rawDebit));
    } else if (rawCredit && rawCredit !== "") {
      amount = Math.abs(parseFloat(rawCredit));
    } else {
      return null;
    }
    if (isNaN(amount)) return null;
  } else {
    return null;
  }

  amount = Math.round(amount * 100) / 100;

  const category = cols.category ? row[cols.category]?.trim() : undefined;
  const type = cols.type ? row[cols.type]?.trim() : undefined;
  const balance = cols.balance ? row[cols.balance]?.trim() : undefined;
  const check_number = cols.check_number ? row[cols.check_number]?.trim() : undefined;

  const rawLine = Object.values(row).join(",");
  const merchant = extractMerchant(description);

  return { date, description, amount, merchant, category, type, balance, check_number, raw_line: rawLine };
}

export function generateFingerprint(
  accountId: number,
  date: string,
  description: string,
  amount: number
): string {
  const data = `${accountId}|${date}|${description}|${amount}`;
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}
