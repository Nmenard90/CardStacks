/**
 * File: entry-point.test.ts
 * Purpose:
 *   Verifies that the worker's real process-exit wiring (`runWorker` in
 *   index.ts) sets a nonzero exit code when the resolved job rejects, and
 *   leaves the exit code untouched on success.
 *
 * Why this file exists:
 *   command-dispatch.test.ts only proves that `resolveWorkerCommand` throws
 *   for bad input; it never exercises the code path that turns a rejected
 *   job into `process.exitCode = 1`. This test imports `main`/`runWorker`
 *   directly — index.ts's direct-execution guard keeps that import
 *   side-effect-free — and mocks the job/env layers so no real Prisma
 *   connection is required.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../commands.js", () => ({
  resolveWorkerCommand: vi.fn()
}));
vi.mock("../config/env.js", () => ({
  loadWorkerEnv: vi.fn()
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => ({ $disconnect: vi.fn().mockResolvedValue(undefined) }))
}));

import { resolveWorkerCommand } from "../commands.js";
import { loadWorkerEnv } from "../config/env.js";
import { runWorker } from "../index.js";

describe("runWorker", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.resetAllMocks();
  });

  it("sets a nonzero exit code when the resolved job rejects", async () => {
    vi.mocked(loadWorkerEnv).mockReturnValue({} as never);
    vi.mocked(resolveWorkerCommand).mockReturnValue(async () => {
      throw new Error("job failed");
    });

    await runWorker();

    expect(process.exitCode).toBe(1);
  });

  it("sets a nonzero exit code when environment validation rejects", async () => {
    vi.mocked(loadWorkerEnv).mockImplementation(() => {
      throw new Error("invalid environment");
    });

    await runWorker();

    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code untouched when the job succeeds", async () => {
    vi.mocked(loadWorkerEnv).mockReturnValue({} as never);
    vi.mocked(resolveWorkerCommand).mockReturnValue(async () => {});

    await runWorker();

    expect(process.exitCode).toBeUndefined();
  });
});
