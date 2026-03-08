import { readFileSync } from "fs";
import { basename } from "path";
import { randomUUID } from "crypto";
import type { FinanceDB } from "../db/database.js";
import { parseCSV } from "./parser.js";
import { normalizeTransaction, generateFingerprint } from "./normalizer.js";
import type { ImportConfig } from "./types.js";

// --- Account Type Inference ---

interface AccountTypeInfo {
  type: string;
  is_asset: boolean;
  is_investment: boolean;
}

const ACCOUNT_TYPE_RULES: { pattern: RegExp; info: AccountTypeInfo }[] = [
  { pattern: /checking/i, info: { type: "checking", is_asset: true, is_investment: false } },
  { pattern: /savings/i, info: { type: "savings", is_asset: true, is_investment: false } },
  { pattern: /401\(?k\)?|thrift plan/i, info: { type: "401k", is_asset: true, is_investment: true } },
  { pattern: /roth ira/i, info: { type: "roth_ira", is_asset: true, is_investment: true } },
  { pattern: /traditional ira|(?<!\w)ira(?!\w)/i, info: { type: "ira", is_asset: true, is_investment: true } },
  { pattern: /\bhsa\b|health savings/i, info: { type: "hsa", is_asset: true, is_investment: true } },
  { pattern: /mortgage/i, info: { type: "mortgage", is_asset: false, is_investment: false } },
  { pattern: /home equity|line of credit/i, info: { type: "loan", is_asset: false, is_investment: false } },
  { pattern: /card|sapphire|freedom|discover|prime|double cash/i, info: { type: "credit_card", is_asset: false, is_investment: false } },
  { pattern: /brokerage|individual|investment|allocation/i, info: { type: "brokerage", is_asset: true, is_investment: true } },
];

export function inferAccountType(name: string): AccountTypeInfo {
  for (const rule of ACCOUNT_TYPE_RULES) {
    if (rule.pattern.test(name)) return rule.info;
  }
  return { type: "other", is_asset: true, is_investment: false };
}

const INSTITUTION_PATTERNS: { pattern: RegExp; institution: string }[] = [
  { pattern: /wells fargo/i, institution: "Wells Fargo" },
  { pattern: /chase|sapphire|freedom/i, institution: "Chase" },
  { pattern: /citi|double cash/i, institution: "Citi" },
  { pattern: /discover/i, institution: "Discover" },
  { pattern: /robinhood/i, institution: "Robinhood" },
  { pattern: /schwab/i, institution: "Schwab" },
  { pattern: /fidelity/i, institution: "Fidelity" },
  { pattern: /vanguard/i, institution: "Vanguard" },
  { pattern: /amex|american express/i, institution: "Amex" },
  { pattern: /capital one/i, institution: "Capital One" },
  { pattern: /usaa/i, institution: "USAA" },
  { pattern: /ally/i, institution: "Ally" },
  { pattern: /bank of america|bofa/i, institution: "Bank of America" },
  { pattern: /barclays/i, institution: "Barclays" },
  { pattern: /apple/i, institution: "Apple" },
];

function inferInstitution(name: string): string | undefined {
  for (const rule of INSTITUTION_PATTERNS) {
    if (rule.pattern.test(name)) return rule.institution;
  }
  return undefined;
}

// --- Category Mapping ---

