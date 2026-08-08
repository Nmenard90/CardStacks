/**
 * ShelfPage — the unified shelf: storage boxes and binders together, one
 * drag-reorderable wood cabinet. Owns the collection/storage state
 * CollectionShelf needs (which cards exist, their condition/quantity
 * lookup, and which drawer each is filed into) — organizing storage is
 * this page's job, not the plain collection list's (see OwnedPage).
 *
 * USED BY: App.tsx (route "/shelf")
 * DEPENDS ON: api/collection, api/storage, api/shelf, components/CollectionShelf
 */

import { useEffect, useState } from 'react'
import { getOwnedCards } from '../api/collection'
import { assignCards, unassignCard } from '../api/storage'
import { getShelf } from '../api/shelf'
import { CollectionShelf } from '../components/CollectionShelf'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { fromCondList, type CondMap } from '../lib/conditions'
import type { Card, OwnedCard, ShelfEntry } from '../types'

interface Entry { conds: CondMap; selCond: string }

export function ShelfPage() {
  const { user } = useUser()
  const toast = useToast()

  const [cards, setCards] = useState<Card[]>([])
  const [coll, setColl] = useState<Record<string, Entry>>({})
  // Card ID -> which drawer it's assigned to. Only assigned cards appear as keys.
  const [drawerOf, setDrawerOf] = useState<Record<string, string>>({})
  const [items, setItems] = useState<ShelfEntry[]>([])
  const [loading, setLoading] = useState(true)

  const userId = user?.id ?? ''

  useEffect(() => {
    if (!userId) return
    getOwnedCards(userId)
      .then((owned: OwnedCard[]) => {
        setCards(owned.map(o => o.card))

        const m: Record<string, Entry> = {}
        const d: Record<string, string> = {}
        for (const o of owned) {
          m[o.cardId] = { conds: fromCondList(o.conditions), selCond: o.selectedCond || 'NM' }
          if (o.drawerId) d[o.cardId] = o.drawerId
        }
        setColl(m)
        setDrawerOf(d)
        setLoading(false)
      })
      .catch(() => { toast('Could not load your collection.'); setLoading(false) })
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadShelf = () => { if (userId) getShelf(userId).then(setItems).catch(() => {}) }
  useEffect(reloadShelf, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Reassigns (or unassigns, when drawerId is "") one card's storage location. */
  const setCardDrawer = async (cardId: string, drawerId: string) => {
    const prev = drawerOf[cardId]
    setDrawerOf(d => ({ ...d, [cardId]: drawerId }))
    try {
      if (drawerId) {
        const result = await assignCards(userId, [cardId], drawerId)
        if (result.warning) toast(result.warning)
      } else {
        await unassignCard(userId, cardId)
      }
      reloadShelf()
    } catch {
      toast('Could not update storage location.')
      setDrawerOf(d => ({ ...d, [cardId]: prev ?? '' }))
    }
  }

  /** Same as setCardDrawer, batched for N cards in one request — drag-drop
   *  onto a box/drawer and the shelf's bulk "Assign N…" picker both use this. */
  const assignCardsToDrawer = async (cardIds: string[], drawerId: string) => {
    const prev = { ...drawerOf }
    setDrawerOf(d => {
      const next = { ...d }
      for (const id of cardIds) next[id] = drawerId
      return next
    })
    try {
      const result = await assignCards(userId, cardIds, drawerId)
      if (result.warning) toast(result.warning)
      reloadShelf()
    } catch {
      toast('Could not update storage location.')
      setDrawerOf(prev)
    }
  }

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  return (
    <div className="page-tracker">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">COLLECTION ROOM · <span>STORAGE</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <HeaderNav />
        </header>

        <div style={{ padding: '16px 20px' }}>
          {loading
            ? <div className="loading">Loading your shelf…</div>
            : (
              <CollectionShelf
                userId={userId}
                cards={cards}
                coll={coll}
                items={items}
                drawerOf={drawerOf}
                // Always empty — binder slot placement isn't cross-referenced
                // against the Unassigned tray yet (would need a new query:
                // which cards are placed in ANY binder slot, per user).
                binderLocationOf={{}}
                onReloadShelf={reloadShelf}
                onSetCardDrawer={setCardDrawer}
                onAssignCards={assignCardsToDrawer}
              />
            )}
        </div>
      </div>
    </div>
  )
}
