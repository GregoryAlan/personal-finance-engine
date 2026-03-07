import type { ImportConfig } from "./types.js";

export const INSTITUTION_MAPPINGS: ImportConfig[] = [
  {
    institution: "chase",
    columns: {
      date: "Transaction Date",
      description: "Description",
      amount: "Amount",
      category: "Category",
      type: "Type",
      balance: "Balance",
    },
  },
  {
    institution: "chase_credit",
    columns: {
      date: "Transaction Date",
      description: "Description",
      amount: "Amount",
      category: "Category",
      type: "Type",
    },
  },
  {
    institution: "bank_of_america",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
      balance: "Running Bal.",
    },
  },
  {
    institution: "amex",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
      category: "Category",
    },
    invertAmount: true,
  },
  {
    institution: "discover",
    columns: {
      date: "Trans. Date",
      description: "Description",
      amount: "Amount",
      category: "Category",
    },
    invertAmount: true,
  },
  {
    institution: "schwab_checking",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
      type: "Type",
      check_number: "CheckNumber",
      balance: "RunningBalance",
    },
  },
  {
    institution: "schwab_brokerage",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
      type: "Action",
    },
  },
  {
    institution: "fidelity",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
    },
  },
  {
    institution: "vanguard",
    columns: {
      date: "Transaction Date",
      description: "Transaction Description",
      amount: "Amount",
      type: "Transaction Type",
    },
  },
  {
    institution: "apple_card",
    columns: {
      date: "Transaction Date",
      description: "Description",
      amount: "Amount (USD)",
      category: "Category",
      type: "Type",
    },
  },
  {
    institution: "capital_one",
    columns: {
      date: "Transaction Date",
      description: "Description",
      debit: "Debit",
      credit: "Credit",
      category: "Category",
    },
  },
  {
    institution: "citi",
    columns: {
      date: "Date",
      description: "Description",
      debit: "Debit",
      credit: "Credit",
    },
  },
  {
    institution: "wells_fargo",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
    },
  },
  {
    institution: "usaa",
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
      category: "Category",
    },
  },
];

export function detectInstitution(headers: string[]): ImportConfig | null {
  const headerSet = new Set(headers.map((h) => h.trim()));

  for (const mapping of INSTITUTION_MAPPINGS) {
    const cols = mapping.columns;
    const required = [cols.date, cols.description];
    if (cols.amount) required.push(cols.amount);
    if (cols.debit) required.push(cols.debit);
    if (cols.credit) required.push(cols.credit);

    const allPresent = required.every((col) => headerSet.has(col));
    if (allPresent) {
      // Check optional columns for disambiguation
      const optionalHits = [cols.category, cols.type, cols.balance, cols.check_number]
        .filter(Boolean)
        .filter((col) => headerSet.has(col!)).length;

      // Extra check for Chase vs others with same column names
      if (mapping.institution === "chase" && !headerSet.has("Balance")) continue;
      if (mapping.institution === "chase_credit" && headerSet.has("Balance")) continue;

      if (allPresent) return mapping;
    }
  }

  return null;
}
