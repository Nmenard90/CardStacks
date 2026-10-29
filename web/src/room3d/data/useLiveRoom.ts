/**
 * useLiveRoom.ts — the 3D room's data: the signed-in user's real collection, read through the site's own API modules.
 *
 * PURPOSE
 *   Fetches everything the room draws (spaces with their shelf units and display cases, boxes with compartments,
 *   binders with their pockets, inventory lots, where each copy is placed, and the owned cards with prices), keeps the
 *   raw answers in the React Query cache, and derives the room's RoomState / world model from them. Also owns the
 *   room's one write — putting a card into a binder pocket — which uses the exact call the binder page makes.
 *
 * HOW IT WORKS
 *   One query per user and game. The cache keeps the last read, so coming back to the room shows it at once and
 *   refreshes behind it (`staleTime: 0`). Per-binder, per-compartment and per-case reads run a few at a time so a big
 *   collection doesn't open hundreds of connections at once; one failed read leaves that container empty and is
 *   reported, it doesn't fail the room.
 *
 * IMPORTS EXPLAINED
 *   api/*            — the same axios calls every other page uses (auth token + ?game= added by api/client.ts)
 *   lib/conditions   — the site's price math, so the room's prices match the card tiles
 *   ./liveState.js   — pure reshaping of the API answers into a RoomState
 *   ./roomWorld.js   — the paged world model the 3D furniture is built from
 *
 * USED BY: room3d/RoomScene.jsx
 * DEPENDS ON: api/rooms, api/storage, api/binders, api/collection, api/cards, lib/conditions, lib/game
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCaseAllocations, getDrawerPlacements, getSpaceInventory, listSpaces } from '../../api/rooms'
import { listBoxes } from '../../api/storage'
import { getBinder, listBinders, setSlot } from '../../api/binders'
import { getOwnedCards } from '../../api/collection'
import { getCards, getSets, searchCards } from '../../api/cards'
import { basePrice, condPrice, defaultVariant, lotKey, variantLabel } from '../../lib/conditions'
import { currentGame } from '../../lib/game'
import type { Binder, Card, CardAllocation, CollectionSpace, InventoryLot, StorageBox } from '../../types'
import { buildLiveState, setIdOf, unknownPocketCards } from './liveState.js'
import { DEFAULT_NAV, createLookup, revealNav, toWorldModel } from './roomWorld.js'

/** Reads in flight at once for the per-container requests. */
const CONCURRENCY = 6

/** Everything one read of the collection returns, before it is reshaped for the room. */
export interface RoomRaw {
  userId: string
  spaces: CollectionSpace[]
  boxes: StorageBox[]
  binders: Binder[]
  lots: InventoryLot[]
  allocations: CardAllocation[]
  cards: Card[]
  ownedIds: string[]
  ownedCopies: number
  setNames: Record<string, string>
  warnings: string[]
}

/**
 * PURPOSE: Runs `worker` over `items`, CONCURRENCY at a time; a failed item becomes `fallback(item, error)`.
 * @param items     what to fetch for
 * @param worker    the request for one item
 * @param fallback  the value to use when that request fails
 * @return results in the same order as `items`
 */
async function pool<T, R>(items: T[], worker: (item: T) => Promise<R>, fallback: (item: T, error: unknown) => R): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      try { results[i] = await worker(items[i]) } catch (error) { results[i] = fallback(items[i], error) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run))
  return results
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * PURPOSE: One full read of the user's collection for the room.
 * @param userId      the signed-in user's CardStacks id
 * @param onProgress  called with a short status line as each stage starts
 * @return the raw API answers the room is built from
 */
