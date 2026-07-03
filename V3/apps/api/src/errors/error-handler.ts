/**
 * File: error-handler.ts
 * Purpose:
 *   Converts thrown errors into consistent API responses.
 *
 * Why this file exists:
 *   Users and frontend code should receive predictable errors instead of raw
 *   stack traces or random Fastify defaults.
 */

import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./app-error.js";

/**
 * Registers the global error handler on a Fastify app.
 *
 * Security:
 *   Unknown errors return a safe message so internal details do not leak.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "Request failed");

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request input did not pass validation.",
          details: { issues: error.issues }
        }
      });
      return;
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please slow down.",
          details: {}
        }
      });
      return;
    }

    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. The server logged the details.",
        details: {}
      }
    });
  });
}
