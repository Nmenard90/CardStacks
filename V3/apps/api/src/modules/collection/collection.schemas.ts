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
import {
  BULK_ADD_MAX_ROWS,
  CARD_CONDITIONS,
  COLLECTION_QUANTITY_DELTA_MAX,
  COLLECTION_QUANTITY_MAX,
  COLLECTION_QUANTITY_MIN,
  COLLECTION_SORT_DIRECTIONS,
  COLLECTION_SORT_FIELDS
} from "@tcg/shared";

const conditionSchema = z.enum(CARD_CONDITIONS);

export const collectionItemIdParamsSchema = z.object({
  itemId: z.string().uuid()
});

export const quickAddSchema = z.object({
  cardId: z.string().trim().min(1).max(120),
  variantId: z.string().uuid(),
  condition: conditionSchema,
  quantity: z.number().int().min(COLLECTION_QUANTITY_MIN).max(COLLECTION_QUANTITY_MAX),
  storageLocation: z.string().trim().max(120).optional(),
  pricePaidEach: z.number().min(0).max(1000000).optional(),
  purchasedAt: z.string().date().optional(),
  seller: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional()
});

export const updateCollectionItemSchema = z.object({
  condition: conditionSchema.optional(),
  quantity: z.number().int().min(0).max(COLLECTION_QUANTITY_MAX).optional(),
  storageLocation: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

export const quantityDeltaSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, { message: "delta must not be zero" })
    .refine((value) => Math.abs(value) <= COLLECTION_QUANTITY_DELTA_MAX, {
      message: `delta magnitude cannot exceed ${COLLECTION_QUANTITY_DELTA_MAX}`
    })
});

export const ownedCollectionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  setId: z.string().trim().max(80).optional(),
  q: z.string().trim().max(120).optional(),
  number: z.string().trim().max(40).optional(),
  condition: conditionSchema.optional(),
  variantKey: z.string().trim().max(60).optional(),
  storageLocation: z.string().trim().max(120).optional(),
  sort: z.enum(COLLECTION_SORT_FIELDS).default("updatedAt"),
  direction: z.enum(COLLECTION_SORT_DIRECTIONS).default("desc")
});

export type OwnedCollectionQuery = z.infer<typeof ownedCollectionQuerySchema>;

export const bulkAddRowSchema = z.object({
  cardId: z.string().trim().min(1).max(120),
  variantId: z.string().uuid(),
  condition: conditionSchema,
  quantity: z.number().int().min(COLLECTION_QUANTITY_MIN).max(COLLECTION_QUANTITY_MAX),
  storageLocation: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional()
});

export const bulkAddSchema = z.object({
  rows: z.array(bulkAddRowSchema).min(1).max(BULK_ADD_MAX_ROWS)
});
