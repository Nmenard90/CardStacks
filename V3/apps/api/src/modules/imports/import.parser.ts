/**
 * File: import.parser.ts
 * Purpose:
 *   Pure parsing and planning logic for collection imports (CSV/XLSX).
 *
 * Why this file exists:
 *   Import correctness is a business rule, not an HTTP concern. Keeping this
 *   logic pure (no database, no Fastify) lets us unit test the merge rules
 *   exhaustively, especially the owner's rule: quantities merge ONLY within
 *   the same condition. The same card in two conditions stays two entries.
 */

import { read, utils } from "xlsx";
import { z } from "zod";
import { CardCondition } from "@prisma/client";

/**
 * Columns accepted in an import file. Header matching is case-insensitive
 * and ignores spaces/underscores so "Storage Location" and "storage_location"
 * both work.
 */
export const IMPORT_COLUMNS = ["card_id", "variant_key", "condition", "quantity", "storage_location", "notes"] as const;

/**
 * One raw row as read from the spreadsheet, before validation.
 */
export interface RawImportRow {
  rowNumber: number;
  values: Record<string, string>;
}

/**
 * One validated row ready to be applied to the database.
 */
export interface PlannedImportRow {
  cardId: string;
  variantKey: string | null;
  condition: CardCondition;
  quantity: number;
  storageLocation: string | null;
  notes: string | null;
  /**
   * Source row numbers merged into this entry. Kept so a merge is
   * explainable back to the user ("rows 4 and 9 combined").
   */
  sourceRows: number[];
}

/**
 * One rejected row with a message safe to show the user.
 */
export interface ImportRowError {
  rowNumber: number;
  message: string;
  rawRow: Record<string, string>;
}

/**
 * The full outcome of planning an import file.
 */
export interface ImportPlan {
  rows: PlannedImportRow[];
  errors: ImportRowError[];
  rowsTotal: number;
}

/**
 * Maps the many ways collectors write conditions onto the CardCondition enum.
 *
 * Why so many aliases:
 *   Import files come from other tools (TCGplayer exports, personal sheets)
 *   that each use their own labels. Rejecting "NM" would fail almost every
 *   real-world file.
 */
const CONDITION_ALIASES: Record<string, CardCondition> = {
  "nearmint": CardCondition.NEAR_MINT,
  "nm": CardCondition.NEAR_MINT,
  "mint": CardCondition.NEAR_MINT,
  "m": CardCondition.NEAR_MINT,
  "lightlyplayed": CardCondition.LIGHTLY_PLAYED,
  "lp": CardCondition.LIGHTLY_PLAYED,
  "excellent": CardCondition.LIGHTLY_PLAYED,
  "moderatelyplayed": CardCondition.MODERATELY_PLAYED,
  "mp": CardCondition.MODERATELY_PLAYED,
  "played": CardCondition.MODERATELY_PLAYED,
  "heavilyplayed": CardCondition.HEAVILY_PLAYED,
  "hp": CardCondition.HEAVILY_PLAYED,
  "poor": CardCondition.DAMAGED,
  "damaged": CardCondition.DAMAGED,
  "dmg": CardCondition.DAMAGED
};

/**
 * Normalizes a user-entered condition string to a CardCondition.
 *
 * @param raw - Condition text as it appears in the file.
 * @return The matching CardCondition, or null when unrecognized.
 */
export function normalizeCondition(raw: string): CardCondition | null {
  const key = raw.toLowerCase().replace(/[\s_-]/g, "");

  // Also accept the enum's own storage format (NEAR_MINT etc.) so files we
  // exported ourselves round-trip without translation.
  if (key in CONDITION_ALIASES) return CONDITION_ALIASES[key];

  const enumKey = raw.toUpperCase().replace(/[\s-]/g, "_");
  if (enumKey in CardCondition) return CardCondition[enumKey as keyof typeof CardCondition];

  return null;
}

