/**
 * File: catalog.schemas.ts
 * Purpose:
 *   Validates catalog route inputs.
 *
 * Why this file exists:
 *   Search inputs can become expensive or unsafe if they are not capped and
 *   cleaned before reaching the database.
 */

import { z } from "zod";

export const searchCardsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  setId: z.string().trim().max(40).optional(),
  number: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});

export const setIdParamsSchema = z.object({
  setId: z.string().trim().min(1).max(80)
});

export const cardIdParamsSchema = z.object({
  cardId: z.string().trim().min(1).max(120)
});
