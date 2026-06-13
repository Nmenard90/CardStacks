/**
 * FILE: CardPreview.tsx — the centered enlarged card image shown while
 * hovering a thumbnail, exactly as the old tracker's preview overlay.
 * USED BY: CollectionPage (via usePreview), AnalyzerPage
 */
import { useState } from 'react'

export function usePreview() {
  const [src, setSrc] = useState<string | null>(null)
  return {
    show: (s: string) => setSrc(s),
    hide: () => setSrc(null),
    overlay: (
      <div className="card-preview-overlay">
        <img
          className={'card-preview-img' + (src ? ' visible' : '')}
          src={src ?? ''} alt=""
        />
      </div>
    ),
  }
}
