import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import { jsonResponse, errorResponse, tableResponse } from "../utils/response.js";
import { formatTable } from "../utils/table.js";

export function registerSqlTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "query_sql",
    "Execute raw SQL against the finance database. Reads auto-detect via statement type and return rows; writes return changes count. Use params array for ? placeholders. Use multi=true for multi-statement scripts (no params, no results). Use schema=true to inspect all table schemas.",
    {
      sql: z
        .string()
        .optional()
        .describe("SQL statement to execute (optional when schema=true)"),
      params: z
        .array(z.union([z.string(), z.number(), z.null(), z.boolean()]))
        .optional()
        .describe("Bind parameters for ? placeholders"),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe("Max rows returned for SELECTs. 0 = unlimited. Default 100"),
      multi: z
        .boolean()
        .optional()
        .describe(
          "Use db.exec() for multi-statement scripts (DDL/migrations). No params, no results returned."
        ),
      schema: z
        .boolean()
        .optional()
        .describe("Return all table schemas instead of executing SQL"),
    },
    { destructiveHint: true, openWorldHint: false },
    async ({ sql, params, limit, multi, schema }) => {
      try {
        if (schema) {
          const tables = db.db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            .all() as { name: string }[];

          const sections: string[] = [];
          for (const t of tables) {
            const cols = db.db
              .prepare(`PRAGMA table_info('${t.name}')`)
              .all() as {
              name: string;
              type: string;
              notnull: number;
              pk: number;
            }[];

            const tableStr = formatTable(
              cols.map((c) => ({
                column: c.name,
                type: c.type || "ANY",
                nullable: c.notnull ? "no" : "yes",
                pk: c.pk ? "yes" : "",
              })),
              { columns: ["column", "type", "nullable", "pk"] }
            );
            sections.push(
              `== ${t.name} (${cols.length} columns) ==\n${tableStr}`
            );
          }

          return tableResponse(
            { table_count: tables.length, tables: tables.map((t) => t.name) },
            sections.join("\n\n")
          );
        }

        if (!sql) {
          return errorResponse("sql parameter is required when schema is not set");
        }

        if (multi) {
          db.db.exec(sql);
          return jsonResponse({ success: true });
        }

        // Convert boolean params to 1/0 for SQLite
        const bindParams = (params ?? []).map((p) =>
          typeof p === "boolean" ? (p ? 1 : 0) : p
        );

        const stmt = db.db.prepare(sql);

        if (stmt.reader) {
          const rows = stmt.all(...bindParams) as Record<string, unknown>[];
          const truncated = limit > 0 && rows.length > limit;
          const resultRows = truncated ? rows.slice(0, limit) : rows;
          const columns =
            resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

          return tableResponse(
            { columns, row_count: resultRows.length, truncated },
            formatTable(resultRows)
          );
        } else {
          const result = stmt.run(...bindParams);
          return jsonResponse({
            changes: result.changes,
            last_insert_rowid: Number(result.lastInsertRowid),
          });
        }
      } catch (err: unknown) {
        const error = err as Error & { code?: string };
        return errorResponse(error.message, { code: error.code ?? "UNKNOWN" });
      }
    }
  );
}
