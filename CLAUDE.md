# Personal Finance Engine

MCP server for personal finance analysis. Import bank/brokerage CSVs, query transactions, analyze spending, and run projections.

## Quick Start

```bash
npm run build
```

MCP config is in `.mcp.json` — restart Claude Code after building.

## Workflow

### 1. Set up accounts
```
manage_accounts action=create name="Chase Checking" institution="Chase" type="checking"
manage_accounts action=create name="Chase Sapphire" institution="Chase" type="credit_card" is_asset=false
manage_accounts action=create name="Schwab Brokerage" institution="Schwab" type="brokerage"
manage_accounts action=create name="Fidelity 401k" institution="Fidelity" type="401k"
```

### 2. Import transactions
Drop CSVs in `data/imports/`, then:
```
import_csv file_path="/path/to/chase_checking.csv" account_id=1
import_csv file_path="/path/to/chase_credit.csv" account_id=2
```

Auto-detects: Chase, BoA, Schwab, Fidelity, Vanguard, Amex, Discover, Apple Card, Capital One, Citi, Wells Fargo, USAA.

For unknown formats, read headers and provide column_mapping.

### 3. Categorize
```
categorize action=list_uncategorized group_by_description=true
categorize action=create_rule pattern="WHOLE FOODS" category_path="Food > Groceries"
categorize action=auto_categorize
```

Ships with ~60 default rules. Each import auto-applies rules. Review uncategorized periodically — each rule persists for future imports.

### 3b. Detect & link transfers
```
categorize action=detect_transfers dry_run=true
categorize action=detect_transfers
categorize action=link_transfer transaction_id_a=145 transaction_id_b=203
categorize action=unlink_transfer transaction_id=145
categorize action=list_transfers
```

Auto-detects matching transactions across accounts (same amount, opposite signs, within N days). Linked transfers are excluded from income/expense analysis.

### 3c. Edit transactions
```
edit_transaction action=update transaction_id=42 description="Amazon - Desk Chair" tags=["office","reimbursable"]
edit_transaction action=split transaction_id=99 splits=[{description:"Groceries",amount:-100,category_path:"Food > Groceries"},{description:"Household",amount:-50,category_path:"Shopping > Household"}]
edit_transaction action=unsplit transaction_id=99
edit_transaction action=exclude transaction_id=15
edit_transaction action=restore transaction_id=15
edit_transaction action=bulk_update match_description="AMZN" description="Amazon"
edit_transaction action=history transaction_id=42
```

Edits preserve fingerprint for dedup stability. Splits create children and exclude parent.

### 3d. Renormalize merchants
```
categorize action=renormalize
```

Re-extracts merchant names from all transaction descriptions. Run after updating merchant rules.

### 4. Import holdings
```
import_holdings account_id=3 as_of="2025-01-15" file_path="/path/to/schwab_positions.csv"
```

Or manual entry for smaller portfolios.

### 5. Query & analyze
```
query_transactions date_from="2025-01-01" group_by="category"
query_transactions group_by="merchant" exclude_transfers=true
query_transactions description="AMAZON" date_from="2025-01-01"
query_transactions merchant="Amazon" date_from="2025-01-01"
query_transactions tags="reimbursable"
financial_summary type="income_statement" compare="previous_period"
financial_summary type="balance_sheet"
spending_analysis category="Food"
net_worth_history months=24 include_accounts=true
detect_recurring
get_holdings group_by="asset_class"
get_balances
```

### 6. Project & scenario
```
forecast type="net_worth" months=12
forecast type="cash_flow" adjustments=[{description: "Side gig", monthly_amount: 2000}]
scenario name="Cut subscriptions" adjustments=[{type: "stop_recurring", description: "Netflix", amount: 15.99}, {type: "stop_recurring", description: "Spotify", amount: 12.99}] savings_target=10000
```

## Tools Reference (14 total)

### Data Management
| Tool | Purpose |
|------|---------|
| `import_csv` | Import bank/credit card CSV with auto-detection |
| `manage_accounts` | Create/list/update accounts |
| `import_holdings` | Import investment positions |
| `categorize` | Manage rules, assign categories, detect transfers, renormalize merchants |
| `edit_transaction` | Update, split, exclude, bulk-update, view history |

### Queries
| Tool | Purpose |
|------|---------|
| `query_transactions` | Swiss army knife — filter + group_by = any report. Supports merchant filter/grouping, tags, exclude_transfers |
| `get_balances` | Account balances and net worth at any date |
| `get_holdings` | Investment positions with allocation grouping |

### Analysis
| Tool | Purpose |
|------|---------|
| `financial_summary` | Balance sheet, income statement, cash flow |
| `spending_analysis` | Category breakdown with drill-down (uses merchant for grouping) |
| `net_worth_history` | Net worth time series |
| `detect_recurring` | Find subscriptions and regular payments (uses merchant for grouping) |

### Projections
| Tool | Purpose |
|------|---------|
| `forecast` | Project cash flow or net worth forward |
| `scenario` | What-if modeling with baseline comparison |

## Key Design Decisions

- **Amounts always signed**: negative = money out, positive = money in
- **Fingerprint dedup**: re-importing same CSV is safe, duplicates are skipped. Edits preserve fingerprints.
- **Categories are hierarchical**: `Food > Groceries`, queryable with prefix match
- **Holdings are snapshots**: import current positions periodically, not a trade ledger
- **Balance snapshots**: ground truth independent of transaction math (critical for investment accounts)
- **group_by on query tools**: this is what makes it an engine — Claude composes queries for any question
- **Merchant normalization**: Raw descriptions cleaned to canonical names on import. `group_by=merchant` for clean grouping.
- **Transfer detection**: Linked transfers excluded from income/expense analysis to prevent double-counting
- **Transaction editing**: Splits use parent/child model. Excluded transactions filtered from all queries by default.
- **Edit history**: All changes logged in `transaction_edits` table for audit trail

## Data Location

- Database: `data/finance.db`
- CSV drop folder: `data/imports/`