async function fetchRoom(userId: string, onProgress: (text: string) => void): Promise<RoomRaw> {
  const warnings: string[] = []
  onProgress('Opening your room…')
  const [spaces, boxes, binderList, lots, owned, sets] = await Promise.all([
    listSpaces(userId), listBoxes(userId), listBinders(userId), getSpaceInventory(userId), getOwnedCards(userId),
    getSets().catch(() => []), // set names are a nicety; the room still works without them
  ])

  onProgress(`Reading ${binderList.length} binder${binderList.length === 1 ? '' : 's'}…`)
  const binders = await pool(binderList, b => getBinder(userId, b.id), (b, e) => {
    warnings.push(`Binder "${b.name}": ${message(e)}`)
    return { ...b, slots: [] }
  })

  const drawerIds = boxes.flatMap(box => box.drawers.map(d => d.id))
  const caseIds = spaces.flatMap(space => space.displayCases.map(c => c.id))
  onProgress('Reading what is in each box and case…')
  const [drawerLists, caseLists] = await Promise.all([
    pool(drawerIds, id => getDrawerPlacements(userId, id), (_, e) => { warnings.push(`Box compartment: ${message(e)}`); return [] as CardAllocation[] }),
    pool(caseIds, id => getCaseAllocations(userId, id), (_, e) => { warnings.push(`Display case: ${message(e)}`); return [] as CardAllocation[] }),
  ])

  // Cards in binder pockets that the user doesn't own aren't in the owned list; fetch only their sets.
  const cards = owned.map(o => o.card)
  const known = Object.fromEntries(cards.map(c => [c.id, c]))
  const missing = unknownPocketCards(binders, known) as string[]
  const missingSets = [...new Set(missing.map(id => setIdOf(id)).filter((id): id is string => Boolean(id)))]
  if (missingSets.length) {
    onProgress('Reading card art for your binders…')
    const wanted = new Set(missing)
    const catalogs = await pool(missingSets, id => getCards(id), () => [] as Card[])
    for (const list of catalogs) for (const card of list) if (wanted.has(card.id)) cards.push(card)
  }

  return {
    userId, spaces, boxes, binders, lots,
    allocations: [...drawerLists.flat(), ...caseLists.flat()],
    cards,
    ownedIds: owned.map(o => o.cardId),
    ownedCopies: owned.reduce((n, o) => n + o.conditions.reduce((m, c) => m + c.quantity, 0), 0),
    setNames: Object.fromEntries(sets.map(s => [s.id, s.name])),
    warnings,
  }
}

/**
 * PURPOSE: The market price of one copy, priced exactly like the site's tiles: the lot's own condition and print, or
 *          for a binder pocket (which records no condition) the card's headline price.
 * @param card  the catalog card with its prices
 * @param lot   condition / edition / print of the copy; condition '' = a binder pocket
 * @return price (null = no quote) and the print it is for
 */
function priceOf(card: Card, lot: { condition: string; edition: string; variantKey: string }) {
  const print = lot.variantKey && lot.variantKey !== 'standard' ? lot.variantKey : defaultVariant(card)
  const price = lot.condition ? condPrice(card, lotKey(lot)) : basePrice(card)
  return { price: price > 0 ? price : null, printLabel: print ? variantLabel(print) : null }
}

/** The shape the room's 3D cards and picker read. */
function pickerCard(card: Card, setNames: Record<string, string>) {
  return {
    id: card.id, cardId: card.id, name: card.name, number: card.number, rarity: card.rarity ?? '',
    setId: card.setId, setName: setNames[card.setId] ?? card.setId,
    imageUrl: card.images?.large || card.images?.small, imageSmall: card.images?.small,
  }
}

/**
 * PURPOSE: Cards for the binder-pocket picker: the user's own cards (by name) until they type, then a catalog search.
 * @param raw    the current collection read (for owned cards and set names)
 * @param query  what the user typed; null = picker closed
 * @return the cards to show and whether a search is still running
 */
export function usePocketSearch(raw: RoomRaw | undefined, query: string | null) {
  const q = (query ?? '').trim()
  const search = useQuery({
    queryKey: ['room3d-search', currentGame(), q],
    queryFn: () => searchCards(q),
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
  })
  return useMemo(() => {
    if (query === null || !raw) return { cards: [], searching: false }
    if (q.length < 2) {
      const ownedIds = new Set(raw.ownedIds)
      const mine = raw.cards.filter(c => ownedIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)
      return { cards: mine.map(c => pickerCard(c, raw.setNames)), searching: false }
    }
    return { cards: (search.data ?? []).map(c => pickerCard(c, raw.setNames)), searching: search.isFetching }
  }, [query, q, raw, search.data, search.isFetching])
}

