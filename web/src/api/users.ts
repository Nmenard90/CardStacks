/**
 * API calls for the current user's profile.
 * ENDPOINT: GET /api/auth/me — provisions (on first call after sign-up) or
 * returns the profile linked to the caller's Supabase session. There is no
 * endpoint that lists or looks up other users — see backend AuthRoutes.
 * USED BY: context/UserContext
 */
import { api } from './client'
import type { User } from '../types'

export const fetchMe = () => api.get<User>('/api/auth/me').then(r => r.data)
