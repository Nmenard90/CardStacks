/**
 * FILE: CardPreview.tsx — the centered enlarged card image shown while
 * hovering a thumbnail, exactly as the old tracker's preview overlay.
 *
 * Carries the same holo-shimmer and price-ribbon treatment as the small
 * CardTile thumbnail (see PreviewOpts) — the zoom is supposed to be a
 * bigger version of what you were just looking at, not a plainer one.
 * Both are optional and default to off, so every existing `preview.show(url)`
 * call site (trade cards, binder slots, convention search results — none of
 * which show a price ribbon on their own thumbnail either) keeps working
 * unchanged.
 *
 * USED BY: CollectionPage, OwnedPage, BulkAddPage (via CardTile's onPreview),
 *   AnalyzerPage, BinderViewPage, ConventionModePage
 */
import { useState } from 'react'

export interface PreviewOpts {
  holo?: boolean
  price?: number
}

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
