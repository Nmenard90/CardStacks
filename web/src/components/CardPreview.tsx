/**
 * Centered enlarged card image shown on thumbnail hover (old tracker's
 * preview overlay). Carries the same holo-shimmer / price-ribbon
 * treatment as the small CardTile thumbnail — the zoom should look like a
 * bigger version of what was just hovered, not a plainer one. Both are
 * optional so every existing `preview.show(url)` call site (trade cards,
 * binder slots, convention search — none of which show a ribbon on their
 * own thumbnail) keeps working unchanged.
 *
 * USED BY: CollectionPage, OwnedPage, BulkAddPage (via CardTile's onPreview),
 *   AnalyzerPage, BinderViewPage, ConventionModePage
 */

import { useState } from 'react'

export interface PreviewOpts {
  holo?: boolean
  price?: number
}

/** Returns `show`/`hide` controls plus the overlay JSX to render once near the top of a page. */
export function usePreview() {
  const [state, setState] = useState<({ src: string } & PreviewOpts) | null>(null)

  return {
    show: (src: string, opts?: PreviewOpts) => setState({ src, ...opts }),
    hide: () => setState(null),

    overlay: (
      <div className="card-preview-overlay">
        <div className={'card-preview-wrap' + (state ? ' visible' : '') + (state?.holo ? ' holo' : '')}>
          <img className="card-preview-img" src={state?.src ?? ''} alt="" />
          {state?.price != null && state.price > 0 && (
            <span className="card-preview-ribbon">${state.price.toFixed(2)}</span>
          )}
        </div>
      </div>
    ),
  }
}