/**
 * Zod schema for one import row after header normalization.
 *
 * Why quantity is coerced:
 *   Spreadsheet cells arrive as strings; "3" must count as 3. Fractions and
 *   zero are rejected because you cannot own half a card, and a zero-quantity
 *   import row is almost always a data mistake rather than an intent.
 */
const importRowSchema = z.object({
  card_id: z.string().trim().min(1, "card_id is required."),
  variant_key: z.string().trim().optional().default(""),
  condition: z.string().trim().min(1, "condition is required."),
  quantity: z.coerce.number().int("quantity must be a whole number.").positive("quantity must be at least 1."),
  storage_location: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default("")
});

/**
 * Reads a CSV or XLSX buffer into raw rows using the first sheet.
 *
 * @param buffer - Uploaded file content.
 * @return Raw rows with original spreadsheet row numbers (header = row 1).
 */
export function parseImportFile(buffer: Buffer): RawImportRow[] {
  // SheetJS auto-detects CSV vs XLSX from the buffer, which is why we do not
  // branch on file extension: extensions lie, magic bytes do not.
  const workbook = read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const records = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return records.map((record, index) => {
    const values: Record<string, string> = {};
    for (const [header, value] of Object.entries(record)) {
      // Header normalization: "Storage Location" -> "storage_location".
      const normalized = header.toLowerCase().trim().replace(/[\s-]+/g, "_");
      values[normalized] = String(value).trim();
    }
    // +2 because sheet_to_json is zero-based and skips the header row.
    return { rowNumber: index + 2, values };
  });
}

/**
 * Builds the merge identity for a row.
 *
 * Why condition is part of the key:
 *   Owner rule — only quantities of the SAME condition add together. This key
 *   mirrors the CollectionItem unique constraint
 *   (userId, cardId, variantId, condition, storageLocation) so the in-file
 *   merge and the database upsert agree on what "the same entry" means.
 */
function mergeKey(row: PlannedImportRow): string {
  return [row.cardId, row.variantKey ?? "", row.condition, row.storageLocation ?? ""].join("::");
}

/**
 * Validates raw rows and merges duplicates according to the condition rule.
 *
 * @param rawRows - Rows from parseImportFile.
 * @return Valid merged rows plus row-level errors; never throws on bad data.
 */
export function planImport(rawRows: RawImportRow[]): ImportPlan {
  const merged = new Map<string, PlannedImportRow>();
  const errors: ImportRowError[] = [];

  for (const raw of rawRows) {
    const parsed = importRowSchema.safeParse(raw.values);

    if (!parsed.success) {
      errors.push({
        rowNumber: raw.rowNumber,
        message: parsed.error.issues.map((issue) => issue.message).join(" "),
        rawRow: raw.values
      });
      continue;
    }

    const condition = normalizeCondition(parsed.data.condition);
    if (!condition) {
      errors.push({
        rowNumber: raw.rowNumber,
        message: `Unknown condition "${parsed.data.condition}". Accepted: Near Mint/NM, Lightly Played/LP, Moderately Played/MP, Heavily Played/HP, Damaged.`,
        rawRow: raw.values
      });
      continue;
    }

    const row: PlannedImportRow = {
      cardId: parsed.data.card_id,
      variantKey: parsed.data.variant_key === "" ? null : parsed.data.variant_key,
      condition,
      quantity: parsed.data.quantity,
      storageLocation: parsed.data.storage_location === "" ? null : parsed.data.storage_location,
      notes: parsed.data.notes === "" ? null : parsed.data.notes,
      sourceRows: [raw.rowNumber]
    };

    const key = mergeKey(row);
    const existing = merged.get(key);

    if (existing) {
      // Same card, same variant, same condition, same location: quantities add.
      existing.quantity += row.quantity;
      existing.sourceRows.push(raw.rowNumber);
      // Last non-empty note wins; silently dropping notes would lose user data.
      if (row.notes) existing.notes = row.notes;
    } else {
      merged.set(key, row);
    }
  }

  return { rows: [...merged.values()], errors, rowsTotal: rawRows.length };
}
