# Personal Finance Engine

MCP server for wealth tracking, investment analysis, and personal finance. Import bank/brokerage CSVs, track net worth and allocation, analyze performance, set goals, and run projections.

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

### 2. Import data
Drop CSVs in `data/imports/`, then:
```
import_csv file_path="/path/to/chase_checking.csv" account_id=1
import_holdings account_id=3 as_of="2025-01-15" file_path="/path/to/schwab_positions.csv"
```

Auto-detects: Chase, BoA, Schwab, Fidelity, Vanguard, Amex, Discover, Apple Card, Capital One, Citi, Wells Fargo, USAA.

For unknown formats, read headers and provide column_mapping.

### 3. Categorize & link transfers
```
categorize action=list_uncategorized group_by_description=true
categorize action=create_rule pattern="WHOLE FOODS" category_path="Food > Groceries"
categorize action=auto_categorize
categorize action=detect_transfers
```

Ships with ~60 default rules. Each import auto-applies rules. Transfer detection links matching cross-account transactions and excludes them from income/expense analysis.

### 4. Wealth dashboard
```
wealth_summary period=ytd
wealth_summary period=1y include_drift=true include_rebalance=true
```

Primary tool — shows net worth, allocation, performance, contribution vs growth, drift, and milestone progress in one call.

### 5. Set allocation targets & milestones
```
allocation action=set_target targets=[{asset_class:"us_stock",target_pct:60},{asset_class:"bond",target_pct:30},{asset_class:"intl_stock",target_pct:10}]
allocation action=drift
milestones action=create name="$1M Net Worth" target_amount=1000000 target_type=net_worth
milestones action=check
```

### 6. Track growth over time
```
net_worth_history months=24 decompose=true trend=true
get_holdings group_by="asset_class"
```

### 7. Project & scenario
```
forecast type="net_worth" months=12 investment_return=7 monthly_contribution=1000
forecast type="cash_flow" adjustments=[{description: "Side gig", monthly_amount: 2000}]
scenario name="Max out 401k" adjustments=[{type:"increase_contribution", description:"Max 401k", amount:1875}] investment_return=7
scenario name="Bear market" adjustments=[{type:"change_return_assumption", description:"Bear market returns", amount:-5}] investment_return=7
```

### 8. Transaction analysis (secondary)
```
query_transactions date_from="2025-01-01" group_by="category"
query_transactions group_by="merchant" exclude_transfers=true
financial_summary type="income_statement" compare="previous_period"
spending_analysis category="Food"
detect_recurring
```

## Tools Reference (18 total)

### Wealth & Allocation
| Tool | Purpose |
|------|---------|
| `wealth_summary` | Primary dashboard: net worth, performance, allocation, drift, contributions vs growth, milestones |
| `allocation` | View current allocation, set targets, check drift, get rebalance suggestions |
| `milestones` | Create/track wealth goals (net worth, account, investment targets) |

### Data Management
| Tool | Purpose |
|------|---------|
| `import_csv` | Import bank/credit card CSV with auto-detection |
| `manage_accounts` | Create/list/update accounts |
| `import_holdings` | Import investment positions |
| `categorize` | Manage rules, assign categories, detect transfers, renormalize merchants |
| `edit_transaction` | Update, split, exclude, bulk-update, view history |
| `query_sql` | Raw SQL access — reads return rows, writes return changes count |

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
| `net_worth_history` | Net worth time series with decomposition and trend analysis |
| `detect_recurring` | Find subscriptions and regular payments (uses merchant for grouping) |

### Projections
| Tool | Purpose |
|------|---------|
| `forecast` | Project cash flow or net worth forward with investment return modeling |
| `scenario` | What-if modeling: adjust spending, contributions, return assumptions |

### Direct SQL Access
```
query_sql sql="SELECT name FROM sqlite_master WHERE type='table'"
query_sql sql="SELECT * FROM transactions WHERE amount < ? AND date > ?" params=[-500, "2025-01-01"] limit=10
query_sql sql="UPDATE transactions SET notes='reviewed' WHERE id=42"
```

Use for manual inserts, bulk fixes, schema inspection, or any query the pre-built tools don't cover.

## Key Design Decisions

- **Wealth-first**: `wealth_summary` is the primary tool. Transaction analysis is secondary.
- **Amounts always signed**: negative = money out, positive = money in
- **Fingerprint dedup**: re-importing same CSV is safe, duplicates are skipped. Edits preserve fingerprints.
- **Categories are hierarchical**: `Food > Groceries`, queryable with prefix match
- **Holdings are snapshots**: import current positions periodically, not a trade ledger. Performance is snapshot-to-snapshot.
- **Simple returns, not time-weighted**: honest about limitations — we don't have daily valuations. Point-to-point with annualization.
- **Balance snapshots**: ground truth independent of transaction math (critical for investment accounts)
- **Contribution detection via transfer linking**: `Transfer > Investment Contribution` category from transfer detection. No separate contribution table.
- **Target allocation at asset-class level**: not per-security. Matches how most people think about allocation.
- **Milestones evaluated on demand**: fits the MCP interaction pattern.
- **Forecast uses simple monthly compounding**: `balance × (1 + annual_return/12/100)`
- **No external price APIs**: system is self-contained, uses imported values only.
- **group_by on query tools**: composable queries for any question
- **Merchant normalization**: raw descriptions cleaned to canonical names on import
- **Transfer detection**: linked transfers excluded from income/expense to prevent double-counting

## Data Location

- Database: `data/finance.db`
- CSV drop folder: `data/imports/`