/**
 * PURPOSE: The room's data hook.
 * @param userId  signed-in user's id (the query waits until there is one)
 * @return status, the derived world model, shelf paging controls, refresh and the pocket write
 */
export function useLiveRoom(userId: string | undefined) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState('Opening your room…')
  const [nav, setNav] = useState(DEFAULT_NAV)
  const queryKey = useMemo(() => ['room3d', userId, currentGame()], [userId])
  const query = useQuery({
    queryKey,
    queryFn: () => fetchRoom(userId!, setProgress),
    enabled: Boolean(userId),
    staleTime: 0, // always re-read on entry: other pages change boxes and binders
    refetchOnWindowFocus: false,
  })
  const raw = query.data

  const state = useMemo(() => (raw ? buildLiveState({ ...raw, priceOf }) : null), [raw])
  const world = useMemo(() => (state ? toWorldModel(state, { nav, setNames: raw!.setNames }) : null), [state, nav, raw])
  const lookup = useMemo(() => (state ? createLookup(state, raw!.setNames) : null), [state, raw])

  // Which unit / window / case each zone shows. Selecting anything calls `reveal`, which pages it into view.
  const navApi = useMemo(() => {
    const first = { shelfPage: 0, positionPage: 0 }
    return {
      setBinderUnit: (id: string) => setNav(n => ({ ...n, binderUnitId: id, binderWin: first })),
      setBinderWin: (patch: object) => setNav(n => ({ ...n, binderWin: { ...n.binderWin, ...patch } })),
      setBoxUnit: (id: string) => setNav(n => ({ ...n, boxUnitId: id, boxWin: first })),
      setBoxWin: (patch: object) => setNav(n => ({ ...n, boxWin: { ...n.boxWin, ...patch } })),
      setCase: (id: string) => setNav(n => ({ ...n, caseId: id, casePage: 0 })),
      setCasePage: (page: number) => setNav(n => ({ ...n, casePage: page })),
      reveal: (kind: string, id: string) => setNav(n => (state ? revealNav(state, n, kind, id) : n)),
    }
  }, [state])

  /**
   * PURPOSE: Puts `card` into a binder pocket with the binder page's own call, then shows it in the room straight away.
   * @param binderId   the binder
   * @param slotIndex  pocket number across all pages
   * @param card       the picked card (picker shape)
   */
  const placeInPocket = useCallback(async ({ binderId, slotIndex, card }: { binderId: string; slotIndex: number; card: { id: string; name: string; imageSmall?: string } }) => {
    if (!userId) throw new Error('Sign in to change your binders.')
    await setSlot(userId, binderId, slotIndex, { cardId: card.id, cardName: card.name, imageUrl: card.imageSmall })
    const fromSearch = queryClient.getQueriesData<Card[]>({ queryKey: ['room3d-search'] }).flatMap(([, list]) => list ?? [])
    queryClient.setQueryData<RoomRaw>(queryKey, old => {
      if (!old) return old
      const full = old.cards.find(c => c.id === card.id) ?? fromSearch.find(c => c.id === card.id)
      return {
        ...old,
        cards: full && !old.cards.some(c => c.id === card.id) ? [...old.cards, full] : old.cards,
        binders: old.binders.map(b => b.id !== binderId ? b : {
          ...b,
          slots: [...b.slots.filter(s => s.slotIndex !== slotIndex), { slotIndex, cardId: card.id, cardName: card.name, imageUrl: card.imageSmall }],
        }),
      }
    })
  }, [userId, queryClient, queryKey])

  const status = query.isError && !raw ? 'error' : raw ? 'ready' : 'loading'
  return {
    status,
    error: query.error ? message(query.error) : null,
    progress,
    refreshing: query.isFetching && Boolean(raw),
    refresh: () => { void query.refetch() },
    raw,
    state,
    world,
    lookup,
    nav: { ...navApi, current: nav },
    data: world,
    warnings: raw?.warnings ?? [],
    placeInPocket,
  }
}
