/**
 * File: catalog.schemas.ts
 * Purpose:
 *   Validates catalog route inputs.
 *
 * Why this file exists:
 *   Listing endpoints can become expensive or unsafe if page/limit values are
 *   not capped and cleaned before reaching the database.
 */

import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25)
});

export const setIdParamsSchema = z.object({
  setId: z.string().trim().min(1).max(80)
});

export const cardIdParamsSchema = z.object({
  cardId: z.string().trim().min(1).max(120)
});
