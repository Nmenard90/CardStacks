/**
 * File: app-error.ts
 * Purpose:
 *   Defines the standard application error class.
 *
 * Why this file exists:
 *   Routes, services, and repositories need one consistent way to describe
 *   user-safe errors with HTTP status codes.
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown>;

  /**
   * Creates a user-safe application error.
   */
  constructor(code: string, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Creates a validation error.
 */
export function validationError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError("VALIDATION_ERROR", message, 400, details);
}

/**
 * Creates a not-found error.
 */
export function notFoundError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError("NOT_FOUND", message, 404, details);
}

/**
 * Creates a forbidden error.
 */
export function forbiddenError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError("FORBIDDEN", message, 403, details);
}

/**
 * Creates an auth-required error.
 */
export function authRequiredError(message = "A valid login token is required."): AppError {
  return new AppError("AUTH_REQUIRED", message, 401);
}

/**
 * Creates an upstream API error.
 */
export function upstreamApiError(message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError("UPSTREAM_API_ERROR", message, 502, details);
}
