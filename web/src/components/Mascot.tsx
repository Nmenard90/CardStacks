/**
 * Small recurring Poké Ball mascot for empty states and the login screen.
 * Pure inline SVG (shapes, not an image asset) so it scales cleanly and
 * needs no network round trip.
 *
 * USED BY: LoginScreen, and empty states across OwnedPage/ShelfPage/
 *   AnalyzerPage/ConventionPage/BulkAddPage.
 */

import type { ReactNode } from 'react'

interface MascotProps {
  size?: number
  mood?: 'idle' | 'sleepy'
  caption?: ReactNode
}

export function Mascot({ size = 96, mood = 'idle', caption }: MascotProps) {
  return (
    <div className="mascot-block">
      <div className={`mascot mascot-${mood}`} style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
          <clipPath id="mascot-ball-clip">
            <circle cx="50" cy="50" r="43" />
          </clipPath>

          <g clipPath="url(#mascot-ball-clip)">
            <rect x="0" y="0" width="100" height="50" fill="var(--red)" />
            <rect x="0" y="50" width="100" height="50" fill="#f5f5f7" />
          </g>

          <circle cx="50" cy="50" r="43" fill="none" stroke="#000" strokeWidth="5" />
          <rect x="4" y="46.5" width="92" height="7" fill="#000" />
          <circle cx="50" cy="50" r="13" fill="#f5f5f7" stroke="#000" strokeWidth="5" />
          <circle cx="50" cy="50" r="5" fill="#d8d8dc" />

          {mood === 'idle' ? (
            <>
              <circle className="mascot-eye" cx="30" cy="30" r="4.5" fill="#000" />
              <circle className="mascot-eye" cx="70" cy="30" r="4.5" fill="#000" />
              <path d="M36 64 Q50 76 64 64" stroke="#000" strokeWidth="4.5" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M24 30 Q30 24 36 30" stroke="#000" strokeWidth="4" fill="none" strokeLinecap="round" />
              <path d="M64 30 Q70 24 76 30" stroke="#000" strokeWidth="4" fill="none" strokeLinecap="round" />
              <circle cx="50" cy="66" r="3.5" fill="#000" />
              <text x="72" y="18" className="mascot-zzz">z</text>
            </>
          )}
        </svg>
      </div>

      {caption && <p className="mascot-caption">{caption}</p>}
    </div>
  )
}
