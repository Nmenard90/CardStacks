/** Types for selectors.js, as used from useLiveRoom.ts. The other selectors are read only by the room's JS. */
import type { RoomState } from './liveState'
export interface BinderSpot { spaceId: string; unitId: string; shelfIndex: number; shelfPosition: number }
export function findFreeBinderSpot(state: RoomState, unitId: string): BinderSpot | null
