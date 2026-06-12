import axios from 'axios'

// Points to the Scala backend. In dev the Vite proxy rewrites /api → Railway.
// In production builds, set VITE_API_BASE to the backend URL.
const BASE = import.meta.env.VITE_API_BASE ?? ''

export const api = axios.create({ baseURL: BASE })
