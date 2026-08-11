/**
 * Shared axios instance for every file in web/src/api/. Centralizes the
 * backend base URL so it's configured once, and attaches the current
 * Supabase session's access token to every request so the backend's
 * AuthGuard can identify (and authorize) the caller.
 *
 * Base URL is empty in dev — Vite's dev server proxies /api/* to the real
 * backend, so no explicit host is needed. Production builds bake in
 * VITE_API_BASE at build time (see web/.env.production).
 */
import axios from 'axios'
import { supabase } from '../lib/supabase'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export const api = axios.create({ baseURL: BASE })

api.interceptors.request.use(async config => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
