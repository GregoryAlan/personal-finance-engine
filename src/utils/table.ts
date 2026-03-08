/**
 * Compact pipe-aligned table formatter for MCP row data.
 * Reduces token usage ~75% vs JSON for tabular results.
 */

export interface FormatTableOptions {
  /** Explicit column subset/order */
  columns?: string[];
  /** Truncate long strings (default 40) */
  maxColWidth?: number;
  /** Right-align these columns (auto-detected for numbers if not provided) */
  rightAlign?: Set<string>;
  /** Per-column formatting functions */
  formatters?: Record<string, (v: unknown) => string>;
}

export function formatTable(
  rows: Record<string, unknown>[],
  options: FormatTableOptions = {}
): string {
  if (rows.length === 0) return "(no rows)";

  const maxColWidth = options.maxColWidth ?? 40;

  // Determine columns
  const columns =
    options.columns ??
    Object.keys(rows[0]).filter((k) => {
      // Skip columns that are all null/undefined
      return rows.some((r) => r[k] != null);
    });

  if (columns.length === 0) return "(no columns)";

  // Format all cell values
  const formatted: string[][] = rows.map((row) =>
    columns.map((col) => {
      const val = row[col];
      if (val == null) return "";
      if (options.formatters?.[col]) return options.formatters[col](val);
      if (typeof val === "number") {
        // Auto-format money-like numbers (2 decimal places)
        return Number.isInteger(val) ? String(val) : val.toFixed(2);
      }
      if (typeof val === "boolean") return val ? "yes" : "no";
      const str = String(val);
      return str.length > maxColWidth
        ? str.slice(0, maxColWidth - 1) + "\u2026"
        : str;
    })
  );

  // Auto-detect right-align for numeric columns
  const rightAlign =
    options.rightAlign ??
    new Set(
      columns.filter((col) =>
        rows.some((r) => typeof r[col] === "number")
      )
    );

  // Calculate column widths (min: header length, max: maxColWidth)
  const widths = columns.map((col, i) => {
    const headerLen = col.length;
    const maxData = formatted.reduce(
      (max, row) => Math.max(max, row[i].length),
      0
    );
    return Math.min(Math.max(headerLen, maxData), maxColWidth);
  });

  // Build header
  const header = columns
    .map((col, i) =>
      rightAlign.has(col) ? col.padStart(widths[i]) : col.padEnd(widths[i])
    )
    .join(" | ");

  const separator = widths.map((w) => "-".repeat(w)).join(" | ");

  // Build rows
  const dataRows = formatted.map((row) =>
    row
      .map((cell, i) =>
        rightAlign.has(columns[i])
          ? cell.padStart(widths[i])
          : cell.padEnd(widths[i])
      )
      .join(" | ")
  );

  return [header, separator, ...dataRows].join("\n");
}
