/**
 * Shared MCP response helpers used by all tool files.
 */

type McpContent = { type: "text"; text: string };
type McpResponse = { content: McpContent[]; isError?: boolean };

const MAX_OUTPUT_CHARS = 10_000;

function truncationWarning(
  totalChars: number,
  shownChars: number
): McpContent {
  return {
    type: "text" as const,
    text: JSON.stringify(
      {
        _warning: "Output truncated — too large for context window",
        total_chars: totalChars,
        shown_chars: shownChars,
        hint: "Use filters, GROUP BY, or LIMIT to reduce output size",
      },
      null,
      2
    ),
  };
}

export function jsonResponse(data: unknown): McpResponse {
  const serialized = JSON.stringify(data, null, 2);
  if (serialized.length <= MAX_OUTPUT_CHARS) {
    return { content: [{ type: "text" as const, text: serialized }] };
  }
  const truncated = serialized.slice(0, MAX_OUTPUT_CHARS);
  return {
    content: [
      { type: "text" as const, text: truncated },
      truncationWarning(serialized.length, MAX_OUTPUT_CHARS),
    ],
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
  const summaryJson = JSON.stringify(summary, null, 2);
  const totalChars = summaryJson.length + tableString.length;
  if (totalChars <= MAX_OUTPUT_CHARS) {
    return {
      content: [
        { type: "text" as const, text: summaryJson },
        { type: "text" as const, text: tableString },
      ],
    };
  }
  const tableBudget = Math.max(0, MAX_OUTPUT_CHARS - summaryJson.length);
  const truncatedTable = tableString.slice(0, tableBudget);
  return {
    content: [
      { type: "text" as const, text: summaryJson },
      { type: "text" as const, text: truncatedTable },
      truncationWarning(totalChars, summaryJson.length + truncatedTable.length),
    ],
  };
}
