/**
 * File: quantities.ts
 * Purpose:
 *   Defines the quantity bounds shared by collection writes across the API
 *   and web client.
 *
 * Why this file exists:
 *   Quantity must stay a positive bounded integer everywhere it is entered
 *   (FR-COL-008): quick add, explicit add, bulk add, and inline
 *   increment/decrement all need to agree on the same ceiling so the web
 *   client can validate before sending a request that is guaranteed to fail.
 */

export const COLLECTION_QUANTITY_MIN = 1;
export const COLLECTION_QUANTITY_MAX = 10000;

/** Bound for a single increment/decrement step, independent of resting quantity. */
export const COLLECTION_QUANTITY_DELTA_MAX = 10000;
