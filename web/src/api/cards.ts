import { api } from './client'
import type { Card, CardSet } from '../types'

export const getSets = () =>
  api.get<CardSet[]>('/api/sets').then(r => r.data)

export const getCardsBySet = (setId: string) =>
  api.get<Card[]>(`/api/cards/${setId}`).then(r => r.data)

export const getCardById = (cardId: string) =>
  api.get<Card>(`/api/cards/id/${cardId}`).then(r => r.data)

export const searchCards = (q: string) =>
  api.get<Card[]>('/api/search', { params: { q } }).then(r => r.data)

export const refreshSet = (setId: string) =>
  api.get(`/api/admin/refresh/${setId}`).then(r => r.data)
