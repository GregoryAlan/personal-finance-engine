import { readFileSync } from "fs";
import type { FinanceDB } from "../db/database.js";
import { parseCSV } from "./parser.js";
import { inferAccountType } from "./aggregator.js";
import { classifyAsset } from "./asset-classes.js";

const VALID_ASSET_CLASSES = new Set([
  "us_stock", "intl_stock", "bond", "real_estate", "cash", "crypto", "commodity", "other",
]);

const ASSET_CLASS_ALIASES: Record<string, string> = {
  money_market: "cash",
  mm: "cash",
  equity: "us_stock",
  stock: "us_stock",
  stocks: "us_stock",
  international: "intl_stock",
  fixed_income: "bond",
  bonds: "bond",
  reit: "real_estate",
};

export interface HoldingsImportResult {
  as_of: string;
  accounts_created: { name: string; id: number; type: string; institution?: string }[];
  accounts_existing: { name: string; id: number }[];
  per_account: Record<string, { positions: number; total_value: number }>;
  total_positions: number;
  total_value: number;
  total_cost_basis: number;
  unclassified_symbols: string[];
}

export function importHoldingsCSV(
  db: FinanceDB,
  filePath: string,
  asOf: string,
  options?: { institution_override?: string }
): HoldingsImportResult {
  const content = readFileSync(filePath, "utf-8");
  const { headers, rows } = parseCSV(content);

  // Detect columns (case-insensitive)
  const find = (patterns: RegExp) => headers.find((h) => patterns.test(h));

  const institutionCol = find(/^institution$/i);
  const accountCol = find(/account.?name|^account$/i);
  const accountTypeCol = find(/account.?type/i);
  const symbolCol = find(/symbol|ticker/i);
  const nameCol = find(/^name$|^description$|^security$/i);
  const sharesCol = find(/shares|quantity|qty/i);
  const costCol = find(/cost.?basis|book.?value/i);
  const valueCol = find(/current.?value|market.?value|^value$/i);
  const assetClassCol = find(/asset.?class/i);

  if (!symbolCol) {
    throw new Error(`Could not detect Symbol column. Headers: ${headers.join(", ")}`);
  }
  if (!accountCol) {
    throw new Error(`Could not detect Account Name column. Headers: ${headers.join(", ")}`);
  }

  // Phase 1: Group rows by account
  const accountRows = new Map<string, typeof rows>();
  const accountMeta = new Map<string, { institution?: string; type?: string }>();

  for (const row of rows) {
    const accountName = row[accountCol]?.trim();
    if (!accountName) continue;

    if (!accountRows.has(accountName)) {
      accountRows.set(accountName, []);
      accountMeta.set(accountName, {
        institution: options?.institution_override ?? (institutionCol ? row[institutionCol]?.trim() : undefined),
        type: accountTypeCol ? row[accountTypeCol]?.trim() : undefined,
      });
    }
    accountRows.get(accountName)!.push(row);
  }

  // Phase 2: Resolve accounts (create if needed)
  const accountIdMap = new Map<string, number>();
  const accountsCreated: HoldingsImportResult["accounts_created"] = [];
  const accountsExisting: HoldingsImportResult["accounts_existing"] = [];

  for (const [name, meta] of accountMeta) {
    const existing = db.getAccountByName(name);
    if (existing) {
      accountIdMap.set(name, existing.id as number);
      accountsExisting.push({ name, id: existing.id as number });
    } else {
      const typeInfo = meta.type
        ? { type: meta.type, is_asset: !["credit_card", "loan", "mortgage"].includes(meta.type), is_investment: ["brokerage", "401k", "ira", "roth_ira", "hsa"].includes(meta.type) }
        : inferAccountType(name);
      const id = db.createAccount({
        name,
        institution: meta.institution,
        type: typeInfo.type,
        is_asset: typeInfo.is_asset,
        is_investment: typeInfo.is_investment,
      });
      accountIdMap.set(name, id);
      accountsCreated.push({ name, id, type: typeInfo.type, institution: meta.institution });
    }
  }

  // Phase 3: Parse and import holdings per account
  const cleanNum = (val: string | undefined) => {
    if (!val) return undefined;
    const n = parseFloat(val.replace(/[$,%\s"]/g, ""));
    return isNaN(n) ? undefined : n;
  };

  const perAccount: HoldingsImportResult["per_account"] = {};
  let totalPositions = 0;
  let totalValue = 0;
  let totalCostBasis = 0;
  const unclassified: string[] = [];

  for (const [accountName, rowGroup] of accountRows) {
    const accountId = accountIdMap.get(accountName)!;
    const holdings: {
      symbol: string;
      name?: string;
      shares: number;
      cost_basis?: number;
      current_value?: number;
      asset_class?: string;
    }[] = [];

    for (const row of rowGroup) {
      const symbol = row[symbolCol]?.trim();
      if (!symbol) continue;

      let assetClass = assetClassCol ? row[assetClassCol]?.trim()?.toLowerCase() : undefined;
      if (assetClass) {
        assetClass = ASSET_CLASS_ALIASES[assetClass] ?? assetClass;
        if (!VALID_ASSET_CLASSES.has(assetClass)) assetClass = undefined;
      }
      if (!assetClass) {
        const detected = classifyAsset(symbol, nameCol ? row[nameCol]?.trim() : undefined);
        if (detected) {
          assetClass = detected;
        } else {
          unclassified.push(symbol);
        }
      }

      const currentValue = cleanNum(valueCol ? row[valueCol] : undefined);
      const costBasis = cleanNum(costCol ? row[costCol] : undefined);

      holdings.push({
        symbol,
        name: nameCol ? row[nameCol]?.trim() : undefined,
        shares: cleanNum(sharesCol ? row[sharesCol] : undefined) ?? 0,
        cost_basis: costBasis,
        current_value: currentValue,
        asset_class: assetClass,
      });
    }

    db.upsertHoldings(accountId, asOf, holdings);

    const acctValue = holdings.reduce((s, h) => s + (h.current_value ?? 0), 0);
    const acctCost = holdings.reduce((s, h) => s + (h.cost_basis ?? 0), 0);
    perAccount[accountName] = { positions: holdings.length, total_value: Math.round(acctValue * 100) / 100 };
    totalPositions += holdings.length;
    totalValue += acctValue;
    totalCostBasis += acctCost;
  }

  return {
    as_of: asOf,
    accounts_created: accountsCreated,
    accounts_existing: accountsExisting,
    per_account: perAccount,
    total_positions: totalPositions,
    total_value: Math.round(totalValue * 100) / 100,
    total_cost_basis: Math.round(totalCostBasis * 100) / 100,
    unclassified_symbols: [...new Set(unclassified)],
  };
}
