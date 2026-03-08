import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";

export function registerSqlTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "query_sql",
    "Execute raw SQL against the finance database. Reads auto-detect via statement type and return rows; writes return changes count. Use params array for ? placeholders. Use multi=true for multi-statement scripts (no params, no results).",
    {
      sql: z.string().describe("SQL statement to execute"),
      params: z
        .array(z.union([z.string(), z.number(), z.null(), z.boolean()]))
        .optional()
        .describe("Bind parameters for ? placeholders"),
      limit: z
        .number()
        .optional()
        .default(1000)
        .describe("Max rows returned for SELECTs. 0 = unlimited. Default 1000"),
      multi: z
        .boolean()
        .optional()
        .describe(
          "Use db.exec() for multi-statement scripts (DDL/migrations). No params, no results returned."
        ),
    },
    async ({ sql, params, limit, multi }) => {
      try {
        if (multi) {
          db.db.exec(sql);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true }, null, 2),
              },
            ],
          };
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

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    columns,
                    rows: resultRows,
                    row_count: resultRows.length,
                    truncated,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          const result = stmt.run(...bindParams);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    changes: result.changes,
                    last_insert_rowid: Number(result.lastInsertRowid),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } catch (err: unknown) {
        const error = err as Error & { code?: string };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { error: error.message, code: error.code ?? "UNKNOWN" },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
