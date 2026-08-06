/**
 * API calls for user accounts.
 * ENDPOINTS: GET /api/users, GET /api/users/:username, POST /api/users
 * USED BY: LoginScreen
 */
import { api } from './client'
import type { User } from '../types'

/** All users, A→Z. Login screen chips. */
export const listUsers = () =>
  api.get<User[]>('/api/users').then(r => r.data)

/** Resolves null on 404 — not registered yet, not an error. */
export const findUser = (username: string) =>
  api.get<User>(`/api/users/${encodeURIComponent(username)}`)
    .then(r => r.data)
    .catch(e => { if (e?.response?.status === 404) return null; throw e })

/** Backend returns 409 if the username or email is already taken. */
export const registerUser = (username: string, email: string) =>
  api.post<User>('/api/users', { username, email }).then(r => r.data)
