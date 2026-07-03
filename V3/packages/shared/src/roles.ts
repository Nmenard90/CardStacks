/**
 * File: roles.ts
 * Purpose:
 *   Defines user roles used by API authorization.
 *
 * Why this file exists:
 *   Admin checks must be consistent across routes, workers, and future tools.
 */

export const USER_ROLES = ["USER", "ADMIN"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Checks whether a role should receive admin-level access.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN";
}
