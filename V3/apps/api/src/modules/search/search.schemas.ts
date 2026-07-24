/**
 * File: search.schemas.ts
 * Purpose:
 *   Validates card search route inputs.
 *
 * Why this file exists:
 *   Search must reject unbounded/empty queries before they reach the
 *   database (FR-CAT-004), and every string/number bound must be capped so a
 *   malicious or accidental request cannot force an expensive scan.
 */

import { z } from "zod";
import {
  SEARCH_NAME_MAX_LENGTH,
  SEARCH_NUMBER_MAX_LENGTH,
  SEARCH_SET_ID_MAX_LENGTH,
  SEARCH_SET_NAME_MAX_LENGTH,
  hasMeaningfulSearchFilter
} from "@tcg/shared";

export const searchCardsQuerySchema = z
  .object({
    q: z.string().trim().max(SEARCH_NAME_MAX_LENGTH).optional(),
    setId: z.string().trim().max(SEARCH_SET_ID_MAX_LENGTH).optional(),
    setName: z.string().trim().max(SEARCH_SET_NAME_MAX_LENGTH).optional(),
    number: z.string().trim().max(SEARCH_NUMBER_MAX_LENGTH).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(25)
  })
  .refine((value) => hasMeaningfulSearchFilter(value), {
    message: "Provide a name, set, or collector number to search. Use set browsing to list every card without a filter.",
    path: ["q"]
  });

export type SearchCardsQuery = z.infer<typeof searchCardsQuerySchema>;
