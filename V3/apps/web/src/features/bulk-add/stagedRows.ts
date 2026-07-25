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
 *
 * Why storage is namespaced by user id:
 *   localStorage is shared by every account that signs in on the same
 *   browser/device. Without namespacing, staged rows entered by one user
 *   remain readable (and savable, under a second user's authenticated
 *   request) after logout/account switching. Each user's rows live under
 *   their own key so switching accounts never exposes another user's data.
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

const STORAGE_KEY_PREFIX = "tcg.bulkAdd.stagedRows.v2";

/** Pre-namespacing key, shared by every account on this browser/device. */
const LEGACY_SHARED_STORAGE_KEY = "tcg.bulkAdd.stagedRows.v1";

function storageKeyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

/**
 * Loads staged rows saved from a previous session/tab for this specific
 * user. Never throws: storage can be disabled (private browsing) or hold
 * malformed JSON from an older schema version, and either case should just
 * start from an empty staging area rather than break the page.
 *
 * `userId` must be the authenticated user's id; without one, staging is
 * skipped entirely rather than risk reading/writing an unscoped key.
 */
export function loadStagedRows(userId: string): StagedRow[] {
  if (typeof window === "undefined" || !userId) {
    return [];
  }

  // The old shared key cannot be safely attributed to whichever user loads
  // next, so it is discarded rather than migrated into this user's rows.
  try {
    window.localStorage.removeItem(LEGACY_SHARED_STORAGE_KEY);
  } catch {
    // Ignore: best-effort cleanup only.
  }

  try {
    const raw = window.localStorage.getItem(storageKeyFor(userId));
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
 * Persists the current staged rows under this user's namespaced key.
 * Silently no-ops on storage failure (quota exceeded, disabled storage) or
 * when no user id is available — staging still works in-memory for the
 * current tab.
 */
export function persistStagedRows(userId: string, rows: StagedRow[]): void {
  if (typeof window === "undefined" || !userId) {
    return;
  }

  try {
    window.localStorage.setItem(storageKeyFor(userId), JSON.stringify(rows));
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
