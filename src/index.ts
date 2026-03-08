#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { FinanceDB } from "./db/database.js";
import { registerImportTools } from "./tools/import.js";
import { registerQueryTools } from "./tools/query.js";
import { registerAnalyzeTools } from "./tools/analyze.js";
import { registerProjectTools } from "./tools/project.js";
import { registerEditTools } from "./tools/edit.js";
import { registerSqlTools } from "./tools/sql.js";
import { registerWealthTools } from "./tools/wealth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "finance.db");

const db = new FinanceDB(dbPath);

const server = new McpServer({
  name: "personal-finance-engine",
  version: "0.1.0",
});

registerImportTools(server, db);
registerQueryTools(server, db);
registerAnalyzeTools(server, db);
registerProjectTools(server, db);
registerEditTools(server, db);
registerSqlTools(server, db);
registerWealthTools(server, db);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Personal Finance Engine MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
