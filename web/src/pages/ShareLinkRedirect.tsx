/**
 * ShareLinkRedirect — where an old share link (/s/<slug>) lands.
 *
 * HOW IT WORKS
 *   Share-link trading was folded into the shop, so an old link sends the
 *   visitor to the same collector's shop (/shop/<their shop link>). If that
 *   person has no shop open, it says so instead of showing a blank page.
 *
 * USED BY: App.tsx (route "/s/:slug")
 * DEPENDS ON: api/shop
 */

import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { shopForShareLink } from '../api/shop'

export function ShareLinkRedirect() {
  const { slug = '' } = useParams()
  const { data: shopSlug, isLoading } = useQuery({
    queryKey: ['shop-from-share', slug], queryFn: () => shopForShareLink(slug), retry: false,
  })

  if (shopSlug) return <Navigate to={`/shop/${shopSlug}`} replace />
  return (
    <div className="page-tracker">
      <main className="trade-main">
        <div className="trade-empty">
          {isLoading ? <p role="status">Opening the collector’s shop…</p> : <>
            <h2>This link has moved</h2>
            <p>Trade links now open the collector’s shop, but this collector doesn’t have a shop open right now. Ask them for their shop link.</p>
            <p><Link to="/">Go to CardStacks →</Link></p>
          </>}
        </div>
      </main>
    </div>
  )
}
