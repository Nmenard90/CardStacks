/** Types for roomWorld.js, as used from useLiveRoom.ts. The world model itself is read only by the room's JS. */
import type { RoomState } from './liveState'
export interface Win { shelfPage: number; positionPage: number }
export interface Nav { binderUnitId: string | null; binderWin: Win; boxUnitId: string | null; boxWin: Win; caseId: string | null; casePage: number }
export const DEFAULT_NAV: Nav
export const DISPLAY_PAGE_SIZE: number
export function toWorldModel(state: RoomState, options?: { nav?: Nav; setNames?: Record<string, string> }): Record<string, unknown>
export function createLookup(state: RoomState, setNames?: Record<string, string>): Record<string, (id: string | null) => unknown>
export function revealNav(state: RoomState, nav: Nav, kind: string, id: string): Nav