const AGGREGATOR_CATEGORY_MAP: Record<string, string | null> = {
  "Restaurants": "Food > Restaurants",
  "Groceries": "Food > Groceries",
  "Gasoline/Fuel": "Transportation > Gas & Fuel",
  "Automotive": "Transportation > Car Maintenance",
  "Clothing/Shoes": "Shopping > Clothing",
  "Electronics": "Shopping > Electronics",
  "General Merchandise": "Shopping",
  "Entertainment": "Entertainment",
  "Hobbies": "Entertainment > Hobbies",
  "Travel": "Travel",
  "Utilities": "Utilities",
  "Cable/Satellite": "Utilities > Internet",
  "Telephone": "Utilities > Phone",
  "Online Services": "Subscriptions",
  "Dues & Subscriptions": "Subscriptions",
  "Healthcare/Medical": "Health",
  "Personal Care": "Personal",
  "Pets/Pet Care": "Personal > Pet",
  "Gifts": "Personal > Gifts",
  "Charitable Giving": "Personal > Donations",
  "Education": "Personal > Education",
  "Child/Dependent": "Personal > Childcare",
  "Insurance": "Insurance",
  "Rent": "Housing > Rent",
  "Mortgages": "Housing > Mortgage",
  "Home Improvement": "Housing > Home Maintenance",
  "Home Maintenance": "Housing > Home Maintenance",
  "Taxes": "Taxes",
  "Service Charges/Fees": "Fees",
  "ATM/Cash": "Fees > ATM Fees",
  "Checks": null,
  "Paychecks/Salary": "Income > Salary",
  "Interest": "Income > Interest",
  "Investment Income": "Income > Dividends",
  "Other Income": "Income > Other Income",
  "Deposits": "Income > Other Income",
  "Rewards": "Income > Other Income",
  "Refunds & Reimbursements": "Income > Refunds",
  "Expense Reimbursement": "Income > Refunds",
  "Wages Paid": "Income > Salary",
  "Transfers": "Transfer > Account Transfer",
  "Credit Card Payments": "Transfer > Credit Card Payment",
  "Securities Trades": "Transfer > Investment Contribution",
  "Retirement Contributions": "Transfer > Investment Contribution",
  "Savings": "Transfer > Account Transfer",
  "Loans": "Housing",
  "Office Supplies": "Shopping",
  "Postage & Shipping": "Shopping",
  "Business Miscellaneous": "Shopping",
  "Other Expenses": null,
  "Uncategorized": null,
};

// --- Main Import ---

export interface AggregatorImportResult {
  batch_id: string;
  accounts_created: { name: string; id: number; type: string; institution?: string }[];
  accounts_existing: { name: string; id: number }[];
  per_account: Record<string, { imported: number; skipped: number; errors: number }>;
  unmapped_categories: string[];
  total_imported: number;
  total_skipped: number;
  total_errors: number;
  date_range: { start: string; end: string } | null;
  auto_categorized: number;
}

