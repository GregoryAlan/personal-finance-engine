# Personal Finance Engine

MCP server for wealth tracking, investment analysis, and personal finance.

## What It Does

Import bank and brokerage CSVs, track net worth and allocation over time, analyze spending, and run projections — all through 20 MCP tools. Self-contained: no external APIs, everything runs from imported data with a local SQLite database.

## Install

```bash
git clone https://github.com/GregoryAlan/personal-finance-engine.git
cd personal-finance-engine
npm install
npm run build
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "finance": {
      "command": "node",
      "args": ["/path/to/personal-finance-engine/build/index.js"]
    }
  }
}
```

**Claude Code** — the repo includes `.mcp.json`, just build and restart.

## Supported Institutions

Chase, Bank of America, Schwab, Fidelity, Vanguard, Amex, Discover, Apple Card, Capital One, Citi, Wells Fargo, USAA.

For other formats, read the CSV headers and provide a `column_mapping`.

## Tools (20)

### Wealth & Allocation (4)

| Tool | Purpose |
|------|---------|
| `wealth_summary` | Primary dashboard: net worth, performance, allocation, drift, contributions vs growth, milestones |
| `allocation` | View current allocation, set targets, check drift, get rebalance suggestions |
| `milestones` | Create/track wealth goals (net worth, account, investment targets) |
| `portfolio_risk` | Risk analysis: Sharpe/Sortino ratios, volatility, max drawdown, HHI concentration, Monte Carlo simulation, FI planning |

### Data Management (7)

| Tool | Purpose |
|------|---------|
| `import_csv` | Import bank/credit card CSV with auto-detection |
| `manage_accounts` | Create/list/update accounts |
| `import_holdings` | Import investment positions |
| `snapshot_holdings` | Carry forward holdings snapshots, update positions, list snapshot history |
| `categorize` | Manage rules, assign categories, detect transfers, renormalize merchants |
| `edit_transaction` | Update, split, exclude, bulk-update, view history |
| `query_sql` | Raw SQL access — reads return rows, writes return changes count |

### Queries (3)

| Tool | Purpose |
|------|---------|
| `query_transactions` | Filter and group transactions — supports merchant, tags, exclude_transfers |
| `get_balances` | Account balances and net worth at any date |
| `get_holdings` | Investment positions with allocation grouping |

### Analysis & Projections (6)

| Tool | Purpose |
|------|---------|
| `financial_summary` | Balance sheet, income statement, cash flow |
| `spending_analysis` | Category breakdown with drill-down |
| `net_worth_history` | Net worth time series with decomposition and trend analysis |
| `detect_recurring` | Find subscriptions and regular payments |
| `forecast` | Project cash flow or net worth forward with investment return modeling |
| `scenario` | What-if modeling: adjust spending, contributions, return assumptions |

## Design

- **Wealth-first** — `wealth_summary` is the primary tool; transaction analysis is secondary
- **Self-contained** — no external price APIs, uses imported data only
- **Fingerprint dedup** — re-importing the same CSV is safe, duplicates are skipped
- **Holdings are snapshots** — import current positions periodically, not a trade ledger
- **Simple returns, not time-weighted** — honest about limitations; point-to-point with annualization
- **~60 default categorization rules** — hierarchical categories (`Food > Groceries`), auto-applied on import

## License

[MIT](LICENSE)
