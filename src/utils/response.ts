/**
 * Shared MCP response helpers used by all tool files.
 */

type McpContent = { type: "text"; text: string };
type McpResponse = { content: McpContent[]; isError?: boolean };

export function jsonResponse(data: unknown): McpResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResponse(
  msg: string,
  detail?: Record<string, unknown>
): McpResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(detail ? { error: msg, ...detail } : { error: msg }, null, 2),
      },
    ],
    isError: true,
  };
}

export function tableResponse(
  summary: Record<string, unknown>,
  tableString: string
): McpResponse {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(summary, null, 2) },
      { type: "text" as const, text: tableString },
    ],
  };
}
