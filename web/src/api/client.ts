/**
 * Shared axios instance for every file in web/src/api/. Centralizes the
 * backend base URL so it's configured once.
 *
 * Base URL is empty in dev — Vite's dev server proxies /api/* to the real
 * backend, so no explicit host is needed. Production builds bake in
 * VITE_API_BASE at build time (see web/.env.production).
 */
import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export const api = axios.create({ baseURL: BASE })
