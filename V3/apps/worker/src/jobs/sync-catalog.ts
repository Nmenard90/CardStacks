/**
 * File: sync-catalog.ts
 * Purpose:
 *   Syncs Pokémon sets and cards into the local database.
 *
 * Why this file exists:
 *   The backend needs a local searchable catalog so user search is fast and
 *   not dependent on a live external API call for every keystroke.
 */

import type { PrismaClient } from "@prisma/client";
import type { WorkerEnv } from "../config/env.js";
import { fetchPokemonTcgCardsForSet, fetchPokemonTcgSets, type PokemonTcgCard } from "../providers/pokemon-tcg.provider.js";

/**
 * Syncs all sets and cards from PokémonTCG.io.
 *
 * Approach:
 *   Cards are fetched one set at a time (filtered by set id), mirroring the
 *   proven V2 service. The unfiltered global /cards endpoint returns
 *   intermittent 500s at scale; per-set queries are small and reliable.
 */
export async function syncCatalog(prisma: PrismaClient, env: WorkerEnv): Promise<void> {
  const syncRun = await prisma.syncRun.create({ data: { jobType: "catalog_sync", status: "RUNNING", source: "pokemon_tcg" } });

  try {
    const sets = await fetchPokemonTcgSets(env);

    if (sets.length === 0) {
      throw new Error("PokémonTCG.io returned zero sets unexpectedly.");
    }

    for (const set of sets) {
      await prisma.set.upsert({
        where: { id: set.id },
        update: {
          name: set.name,
          series: set.series,
          printedTotal: set.printedTotal,
          total: set.total,
          ptcgoCode: set.ptcgoCode,
          releaseDate: parseDateOnly(set.releaseDate),
          sourceUpdatedAt: parsePokemonDateTime(set.updatedAt),
          symbolUrl: set.images?.symbol,
          logoUrl: set.images?.logo,
          source: "pokemon_tcg",
          rawJson: set as never
        },
        create: {
          id: set.id,
          name: set.name,
          series: set.series,
          printedTotal: set.printedTotal,
          total: set.total,
          ptcgoCode: set.ptcgoCode,
          releaseDate: parseDateOnly(set.releaseDate),
          sourceUpdatedAt: parsePokemonDateTime(set.updatedAt),
          symbolUrl: set.images?.symbol,
          logoUrl: set.images?.logo,
          source: "pokemon_tcg",
          rawJson: set as never
        }
      });
    }

    let updatedCards = 0;

    for (const set of sets) {
      const cards = await fetchPokemonTcgCardsForSet(env, set.id);
      for (const card of cards) {
        await upsertCardWithVariants(prisma, card);
        updatedCards += 1;
      }
    }

    await prisma.syncRun.update({ where: { id: syncRun.id }, data: { status: "SUCCESS", finishedAt: new Date(), recordsSeen: sets.length + updatedCards, recordsUpdated: sets.length + updatedCards } });
  } catch (error) {
    await prisma.syncError.create({ data: { syncRunId: syncRun.id, severity: "CRITICAL", entityType: "catalog", message: error instanceof Error ? error.message : "Unknown catalog sync failure" } });
    await prisma.syncRun.update({ where: { id: syncRun.id }, data: { status: "FAILED", finishedAt: new Date(), errorSummary: error instanceof Error ? error.message : "Unknown failure" } });
    throw error;
  }
}

/**
 * Upserts one card and its initial variants.
 */
async function upsertCardWithVariants(prisma: PrismaClient, card: PokemonTcgCard): Promise<void> {
  await prisma.card.upsert({
    where: { id: card.id },
    update: buildCardWrite(card),
    create: { id: card.id, ...buildCardWrite(card) }
  });

  const variantKeys = inferVariantKeys(card);
  for (const variantKey of variantKeys) {
    await prisma.cardVariant.upsert({
      where: { cardId_variantKey_language: { cardId: card.id, variantKey, language: "EN" } },
      update: { displayName: humanizeVariantKey(variantKey), source: "pokemon_tcg" },
      create: { cardId: card.id, variantKey, displayName: humanizeVariantKey(variantKey), source: "pokemon_tcg" }
    });
  }
}

/**
 * Builds Prisma card write data from PokémonTCG.io card fields.
 */
function buildCardWrite(card: PokemonTcgCard) {
  return {
    setId: card.set.id,
    name: card.name,
    normalizedName: normalizeName(card.name),
    number: card.number,
    numberInt: parseNumberInt(card.number),
    rarity: card.rarity,
    artist: card.artist,
    supertype: card.supertype,
    subtypes: card.subtypes ?? [],
    imageSmall: card.images?.small,
    imageLarge: card.images?.large,
    rawJson: card as never
  };
}

/**
 * Infers initial variants from PokémonTCG.io `tcgplayer.prices` keys.
 */
function inferVariantKeys(card: PokemonTcgCard): string[] {
  const priceKeys = Object.keys(card.tcgplayer?.prices ?? {});
  const mapped = priceKeys.map((key) => key.toUpperCase().replace(/([A-Z])([A-Z][a-z])/g, "$1_$2"));
  return mapped.length > 0 ? [...new Set(mapped)] : ["NORMAL"];
}

/**
 * Makes names searchable without case/spacing surprises.
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parses numeric card numbers while leaving alphanumeric numbers as null.
 */
function parseNumberInt(number: string): number | null {
  return /^\d+$/.test(number) ? Number.parseInt(number, 10) : null;
}

/**
 * Parses PokémonTCG.io date-only fields.
 *
 * Returns undefined for missing OR unparseable values so a malformed date on a
 * single set never crashes the whole sync.
 */
function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.replaceAll("/", "-"));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Parses PokémonTCG.io date-time fields.
 *
 * The API sends timezone-less timestamps like "2026/03/26 15:00:00". Appending
 * "Z" pins them to UTC; a NaN guard drops anything still unparseable instead of
 * handing Prisma an invalid Date.
 */
function parsePokemonDateTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.replace(" ", "T").replaceAll("/", "-") + "Z");
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Converts a variant key into a readable label.
 */
function humanizeVariantKey(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}