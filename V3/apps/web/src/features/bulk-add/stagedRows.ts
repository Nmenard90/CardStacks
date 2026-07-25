/**
 * File: stagedRows.ts
 * Purpose:
 *   Defines the staged bulk-add row shape and persists it to localStorage.
 *
 * Why this file exists:
 *   FR-BULK-004 requires staged work to survive a transient request
 *   failure. A page reload after a dropped connection (or the save request
 *   itself failing) must never silently lose rows the user already entered,
 *   so every staged-row change is mirrored to localStorage.
 */

import type { CardCondition } from "@tcg/shared";
import type { CardVariantOption } from "./bulkAddApi.js";

export interface StagedRow {
  key: string;
  cardId: string;
  cardName: string;
  setId: string;
  setName: string;
  number: string;
  variantOptions: CardVariantOption[];
  variantId: string;
  condition: CardCondition;
  quantity: number;
  storageLocation: string;
  notes: string;
  /** Message from the most recent failed save attempt for this row, if any. */
  lastError?: string;
}

const STORAGE_KEY = "tcg.bulkAdd.stagedRows.v1";

/**
 * Loads staged rows saved from a previous session/tab. Never throws:
 * storage can be disabled (private browsing) or hold malformed JSON from an
 * older schema version, and either case should just start from an empty
 * staging area rather than break the page.
 */
export function loadStagedRows(): StagedRow[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StagedRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the current staged rows. Silently no-ops on storage failure
 * (quota exceeded, disabled storage) — staging still works in-memory for
 * the current tab.
 */
export function persistStagedRows(rows: StagedRow[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Ignore: best-effort persistence only.
  }
}

let keyCounter = 0;

/** Generates a staged-row key without depending on `crypto.randomUUID` availability. */
export function makeStagedRowKey(): string {
  keyCounter += 1;
  return `staged-${Date.now()}-${keyCounter}`;
}
