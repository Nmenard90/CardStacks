/** Types for cardArt.mjs (used by vite.config.ts). */
import type { IncomingMessage, ServerResponse } from 'node:http'
export const ART_HOSTS: readonly string[]
export function artTarget(raw: string | null): URL | null
export function serveCardArt(req: IncomingMessage, res: ServerResponse, query: URLSearchParams, fetchImpl?: typeof fetch): Promise<void>
