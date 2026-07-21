/**
 * File: command-dispatch.test.ts
 * Purpose:
 *   Verifies the worker CLI resolves explicit job commands correctly and
 *   fails loudly on missing/unknown commands.
 *
 * Why this file exists:
 *   FND-106 requires that catalog and price jobs can be invoked explicitly
 *   in production, and that an invalid invocation exits nonzero rather than
 *   silently doing nothing.
 */

import { describe, expect, it } from "vitest";
import { resolveWorkerCommand, WORKER_COMMANDS } from "../commands.js";
import { syncCatalog } from "../jobs/sync-catalog.js";
import { syncPrices } from "../jobs/sync-prices.js";

describe("resolveWorkerCommand", () => {
  it("resolves sync-catalog to the catalog sync job", () => {
    expect(resolveWorkerCommand("sync-catalog")).toBe(syncCatalog);
  });

  it("resolves sync-prices to the price sync job", () => {
    expect(resolveWorkerCommand("sync-prices")).toBe(syncPrices);
  });

  it("throws for a missing command", () => {
    expect(() => resolveWorkerCommand(undefined)).toThrow(/missing/);
  });

  it("throws for an unrecognized command", () => {
    expect(() => resolveWorkerCommand("delete-everything")).toThrow(/delete-everything/);
  });

  it("throws for inherited object prototype keys", () => {
    expect(() => resolveWorkerCommand("toString")).toThrow(/toString/);
  });

  it("exposes exactly the catalog and price sync commands", () => {
    expect(Object.keys(WORKER_COMMANDS).sort()).toEqual(["sync-catalog", "sync-prices"]);
  });
});
