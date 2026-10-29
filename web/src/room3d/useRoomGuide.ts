/**
 * useRoomGuide.ts — whether the room's how-to guide (RoomGuide.tsx) is showing.
 *
 * PURPOSE
 *   The guide opens by itself on someone's first visit and stays closed once they finish or skip it. "Seen" is one
 *   localStorage flag per browser (the site keeps small conveniences there, like BulkAddPage's session); blocked
 *   storage just means the guide shows again next visit.
 *
 * USED BY: pages/RoomPage.tsx
 * DEPENDS ON: nothing
 */
import { useCallback, useState } from 'react'

const SEEN_KEY = 'cardstacks.roomGuide.v1'

/** True when this browser has already finished or skipped the guide. */
function alreadySeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

/** Remembers that the guide was seen; blocked storage is fine (it just shows again). */
function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* storage blocked */ }
}

/**
 * PURPOSE: Whether the guide is showing: open on a first visit, closed once finished or skipped.
 * @return [open, show, hide] — `hide` also remembers that it was seen
 */
export function useRoomGuide(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(() => !alreadySeen())
  const show = useCallback(() => setOpen(true), [])
  const hide = useCallback(() => { markSeen(); setOpen(false) }, [])
  return [open, show, hide]
}
