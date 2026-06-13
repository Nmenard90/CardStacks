/**
 * FILE: users.ts — API calls for user accounts.
 * ENDPOINTS USED:
 *   GET  /api/users                  — all users (login chips)
 *   GET  /api/users/:username        — lookup at login (404 → null)
 *   POST /api/users                  — register {username, email}
 * USED BY: LoginScreen
 */
import { api } from './client'
import type { User } from '../types'

/** Every registered user, A→Z. Used for the login screen chips. */
export const listUsers = () =>
  api.get<User[]>('/api/users').then(r => r.data)

/** Find one user by username. Resolves null on 404 (not registered yet). */
export const findUser = (username: string) =>
  api.get<User>(`/api/users/${encodeURIComponent(username)}`)
    .then(r => r.data)
    .catch(e => { if (e?.response?.status === 404) return null; throw e })

/** Register a new account. Backend returns 409 if name/email taken. */
export const registerUser = (username: string, email: string) =>
  api.post<User>('/api/users', { username, email }).then(r => r.data)
