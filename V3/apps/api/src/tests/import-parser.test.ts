/**
 * File: import-parser.test.ts
 * Purpose:
 *   Tests import file parsing and merge planning.
 *
 * Why this file exists:
 *   The owner's merge rule — quantities combine only within the same
 *   condition — is the core inventory-integrity guarantee of imports. These
 *   tests pin that rule down so no future refactor can silently break it.
 */

import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { CardCondition } from "@prisma/client";
import { normalizeCondition, parseImportFile, planImport } from "../modules/imports/import.parser.js";

/**
 * Builds a CSV buffer from rows for parser tests.
 */
function csvBuffer(lines: string[]): Buffer {
  return Buffer.from(lines.join("\n"), "utf8");
}

/**
 * Builds a real XLSX buffer so binary parsing is covered, not just CSV.
 */
function xlsxBuffer(rows: Record<string, string | number>[]): Buffer {
  const sheet = utils.json_to_sheet(rows);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Sheet1");
  return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("normalizeCondition", () => {
  it("maps common collector aliases to enum values", () => {
    expect(normalizeCondition("NM")).toBe(CardCondition.NEAR_MINT);
    expect(normalizeCondition("Near Mint")).toBe(CardCondition.NEAR_MINT);
    expect(normalizeCondition("lp")).toBe(CardCondition.LIGHTLY_PLAYED);
    expect(normalizeCondition("Moderately Played")).toBe(CardCondition.MODERATELY_PLAYED);
    expect(normalizeCondition("HP")).toBe(CardCondition.HEAVILY_PLAYED);
    expect(normalizeCondition("dmg")).toBe(CardCondition.DAMAGED);
  });

  it("round-trips the enum's own storage format", () => {
    expect(normalizeCondition("NEAR_MINT")).toBe(CardCondition.NEAR_MINT);
    expect(normalizeCondition("HEAVILY_PLAYED")).toBe(CardCondition.HEAVILY_PLAYED);
  });

  it("returns null for unknown text instead of guessing", () => {
    expect(normalizeCondition("pristine")).toBeNull();
    expect(normalizeCondition("")).toBeNull();
  });
});

describe("parseImportFile", () => {
  it("parses CSV with normalized headers and correct row numbers", () => {
    const rows = parseImportFile(csvBuffer([
      "Card ID,Condition,Quantity,Storage Location",
      "sv1-25,NM,3,Binder A"
    ]));

    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].values.card_id).toBe("sv1-25");
    expect(rows[0].values.storage_location).toBe("Binder A");
  });

  it("parses XLSX buffers identically to CSV", () => {
    const rows = parseImportFile(xlsxBuffer([
      { card_id: "sv1-25", condition: "LP", quantity: 2 }
    ]));

    expect(rows).toHaveLength(1);
    expect(rows[0].values.condition).toBe("LP");
    expect(rows[0].values.quantity).toBe("2");
  });

  it("returns no rows for an empty file", () => {
    expect(parseImportFile(csvBuffer([""]))).toHaveLength(0);
  });
});

describe("planImport — the condition merge rule", () => {
  it("adds quantities for the same card in the SAME condition", () => {
    const plan = planImport(parseImportFile(csvBuffer([
      "card_id,condition,quantity",
      "sv1-25,NM,2",
      "sv1-25,Near Mint,3"
    ])));

    expect(plan.errors).toHaveLength(0);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].quantity).toBe(5);
    expect(plan.rows[0].sourceRows).toEqual([2, 3]);
  });

  it("keeps the same card in DIFFERENT conditions as separate entries", () => {
    const plan = planImport(parseImportFile(csvBuffer([
      "card_id,condition,quantity",
      "sv1-25,NM,2",
      "sv1-25,Damaged,1"
    ])));

    expect(plan.rows).toHaveLength(2);
    const byCondition = Object.fromEntries(plan.rows.map((row) => [row.condition, row.quantity]));
    expect(byCondition[CardCondition.NEAR_MINT]).toBe(2);
    expect(byCondition[CardCondition.DAMAGED]).toBe(1);
  });

  it("treats different variants and storage locations as separate entries", () => {
    const plan = planImport(parseImportFile(csvBuffer([
      "card_id,variant_key,condition,quantity,storage_location",
      "sv1-25,holo,NM,1,",
      "sv1-25,reverse-holo,NM,1,",
      "sv1-25,holo,NM,1,Box 2"
    ])));

    expect(plan.rows).toHaveLength(3);
  });

  it("records row-level errors without dropping good rows", () => {
    const plan = planImport(parseImportFile(csvBuffer([
      "card_id,condition,quantity",
      "sv1-25,NM,2",
      ",NM,1",
      "sv1-30,pristine,1",
      "sv1-31,NM,0",
      "sv1-32,NM,1.5"
    ])));

    expect(plan.rows).toHaveLength(1);
    expect(plan.errors).toHaveLength(4);
    expect(plan.errors.map((error) => error.rowNumber)).toEqual([3, 4, 5, 6]);
    expect(plan.errors[1].message).toContain("Unknown condition");
    expect(plan.rowsTotal).toBe(5);
  });
});
