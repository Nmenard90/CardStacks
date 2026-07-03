/**
 * File: auth.plugin.ts
 * Purpose:
 *   Adds authentication helpers for protected API routes.
 *
 * Why this file exists:
 *   The backend must be the source of truth. Routes should trust verified
 *   Supabase tokens, not user ids sent by the frontend.
 */

import fp from "fastify-plugin";
import { createClient } from "@supabase/supabase-js";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env.js";
import { authRequiredError, forbiddenError } from "../errors/app-error.js";
import { parseAdminEmails } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

/**
 * Creates the auth plugin using validated environment settings.
 */
export function createAuthPlugin(env: AppEnv) {
  return fp(async (app) => {
    const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
    const supabase = createClient(env.SUPABASE_URL || "http://localhost", env.SUPABASE_ANON_KEY || "missing-key");

    /**
     * Requires a valid Supabase bearer token and loads the local app user.
     *
     * Security:
     *   User id is derived from the token subject. It is never accepted from
     *   route params for normal ownership checks.
     */
    async function requireAuth(request: FastifyRequest): Promise<void> {
      const authorization = request.headers.authorization;

      if (!authorization?.startsWith("Bearer ")) {
        throw authRequiredError();
      }

      const token = authorization.slice("Bearer ".length);
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user?.id || !data.user.email) {
        throw authRequiredError("Login token is invalid or expired.");
      }

      const normalizedEmail = data.user.email.toLowerCase();
      const role = adminEmails.has(normalizedEmail) ? "ADMIN" : "USER";

      const appUser = await app.prisma.appUser.upsert({
        where: { authSubject: data.user.id },
        update: { email: normalizedEmail, role },
        create: {
          authProvider: "supabase",
          authSubject: data.user.id,
          email: normalizedEmail,
          role
        }
      });

      request.currentUser = {
        id: appUser.id,
        email: appUser.email,
        role: appUser.role
      };
    }

    /**
     * Requires the current user to be an admin.
     */
    async function requireAdmin(request: FastifyRequest): Promise<void> {
      await requireAuth(request);

      if (request.currentUser?.role !== "ADMIN") {
        throw forbiddenError("Admin access is required.");
      }
    }

    app.decorate("requireAuth", requireAuth);
    app.decorate("requireAdmin", requireAdmin);
  });
}
