import Database from "better-sqlite3";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "../utils/categories.js";

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      institution TEXT,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'credit_card', 'brokerage', '401k', 'ira', 'roth_ira', 'hsa', 'loan', 'mortgage', 'other')),
      is_asset INTEGER NOT NULL DEFAULT 1,
      is_investment INTEGER NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      notes TEXT,
      opened_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id),
      full_path TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'transfer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_categories_path ON categories(full_path);
    CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      fingerprint TEXT NOT NULL UNIQUE,
      transfer_pair_id INTEGER REFERENCES transactions(id),
      institution_category TEXT,
      check_number TEXT,
      notes TEXT,
      batch_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_transactions_batch ON transactions(batch_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description);

    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      symbol TEXT NOT NULL,
      name TEXT,
      shares REAL NOT NULL DEFAULT 0,
      cost_basis REAL,
      current_value REAL,
      asset_class TEXT CHECK(asset_class IN ('us_stock', 'intl_stock', 'bond', 'real_estate', 'cash', 'crypto', 'commodity', 'other')),
      as_of TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
    CREATE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);
    CREATE INDEX IF NOT EXISTS idx_holdings_as_of ON holdings(as_of);

    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      balance REAL NOT NULL,
      as_of TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_account ON balance_snapshots(account_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON balance_snapshots(as_of);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique ON balance_snapshots(account_id, as_of);

    CREATE TABLE IF NOT EXISTS categorization_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      priority INTEGER NOT NULL DEFAULT 0,
      match_type TEXT NOT NULL DEFAULT 'contains' CHECK(match_type IN ('contains', 'starts_with', 'exact', 'regex')),
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rules_priority ON categorization_rules(priority DESC);

    CREATE TABLE IF NOT EXISTS recurring_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description_pattern TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
      typical_amount REAL,
      amount_variance REAL,
      last_seen TEXT,
      next_expected TEXT,
      is_income INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL UNIQUE,
      filename TEXT,
      institution TEXT,
      account_id INTEGER REFERENCES accounts(id),
      rows_imported INTEGER NOT NULL DEFAULT 0,
      rows_skipped INTEGER NOT NULL DEFAULT 0,
      rows_errored INTEGER NOT NULL DEFAULT 0,
      date_range_start TEXT,
      date_range_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed default categories if empty
  const count = db.prepare("SELECT COUNT(*) as count FROM categories").get() as { count: number };
  if (count.count === 0) {
    seedCategories(db);
    seedDefaultRules(db);
  }

  runMigrations(db);
}

function seedCategories(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO categories (name, parent_id, full_path, type) VALUES (?, ?, ?, ?)"
  );

  const getByPath = db.prepare("SELECT id FROM categories WHERE full_path = ?");

  const seed = db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      let parentId: number | null = null;
      let fullPath = cat.name;

      if (cat.parent) {
        const parent = getByPath.get(cat.parent) as { id: number } | undefined;
        if (parent) {
          parentId = parent.id;
          fullPath = `${cat.parent} > ${cat.name}`;
        }
      }

      insert.run(cat.name, parentId, fullPath, cat.type);
    }
  });

  seed();
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function runMigrations(db: Database.Database): void {
  // Phase 1: Merchant normalization
  if (!hasColumn(db, "transactions", "merchant")) {
    db.exec("ALTER TABLE transactions ADD COLUMN merchant TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant)");
  }

  // Phase 2: Transaction editing
  if (!hasColumn(db, "transactions", "tags")) {
    db.exec("ALTER TABLE transactions ADD COLUMN tags TEXT");
  }
  if (!hasColumn(db, "transactions", "is_excluded")) {
    db.exec("ALTER TABLE transactions ADD COLUMN is_excluded INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "transactions", "original_fingerprint")) {
    db.exec("ALTER TABLE transactions ADD COLUMN original_fingerprint TEXT");
  }
  if (!hasColumn(db, "transactions", "parent_id")) {
    db.exec("ALTER TABLE transactions ADD COLUMN parent_id INTEGER REFERENCES transactions(id)");
  }
  if (!hasColumn(db, "transactions", "is_split")) {
    db.exec("ALTER TABLE transactions ADD COLUMN is_split INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "transactions", "updated_at")) {
    db.exec("ALTER TABLE transactions ADD COLUMN updated_at TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS transaction_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      edit_type TEXT NOT NULL CHECK(edit_type IN ('update','split','exclude','restore','bulk')),
      batch_edit_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_edits_transaction ON transaction_edits(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_edits_batch ON transaction_edits(batch_edit_id);
  `);

  // Phase 3: Transfer detection
  db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_transfer_pair ON transactions(transfer_pair_id)");

  // Phase 4: Wealth accumulation tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS allocation_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'default',
      asset_class TEXT NOT NULL,
      target_pct REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, asset_class)
    );

    CREATE TABLE IF NOT EXISTS wealth_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('net_worth','account','investment_total')),
      account_id INTEGER REFERENCES accounts(id),
      achieved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedDefaultRules(db: Database.Database): void {
  const getCat = db.prepare("SELECT id FROM categories WHERE full_path = ?");
  const insertRule = db.prepare(
    "INSERT OR IGNORE INTO categorization_rules (pattern, category_id, priority, match_type, is_default) VALUES (?, ?, ?, 'contains', 1)"
  );

  const seed = db.transaction(() => {
    for (let i = 0; i < DEFAULT_RULES.length; i++) {
      const rule = DEFAULT_RULES[i];
      const cat = getCat.get(rule.category) as { id: number } | undefined;
      if (cat) {
        insertRule.run(rule.pattern, cat.id, DEFAULT_RULES.length - i);
      }
    }
  });

  seed();
}