export function importAggregatorCSV(
  db: FinanceDB,
  filePath: string,
  options?: { skip_accounts?: string[] }
): AggregatorImportResult {
  const content = readFileSync(filePath, "utf-8");
  const { headers, rows } = parseCSV(content);

  // Validate required headers
  const requiredHeaders = ["Date", "Account", "Description", "Amount"];
  const missingHeaders = requiredHeaders.filter(
    (h) => !headers.some((hdr) => hdr.toLowerCase() === h.toLowerCase())
  );
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required CSV headers: ${missingHeaders.join(", ")}. Found: ${headers.join(", ")}`);
  }

  // Resolve actual header names (case-insensitive)
  const headerMap: Record<string, string> = {};
  for (const required of ["Date", "Account", "Description", "Amount", "Category"]) {
    const found = headers.find((h) => h.toLowerCase() === required.toLowerCase());
    if (found) headerMap[required] = found;
  }

  const skipSet = new Set((options?.skip_accounts ?? []).map((s) => s.toLowerCase()));
  const batchId = randomUUID().slice(0, 8);

  // Phase 1: Resolve accounts
  const accountNames = new Set<string>();
  for (const row of rows) {
    const name = row[headerMap["Account"]]?.trim();
    if (name && !skipSet.has(name.toLowerCase())) {
      accountNames.add(name);
    }
  }

  const accountIdMap = new Map<string, number>();
  const accountsCreated: AggregatorImportResult["accounts_created"] = [];
  const accountsExisting: AggregatorImportResult["accounts_existing"] = [];

  for (const name of accountNames) {
    const existing = db.getAccountByName(name);
    if (existing) {
      accountIdMap.set(name, existing.id as number);
      accountsExisting.push({ name, id: existing.id as number });
    } else {
      const typeInfo = inferAccountType(name);
      const institution = inferInstitution(name);
      const id = db.createAccount({
        name,
        institution,
        type: typeInfo.type,
        is_asset: typeInfo.is_asset,
        is_investment: typeInfo.is_investment,
      });
      accountIdMap.set(name, id);
      accountsCreated.push({ name, id, type: typeInfo.type, institution });
    }
  }

  // Phase 2: Build category cache
  const categoryCache = new Map<string, number | null>();
  const unmappedCategories = new Set<string>();

  function resolveCategoryId(aggregatorCategory: string): number | undefined {
    if (categoryCache.has(aggregatorCategory)) {
      const cached = categoryCache.get(aggregatorCategory);
      return cached ?? undefined;
    }

    const enginePath = AGGREGATOR_CATEGORY_MAP[aggregatorCategory];
    if (enginePath === undefined) {
      // Not in our map at all
      unmappedCategories.add(aggregatorCategory);
      categoryCache.set(aggregatorCategory, null);
      return undefined;
    }
    if (enginePath === null) {
      // Explicitly unmapped
      categoryCache.set(aggregatorCategory, null);
      return undefined;
    }

    const cat = db.getCategoryByPath(enginePath);
    if (cat) {
      categoryCache.set(aggregatorCategory, cat.id);
      return cat.id;
    }

    // Category path doesn't exist yet — create it
    const catId = getOrCreateCategoryByPath(db, enginePath);
    categoryCache.set(aggregatorCategory, catId);
    return catId;
  }

  // Phase 3: Import transactions
  const config: ImportConfig = {
    institution: "aggregator",
    columns: {
      date: headerMap["Date"],
      description: headerMap["Description"],
      amount: headerMap["Amount"],
      category: headerMap["Category"],
    },
  };

  const perAccount: Record<string, { imported: number; skipped: number; errors: number }> = {};
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let dateMin = "9999";
  let dateMax = "0000";

  const insertAll = db.db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const accountName = row[headerMap["Account"]]?.trim();
      if (!accountName || skipSet.has(accountName.toLowerCase())) continue;

      const accountId = accountIdMap.get(accountName);
      if (accountId === undefined) continue;

      if (!perAccount[accountName]) {
        perAccount[accountName] = { imported: 0, skipped: 0, errors: 0 };
      }

      const normalized = normalizeTransaction(row, config);
      if (!normalized) {
        perAccount[accountName].errors++;
        totalErrors++;
        continue;
      }

      const fingerprint = generateFingerprint(accountId, normalized.date, normalized.description, normalized.amount);

      // Resolve category from aggregator CSV
      let categoryId: number | undefined;
      const csvCategory = headerMap["Category"] ? row[headerMap["Category"]]?.trim() : undefined;
      if (csvCategory) {
        categoryId = resolveCategoryId(csvCategory);
      }

      const result = db.insertTransaction({
        account_id: accountId,
        date: normalized.date,
        description: normalized.description,
        amount: normalized.amount,
        category_id: categoryId,
        fingerprint,
        institution_category: csvCategory,
        batch_id: batchId,
        merchant: normalized.merchant,
      });

      if (result.action === "inserted") {
        perAccount[accountName].imported++;
        totalImported++;
        if (normalized.date < dateMin) dateMin = normalized.date;
        if (normalized.date > dateMax) dateMax = normalized.date;
      } else {
        perAccount[accountName].skipped++;
        totalSkipped++;
      }
    }
  });

  insertAll();

  // Phase 4: Auto-categorize any remaining uncategorized
  const catResult = db.applyCategorization();

  // Log import
  db.logImport({
    batch_id: batchId,
    filename: basename(filePath),
    institution: "aggregator",
    rows_imported: totalImported,
    rows_skipped: totalSkipped,
    rows_errored: totalErrors,
    date_range_start: dateMin !== "9999" ? dateMin : undefined,
    date_range_end: dateMax !== "0000" ? dateMax : undefined,
  });

  return {
    batch_id: batchId,
    accounts_created: accountsCreated,
    accounts_existing: accountsExisting,
    per_account: perAccount,
    unmapped_categories: [...unmappedCategories],
    total_imported: totalImported,
    total_skipped: totalSkipped,
    total_errors: totalErrors,
    date_range: dateMin !== "9999" ? { start: dateMin, end: dateMax } : null,
    auto_categorized: catResult.updated,
  };
}

// --- Helpers ---

function inferCategoryType(path: string): "expense" | "income" | "transfer" {
  if (path.startsWith("Income")) return "income";
  if (path.startsWith("Transfer")) return "transfer";
  return "expense";
}

function getOrCreateCategoryByPath(db: FinanceDB, fullPath: string): number {
  const existing = db.getCategoryByPath(fullPath);
  if (existing) return existing.id;

  const parts = fullPath.split(" > ");
  const type = inferCategoryType(fullPath);

  // Ensure parent exists
  if (parts.length > 1) {
    const parentPath = parts.slice(0, -1).join(" > ");
    getOrCreateCategoryByPath(db, parentPath);
    return db.createCategory(parts[parts.length - 1], parentPath, type);
  }

  // Top-level category
  return db.createCategory(parts[0], null, type);
}
