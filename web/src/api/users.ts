import { api } from './client'
import type { User } from '../types'

export const getUserByUsername = (username: string) =>
  api.get<User>(`/api/users/${username}`).then(r => r.data)

export const registerUser = (username: string, email: string) =>
  api.post<User>('/api/users', { username, email }).then(r => r.data)

export const updateLocation = (userId: string, location: string) =>
  api.put(`/api/users/${userId}/location`, { location }).then(r => r.data)
