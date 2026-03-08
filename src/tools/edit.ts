import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FinanceDB } from "../db/database.js";
import { extractMerchant } from "../import/merchant.js";
import { jsonResponse, errorResponse } from "../utils/response.js";

export function registerEditTools(server: McpServer, db: FinanceDB): void {
  server.tool(
    "edit_transaction",
    "Edit, split, exclude, or bulk-update transactions. Edits preserve fingerprint for dedup stability. Splits create child transactions and exclude the parent. All changes are logged in edit history.",
    {
      action: z
        .enum(["update", "split", "unsplit", "exclude", "restore", "bulk_update", "history"])
        .describe("Action to perform"),
      transaction_id: z
        .number()
        .optional()
        .describe("Transaction ID (required for update, split, unsplit, exclude, restore, history)"),
      description: z
        .string()
        .optional()
        .describe("New description (for update or bulk_update)"),
      amount: z
        .number()
        .optional()
        .describe("New amount (for update)"),
      category_path: z
        .string()
        .optional()
        .describe("Category to assign (for update or split items)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags to set (for update)"),
      notes: z
        .string()
        .optional()
        .describe("Notes to set (for update)"),
      splits: z
        .array(
          z.object({
            description: z.string(),
            amount: z.number(),
            category_path: z.string().optional(),
          })
        )
        .optional()
        .describe("For split: array of child transactions. Amounts must sum to parent amount."),
      match_description: z
        .string()
        .optional()
        .describe("For bulk_update: match transactions containing this text"),
    },
    { destructiveHint: true, openWorldHint: false },
    async ({
      action,
      transaction_id,
      description,
      amount,
      category_path,
      tags,
      notes,
      splits,
      match_description,
    }) => {
      if (action === "update") {
        if (!transaction_id) {
          return errorResponse("transaction_id required");
        }

        const updates: Record<string, unknown> = {};
        if (description !== undefined) {
          updates.description = description;
          updates.merchant = extractMerchant(description);
        }
        if (amount !== undefined) updates.amount = amount;
        if (notes !== undefined) updates.notes = notes;
        if (tags !== undefined) updates.tags = tags.join(",");

        if (category_path) {
          const cat = db.getCategoryByPath(category_path);
          if (!cat) {
            return errorResponse(`Category not found: ${category_path}`);
          }
          updates.category_id = cat.id;
        }

        if (Object.keys(updates).length === 0) {
          return errorResponse("No fields to update");
        }

        db.updateTransaction(transaction_id, updates);
        const updated = db.getTransaction(transaction_id);

        return jsonResponse({ updated });
      }

      if (action === "split") {
        if (!transaction_id || !splits || splits.length === 0) {
          return errorResponse("transaction_id and splits required");
        }

        // Validate split amounts sum to parent
        const parent = db.getTransaction(transaction_id);
        if (!parent) {
          return errorResponse("Transaction not found");
        }

        const splitSum = Math.round(splits.reduce((s, sp) => s + sp.amount, 0) * 100) / 100;
        const parentAmount = Math.round((parent.amount as number) * 100) / 100;
        if (splitSum !== parentAmount) {
          return errorResponse(`Split amounts (${splitSum}) must equal parent amount (${parentAmount})`);
        }

        // Resolve categories and merchants for splits
        const resolvedSplits = splits.map((sp) => {
          let categoryId: number | undefined;
          if (sp.category_path) {
            const cat = db.getCategoryByPath(sp.category_path);
            if (cat) categoryId = cat.id;
          }
          return {
            description: sp.description,
            amount: sp.amount,
            category_id: categoryId,
            merchant: extractMerchant(sp.description),
          };
        });

        const childIds = db.splitTransaction(transaction_id, resolvedSplits);

        return jsonResponse({
          split: {
            parent_id: transaction_id,
            parent_excluded: true,
            children: childIds.map((id, i) => ({
              id,
              description: splits[i].description,
              amount: splits[i].amount,
              category: splits[i].category_path,
            })),
          },
        });
      }

      if (action === "unsplit") {
        if (!transaction_id) {
          return errorResponse("transaction_id required");
        }
        db.unsplitTransaction(transaction_id);
        const restored = db.getTransaction(transaction_id);
        return jsonResponse({ restored });
      }

      if (action === "exclude") {
        if (!transaction_id) {
          return errorResponse("transaction_id required");
        }
        db.updateTransaction(transaction_id, { is_excluded: 1 }, "exclude");
        return jsonResponse({ excluded: transaction_id });
      }

      if (action === "restore") {
        if (!transaction_id) {
          return errorResponse("transaction_id required");
        }
        db.updateTransaction(transaction_id, { is_excluded: 0 }, "restore");
        const restored = db.getTransaction(transaction_id);
        return jsonResponse({ restored });
      }

      if (action === "bulk_update") {
        if (!match_description) {
          return errorResponse("match_description required");
        }

        const updates: Record<string, unknown> = {};
        if (description !== undefined) {
          updates.description = description;
          updates.merchant = extractMerchant(description);
        }
        if (category_path) {
          const cat = db.getCategoryByPath(category_path);
          if (!cat) {
            return errorResponse(`Category not found: ${category_path}`);
          }
          updates.category_id = cat.id;
        }
        if (tags !== undefined) updates.tags = tags.join(",");
        if (notes !== undefined) updates.notes = notes;

        if (Object.keys(updates).length === 0) {
          return errorResponse("No fields to update");
        }

        const result = db.bulkUpdateTransactions(match_description, updates);
        return jsonResponse(result);
      }

      if (action === "history") {
        if (!transaction_id) {
          return errorResponse("transaction_id required");
        }
        const history = db.getTransactionEditHistory(transaction_id);
        const txn = db.getTransaction(transaction_id);
        return jsonResponse({ transaction: txn, edits: history });
      }

      return errorResponse("Unknown action");
    }
  );
}
