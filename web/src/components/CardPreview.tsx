/**
 * Centered enlarged card image shown on thumbnail hover (old tracker's
 * preview overlay). Carries the same holo-shimmer / price-ribbon
 * treatment as the small CardTile thumbnail — the zoom should look like a
 * bigger version of what was just hovered, not a plainer one. Both are
 * optional so every existing `preview.show(url)` call site (trade cards,
 * binder slots, convention search — none of which show a ribbon on their
 * own thumbnail) keeps working unchanged.
 *
 * Two ways it opens:
 *   - hover (a mouse over a picture): see-through, closes when the mouse leaves the picture;
 *   - click or tap (`pinned`): the page dims behind it and it stays until a click/tap anywhere or Esc. Without
 *     this a clicked zoom (a seller photo, a card picture) had nothing on a computer that could close it.
 *   On a phone every zoom covers the screen and closes on tap (collection-shelf.css).
 *
 * USED BY: CollectionPage, BulkAddPage (via CardTile's onPreview), SpacesLivePage,
 *   ShopPage (ShopCardTile), ShopRequestsPage (RequestedCards), ShopRequestStatusPage, AnalyzerPage, BinderViewPage,
 *   ConventionModePage
 */

import { useEffect, useRef, useState } from 'react'

/** A tap's own click arrives this soon after the zoom it opened; ignored so the tap doesn't also close it. */
const OPENING_TAP_MS = 500

export interface PreviewOpts {
  holo?: boolean
  price?: number
  /** Opened by a click or tap: stays (page dimmed) until clicked away or Esc, instead of closing on mouse-out. */
  pinned?: boolean
}

/** Returns `show`/`hide` controls plus the overlay JSX to render once near the top of a page. */
export function usePreview() {
  const [state, setState] = useState<({ src: string } & PreviewOpts) | null>(null)
  // On a phone the zoom covers the screen and closes on tap. A tap on a picture opens it before the tap's click
  // arrives, and that click then lands on the zoom: without this it would close the moment it opened.
  const shownAt = useRef(0)
  const open = !!state

  // Esc closes any zoom.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return {
    show: (src: string, opts?: PreviewOpts) => { shownAt.current = performance.now(); setState({ src, ...opts }) },
    /** The mouse left the picture: closes a hover zoom, but not one that was clicked open. */
    hide: () => setState(s => (s?.pinned ? s : null)),

    overlay: (
      <div className={'card-preview-overlay' + (state ? ' active' : '') + (state?.pinned ? ' pinned' : '')}
        onClick={() => { if (performance.now() - shownAt.current > OPENING_TAP_MS) setState(null) }}>
        <div className={'card-preview-wrap' + (state ? ' visible' : '') + (state?.holo ? ' holo' : '')}>
          {/* omit src entirely while hidden — an empty string still triggers a network request */}
          <img className="card-preview-img" src={state?.src} alt="" />
          {state?.price != null && state.price > 0 && (
            <span className="card-preview-ribbon">${state.price.toFixed(2)}</span>
          )}
        </div>
      </div>
    ),
  }
}
