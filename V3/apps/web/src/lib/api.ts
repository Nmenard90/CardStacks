/**
 * File: api.ts
 * Purpose:
 *   Provides a tiny typed API client for the web app.
 *
 * Why this file exists:
 *   Fetch/error handling should be centralized so UI components stay simple.
 */

import { supabase } from "./supabase.js";
import { WEB_ENV } from "./env.js";

/**
 * Calls the backend API and returns the `data` property.
 *
 * Error handling:
 *   Throws readable errors when the backend returns the standard error shape.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const response = await fetch(`${WEB_ENV.apiBaseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "API request failed.");
  }

  return payload.data as T;
}

/**
 * Sends JSON to the backend API and returns the `data` property.
 */
export async function apiSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const response = await fetch(`${WEB_ENV.apiBaseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "API request failed.");
  }

  return payload.data as T;
}

/**
 * Uploads a file to the backend API as multipart form-data.
 *
 * Why this exists separately from apiSend:
 *   File uploads must NOT set a JSON content type; the browser must set the
 *   multipart boundary itself, so this helper never touches Content-Type.
 */
export async function apiUpload<T>(path: string, file: File, fieldName = "file"): Promise<T> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const body = new FormData();
  body.append(fieldName, file);

  const response = await fetch(`${WEB_ENV.apiBaseUrl}${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Upload failed.");
  }

  return payload.data as T;
}
