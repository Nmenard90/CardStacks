/**
 * File: error-handler.test.ts
 * Purpose:
 *   Tests standard API error response behavior.
 *
 * Why this file exists:
 *   Error handling must be predictable so the frontend never has to guess how
 *   failures are shaped.
 */

import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";

/**
 * Verifies AppError stores safe HTTP response metadata.
 */
describe("AppError", () => {
  it("stores code, status, message, and details", () => {
    const error = new AppError("TEST_ERROR", "Readable message", 418, { example: true });

    expect(error.code).toBe("TEST_ERROR");
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe("Readable message");
    expect(error.details).toEqual({ example: true });
  });
});
