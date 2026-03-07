# Personal Finance Engine

MCP server for personal finance analysis. Import bank/brokerage CSVs, query transactions, analyze spending, and run projections.

## Quick Start

```bash
cd personal-finance-engine
npm run build
```

Register in Claude Code MCP settings:
```json
{
  "mcpServers": {
    "finance": {
      "command": "node",
      "args": ["/Users/greg/Projects/personal-finance-engine/build/index.js"]
    }
  }
}
```

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

### 4. Import holdings
```
import_holdings account_id=3 as_of="2025-01-15" file_path="/path/to/schwab_positions.csv"
```

Or manual entry for smaller portfolios.

### 5. Query & analyze
```
query_transactions date_from="2025-01-01" group_by="category"
query_transactions description="AMAZON" date_from="2025-01-01"
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

## Tools Reference (13 total)

### Data Management
| Tool | Purpose |
|------|---------|
| `import_csv` | Import bank/credit card CSV with auto-detection |
| `manage_accounts` | Create/list/update accounts |
| `import_holdings` | Import investment positions |
| `categorize` | Manage categorization rules and assign categories |

### Queries
| Tool | Purpose |
|------|---------|
| `query_transactions` | Swiss army knife — filter + group_by = any report |
| `get_balances` | Account balances and net worth at any date |
| `get_holdings` | Investment positions with allocation grouping |

### Analysis
| Tool | Purpose |
|------|---------|
| `financial_summary` | Balance sheet, income statement, cash flow |
| `spending_analysis` | Category breakdown with drill-down |
| `net_worth_history` | Net worth time series |
| `detect_recurring` | Find subscriptions and regular payments |

### Projections
| Tool | Purpose |
|------|---------|
| `forecast` | Project cash flow or net worth forward |
| `scenario` | What-if modeling with baseline comparison |

## Key Design Decisions

- **Amounts always signed**: negative = money out, positive = money in
- **Fingerprint dedup**: re-importing same CSV is safe, duplicates are skipped
- **Categories are hierarchical**: `Food > Groceries`, queryable with prefix match
- **Holdings are snapshots**: import current positions periodically, not a trade ledger
- **Balance snapshots**: ground truth independent of transaction math (critical for investment accounts)
- **group_by on query tools**: this is what makes it an engine — Claude composes queries for any question

## Data Location

- Database: `data/finance.db`
- CSV drop folder: `data/imports/`
