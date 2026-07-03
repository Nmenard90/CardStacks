/**
 * File: collection.schemas.ts
 * Purpose:
 *   Validates collection route inputs.
 *
 * Why this file exists:
 *   Bad collection data can corrupt inventory counts, paid price history, and
 *   master set progress, so every write must be validated.
 */

import { z } from "zod";

export const collectionItemIdParamsSchema = z.object({
  itemId: z.string().uuid()
});

export const quickAddSchema = z.object({
  cardId: z.string().trim().min(1).max(120),
  variantId: z.string().uuid(),
  condition: z.enum(["NEAR_MINT", "LIGHTLY_PLAYED", "MODERATELY_PLAYED", "HEAVILY_PLAYED", "DAMAGED"]),
  quantity: z.number().int().min(1).max(10000),
  storageLocation: z.string().trim().max(120).optional(),
  pricePaidEach: z.number().min(0).max(1000000).optional(),
  purchasedAt: z.string().date().optional(),
  seller: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional()
});

export const updateCollectionItemSchema = z.object({
  quantity: z.number().int().min(0).max(10000).optional(),
  storageLocation: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});
