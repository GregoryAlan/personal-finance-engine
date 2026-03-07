import BetterSqlite3 from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { initializeSchema } from "./schema.js";

export class FinanceDB {
  public db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    initializeSchema(this.db);
  }

  // --- Accounts ---

  createAccount(account: {
    name: string;
    institution?: string;
    type: string;
    is_asset?: boolean;
    is_investment?: boolean;
    currency?: string;
    notes?: string;
    opened_at?: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO accounts (name, institution, type, is_asset, is_investment, currency, notes, opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        account.name,
        account.institution ?? null,
        account.type,
        account.is_asset !== undefined ? (account.is_asset ? 1 : 0) : 1,
        account.is_investment ? 1 : 0,
        account.currency ?? "USD",
        account.notes ?? null,
        account.opened_at ?? null
      );
    return Number(result.lastInsertRowid);
  }

  updateAccount(id: number, updates: Record<string, unknown>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === "id") continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  listAccounts(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT a.*,
          (SELECT balance FROM balance_snapshots WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1) as latest_balance,
          (SELECT as_of FROM balance_snapshots WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1) as balance_as_of
        FROM accounts a
        WHERE a.closed_at IS NULL
        ORDER BY a.type, a.name`
      )
      .all() as Record<string, unknown>[];
  }

  getAccount(id: number): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
  }

  getAccountByName(name: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE name = ?").get(name) as
      | Record<string, unknown>
      | undefined;
  }

  // --- Transactions ---

  insertTransaction(txn: {
    account_id: number;
    date: string;
    description: string;
    amount: number;
    category_id?: number;
    fingerprint: string;
    institution_category?: string;
    check_number?: string;
    notes?: string;
    batch_id?: string;
  }): { id: number; action: "inserted" | "skipped" } {
    const existing = this.db
      .prepare("SELECT id FROM transactions WHERE fingerprint = ?")
      .get(txn.fingerprint) as { id: number } | undefined;

    if (existing) {
      return { id: existing.id, action: "skipped" };
    }

    const result = this.db
      .prepare(
        `INSERT INTO transactions (account_id, date, description, amount, category_id, fingerprint, institution_category, check_number, notes, batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        txn.account_id,
        txn.date,
        txn.description,
        txn.amount,
        txn.category_id ?? null,
        txn.fingerprint,
        txn.institution_category ?? null,
        txn.check_number ?? null,
        txn.notes ?? null,
        txn.batch_id ?? null
      );
    return { id: Number(result.lastInsertRowid), action: "inserted" };
  }

  queryTransactions(filters: {
    account_id?: number;
    category_path?: string;
    date_from?: string;
    date_to?: string;
    min_amount?: number;
    max_amount?: number;
    description?: string;
    uncategorized?: boolean;
    group_by?: string;
    limit?: number;
    offset?: number;
  }): { transactions?: Record<string, unknown>[]; groups?: Record<string, unknown>[]; total_count: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.account_id) {
      conditions.push("t.account_id = ?");
      params.push(filters.account_id);
    }
    if (filters.category_path) {
      conditions.push("c.full_path LIKE ?");
      params.push(`${filters.category_path}%`);
    }
    if (filters.date_from) {
      conditions.push("t.date >= ?");
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push("t.date <= ?");
      params.push(filters.date_to);
    }
    if (filters.min_amount !== undefined) {
      conditions.push("t.amount >= ?");
      params.push(filters.min_amount);
    }
    if (filters.max_amount !== undefined) {
      conditions.push("t.amount <= ?");
      params.push(filters.max_amount);
    }
    if (filters.description) {
      conditions.push("t.description LIKE ?");
      params.push(`%${filters.description}%`);
    }
    if (filters.uncategorized) {
      conditions.push("t.category_id IS NULL");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    if (filters.group_by) {
      let groupCol: string;
      let selectCol: string;
      switch (filters.group_by) {
        case "category":
          groupCol = "c.full_path";
          selectCol = "COALESCE(c.full_path, 'Uncategorized') as group_key";
          break;
        case "month":
          groupCol = "substr(t.date, 1, 7)";
          selectCol = "substr(t.date, 1, 7) as group_key";
          break;
        case "account":
          groupCol = "a.name";
          selectCol = "a.name as group_key";
          break;
        case "description":
          groupCol = "t.description";
          selectCol = "t.description as group_key";
          break;
        default:
          groupCol = "c.full_path";
          selectCol = "COALESCE(c.full_path, 'Uncategorized') as group_key";
      }

      const groups = this.db
        .prepare(
          `SELECT ${selectCol},
            SUM(t.amount) as total,
            COUNT(*) as count,
            AVG(t.amount) as avg_amount,
            MIN(t.amount) as min_amount,
            MAX(t.amount) as max_amount
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN accounts a ON t.account_id = a.id
          ${whereClause}
          GROUP BY ${groupCol}
          ORDER BY total ASC`
        )
        .all(...params) as Record<string, unknown>[];

      return { groups, total_count: groups.length };
    }

    const countResult = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        ${whereClause}`
      )
      .get(...params) as { count: number };

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const transactions = this.db
      .prepare(
        `SELECT t.*, c.full_path as category_path, a.name as account_name
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN accounts a ON t.account_id = a.id
        ${whereClause}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    return { transactions, total_count: countResult.count };
  }

  updateTransactionCategory(transactionId: number, categoryId: number): void {
    this.db
      .prepare("UPDATE transactions SET category_id = ? WHERE id = ?")
      .run(categoryId, transactionId);
  }

  // --- Categories ---

  listCategories(type?: string): Record<string, unknown>[] {
    const where = type ? "WHERE type = ?" : "";
    const params = type ? [type] : [];
    return this.db
      .prepare(`SELECT * FROM categories ${where} ORDER BY full_path`)
      .all(...params) as Record<string, unknown>[];
  }

  getCategoryByPath(path: string): { id: number; name: string; full_path: string; type: string } | undefined {
    return this.db.prepare("SELECT * FROM categories WHERE full_path = ?").get(path) as
      | { id: number; name: string; full_path: string; type: string }
      | undefined;
  }

  createCategory(name: string, parentPath: string | null, type: string): number {
    let parentId: number | null = null;
    let fullPath = name;

    if (parentPath) {
      const parent = this.getCategoryByPath(parentPath);
      if (parent) {
        parentId = parent.id;
        fullPath = `${parentPath} > ${name}`;
      }
    }

    const result = this.db
      .prepare("INSERT INTO categories (name, parent_id, full_path, type) VALUES (?, ?, ?, ?)")
      .run(name, parentId, fullPath, type);
    return Number(result.lastInsertRowid);
  }

  // --- Categorization Rules ---

  listRules(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT r.*, c.full_path as category_path
        FROM categorization_rules r
        JOIN categories c ON r.category_id = c.id
        ORDER BY r.priority DESC`
      )
      .all() as Record<string, unknown>[];
  }

  createRule(pattern: string, categoryId: number, priority?: number, matchType?: string): number {
    const maxPriority = this.db
      .prepare("SELECT COALESCE(MAX(priority), 0) as max FROM categorization_rules")
      .get() as { max: number };

    const result = this.db
      .prepare(
        "INSERT INTO categorization_rules (pattern, category_id, priority, match_type) VALUES (?, ?, ?, ?)"
      )
      .run(pattern, categoryId, priority ?? maxPriority.max + 1, matchType ?? "contains");
    return Number(result.lastInsertRowid);
  }

  applyCategorization(): { updated: number; rules_applied: Record<string, number> } {
    const rules = this.db
      .prepare(
        `SELECT r.id, r.pattern, r.category_id, r.match_type, c.full_path
        FROM categorization_rules r
        JOIN categories c ON r.category_id = c.id
        ORDER BY r.priority DESC`
      )
      .all() as { id: number; pattern: string; category_id: number; match_type: string; full_path: string }[];

    const uncategorized = this.db
      .prepare("SELECT id, description FROM transactions WHERE category_id IS NULL")
      .all() as { id: number; description: string }[];

    const updateStmt = this.db.prepare("UPDATE transactions SET category_id = ? WHERE id = ?");
    let updated = 0;
    const rulesApplied: Record<string, number> = {};

    const apply = this.db.transaction(() => {
      for (const txn of uncategorized) {
        const upperDesc = txn.description.toUpperCase();
        for (const rule of rules) {
          let matches = false;
          const pattern = rule.pattern.toUpperCase();

          switch (rule.match_type) {
            case "contains":
              matches = upperDesc.includes(pattern);
              break;
            case "starts_with":
              matches = upperDesc.startsWith(pattern);
              break;
            case "exact":
              matches = upperDesc === pattern;
              break;
            case "regex":
              try {
                matches = new RegExp(rule.pattern, "i").test(txn.description);
              } catch {
                matches = false;
              }
              break;
          }

          if (matches) {
            updateStmt.run(rule.category_id, txn.id);
            updated++;
            rulesApplied[rule.full_path] = (rulesApplied[rule.full_path] || 0) + 1;
            break;
          }
        }
      }
    });

    apply();
    return { updated, rules_applied: rulesApplied };
  }

  listUncategorized(groupByDescription?: boolean): Record<string, unknown>[] {
    if (groupByDescription) {
      return this.db
        .prepare(
          `SELECT description, COUNT(*) as count, SUM(amount) as total,
            MIN(date) as first_seen, MAX(date) as last_seen
          FROM transactions
          WHERE category_id IS NULL
          GROUP BY description
          ORDER BY count DESC`
        )
        .all() as Record<string, unknown>[];
    }

    return this.db
      .prepare(
        `SELECT t.*, a.name as account_name
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.category_id IS NULL
        ORDER BY t.date DESC
        LIMIT 200`
      )
      .all() as Record<string, unknown>[];
  }

  assignCategory(transactionIds: number[], categoryId: number): number {
    const placeholders = transactionIds.map(() => "?").join(",");
    const result = this.db
      .prepare(`UPDATE transactions SET category_id = ? WHERE id IN (${placeholders})`)
      .run(categoryId, ...transactionIds);
    return result.changes;
  }

  // --- Balance Snapshots ---

  recordBalance(accountId: number, balance: number, asOf: string, source?: string): void {
    this.db
      .prepare(
        `INSERT INTO balance_snapshots (account_id, balance, as_of, source)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, as_of) DO UPDATE SET balance = excluded.balance, source = excluded.source`
      )
      .run(accountId, balance, asOf, source ?? "import");
  }

  getBalances(asOf?: string): Record<string, unknown>[] {
    if (asOf) {
      return this.db
        .prepare(
          `SELECT a.id, a.name, a.type, a.is_asset, a.is_investment,
            (SELECT balance FROM balance_snapshots WHERE account_id = a.id AND as_of <= ? ORDER BY as_of DESC LIMIT 1) as balance,
            (SELECT as_of FROM balance_snapshots WHERE account_id = a.id AND as_of <= ? ORDER BY as_of DESC LIMIT 1) as balance_as_of
          FROM accounts a
          WHERE a.closed_at IS NULL
          ORDER BY a.type, a.name`
        )
        .all(asOf, asOf) as Record<string, unknown>[];
    }

    return this.db
      .prepare(
        `SELECT a.id, a.name, a.type, a.is_asset, a.is_investment,
          (SELECT balance FROM balance_snapshots WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1) as balance,
          (SELECT as_of FROM balance_snapshots WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1) as balance_as_of
        FROM accounts a
        WHERE a.closed_at IS NULL
        ORDER BY a.type, a.name`
      )
      .all() as Record<string, unknown>[];
  }

  // --- Holdings ---

  upsertHoldings(
    accountId: number,
    asOf: string,
    holdings: {
      symbol: string;
      name?: string;
      shares: number;
      cost_basis?: number;
      current_value?: number;
      asset_class?: string;
    }[]
  ): number {
    // Delete existing holdings for this account+date, then insert fresh
    this.db
      .prepare("DELETE FROM holdings WHERE account_id = ? AND as_of = ?")
      .run(accountId, asOf);

    const insert = this.db.prepare(
      `INSERT INTO holdings (account_id, symbol, name, shares, cost_basis, current_value, asset_class, as_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const upsert = this.db.transaction(() => {
      for (const h of holdings) {
        insert.run(
          accountId,
          h.symbol,
          h.name ?? null,
          h.shares,
          h.cost_basis ?? null,
          h.current_value ?? null,
          h.asset_class ?? null,
          asOf
        );
      }
    });

    upsert();

    // Also record total balance
    const totalValue = holdings.reduce((sum, h) => sum + (h.current_value ?? 0), 0);
    if (totalValue > 0) {
      this.recordBalance(accountId, totalValue, asOf, "holdings");
    }

    return holdings.length;
  }

  getHoldings(filters: {
    account_id?: number;
    symbol?: string;
    as_of?: string;
    group_by?: string;
  }): { holdings?: Record<string, unknown>[]; groups?: Record<string, unknown>[]; total_value: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.account_id) {
      conditions.push("h.account_id = ?");
      params.push(filters.account_id);
    }
    if (filters.symbol) {
      conditions.push("h.symbol = ?");
      params.push(filters.symbol);
    }

    // Get latest holdings per account+symbol
    let dateFilter = "";
    if (filters.as_of) {
      dateFilter = `AND h.as_of <= ?`;
      params.push(filters.as_of);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")} ${dateFilter}` : dateFilter ? `WHERE 1=1 ${dateFilter}` : "";

    if (filters.group_by) {
      let groupCol: string;
      let selectCol: string;
      switch (filters.group_by) {
        case "asset_class":
          groupCol = "h.asset_class";
          selectCol = "COALESCE(h.asset_class, 'other') as group_key";
          break;
        case "account":
          groupCol = "a.name";
          selectCol = "a.name as group_key";
          break;
        case "symbol":
          groupCol = "h.symbol";
          selectCol = "h.symbol as group_key";
          break;
        default:
          groupCol = "h.asset_class";
          selectCol = "COALESCE(h.asset_class, 'other') as group_key";
      }

      const groups = this.db
        .prepare(
          `SELECT ${selectCol},
            SUM(h.current_value) as total_value,
            SUM(h.cost_basis) as total_cost_basis,
            COUNT(*) as position_count
          FROM holdings h
          JOIN accounts a ON h.account_id = a.id
          ${whereClause}
          AND h.as_of = (SELECT MAX(h2.as_of) FROM holdings h2 WHERE h2.account_id = h.account_id AND h2.symbol = h.symbol ${filters.as_of ? "AND h2.as_of <= ?" : ""})
          GROUP BY ${groupCol}
          ORDER BY total_value DESC`
        )
        .all(...params, ...(filters.as_of ? [filters.as_of] : [])) as Record<string, unknown>[];

      const totalValue = groups.reduce((sum, g) => sum + ((g.total_value as number) || 0), 0);

      // Add allocation percentages
      for (const g of groups) {
        g.allocation_pct = totalValue > 0 ? Math.round(((g.total_value as number) / totalValue) * 10000) / 100 : 0;
      }

      return { groups, total_value: totalValue };
    }

    const holdings = this.db
      .prepare(
        `SELECT h.*, a.name as account_name
        FROM holdings h
        JOIN accounts a ON h.account_id = a.id
        ${whereClause}
        AND h.as_of = (SELECT MAX(h2.as_of) FROM holdings h2 WHERE h2.account_id = h.account_id AND h2.symbol = h.symbol ${filters.as_of ? "AND h2.as_of <= ?" : ""})
        ORDER BY h.current_value DESC`
      )
      .all(...params, ...(filters.as_of ? [filters.as_of] : [])) as Record<string, unknown>[];

    const totalValue = holdings.reduce((sum, h) => sum + ((h.current_value as number) || 0), 0);

    return { holdings, total_value: totalValue };
  }

  // --- Recurring Patterns ---

  upsertRecurring(pattern: {
    description_pattern: string;
    category_id?: number;
    frequency: string;
    typical_amount: number;
    amount_variance?: number;
    last_seen?: string;
    next_expected?: string;
    is_income: boolean;
  }): number {
    const existing = this.db
      .prepare("SELECT id FROM recurring_patterns WHERE description_pattern = ?")
      .get(pattern.description_pattern) as { id: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE recurring_patterns SET
            category_id = COALESCE(?, category_id),
            frequency = ?, typical_amount = ?, amount_variance = ?,
            last_seen = ?, next_expected = ?, is_income = ?, is_active = 1
          WHERE id = ?`
        )
        .run(
          pattern.category_id ?? null,
          pattern.frequency,
          pattern.typical_amount,
          pattern.amount_variance ?? null,
          pattern.last_seen ?? null,
          pattern.next_expected ?? null,
          pattern.is_income ? 1 : 0,
          existing.id
        );
      return existing.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO recurring_patterns (description_pattern, category_id, frequency, typical_amount, amount_variance, last_seen, next_expected, is_income)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pattern.description_pattern,
        pattern.category_id ?? null,
        pattern.frequency,
        pattern.typical_amount,
        pattern.amount_variance ?? null,
        pattern.last_seen ?? null,
        pattern.next_expected ?? null,
        pattern.is_income ? 1 : 0
      );
    return Number(result.lastInsertRowid);
  }

  getRecurringPatterns(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT rp.*, c.full_path as category_path
        FROM recurring_patterns rp
        LEFT JOIN categories c ON rp.category_id = c.id
        WHERE rp.is_active = 1
        ORDER BY rp.is_income DESC, ABS(rp.typical_amount) DESC`
      )
      .all() as Record<string, unknown>[];
  }

  // --- Import Log ---

  logImport(entry: {
    batch_id: string;
    filename?: string;
    institution?: string;
    account_id?: number;
    rows_imported: number;
    rows_skipped: number;
    rows_errored: number;
    date_range_start?: string;
    date_range_end?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO import_log (batch_id, filename, institution, account_id, rows_imported, rows_skipped, rows_errored, date_range_start, date_range_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.batch_id,
        entry.filename ?? null,
        entry.institution ?? null,
        entry.account_id ?? null,
        entry.rows_imported,
        entry.rows_skipped,
        entry.rows_errored,
        entry.date_range_start ?? null,
        entry.date_range_end ?? null
      );
  }

  // --- Analysis Helpers ---

  getTransactionsForPeriod(dateFrom: string, dateTo: string, type?: string): Record<string, unknown>[] {
    let typeFilter = "";
    const params: unknown[] = [dateFrom, dateTo];
    if (type === "expense") {
      typeFilter = "AND t.amount < 0 AND (c.type = 'expense' OR c.type IS NULL)";
    } else if (type === "income") {
      typeFilter = "AND t.amount > 0 AND c.type = 'income'";
    }

    return this.db
      .prepare(
        `SELECT t.*, c.full_path as category_path, c.type as category_type, a.name as account_name
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN accounts a ON t.account_id = a.id
        WHERE t.date >= ? AND t.date <= ? ${typeFilter}
        ORDER BY t.date DESC`
      )
      .all(...params) as Record<string, unknown>[];
  }

  getMonthlyTotals(dateFrom: string, dateTo: string): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT
          substr(t.date, 1, 7) as month,
          SUM(CASE WHEN t.amount > 0 AND c.type = 'income' THEN t.amount ELSE 0 END) as income,
          SUM(CASE WHEN t.amount < 0 AND (c.type = 'expense' OR c.type IS NULL) THEN ABS(t.amount) ELSE 0 END) as expenses,
          SUM(CASE WHEN t.amount > 0 AND c.type = 'income' THEN t.amount ELSE 0 END) +
          SUM(CASE WHEN t.amount < 0 AND (c.type = 'expense' OR c.type IS NULL) THEN t.amount ELSE 0 END) as net
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.date >= ? AND t.date <= ?
          AND (c.type IS NULL OR c.type != 'transfer')
        GROUP BY substr(t.date, 1, 7)
        ORDER BY month`
      )
      .all(dateFrom, dateTo) as Record<string, unknown>[];
  }

  getNetWorthHistory(months: number = 12): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT
          bs.as_of as date,
          a.name as account_name,
          a.type as account_type,
          a.is_asset,
          bs.balance
        FROM balance_snapshots bs
        JOIN accounts a ON bs.account_id = a.id
        WHERE bs.as_of >= date('now', ?)
        ORDER BY bs.as_of`
      )
      .all(`-${months} months`) as Record<string, unknown>[];
  }

  close(): void {
    this.db.close();
  }
}
