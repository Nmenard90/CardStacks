/**
 * NotFoundPage — what an address that isn't part of the site shows (a mistyped
 * link, an old bookmark), instead of a blank page.
 *
 * USED BY: App.tsx (the catch-all route "*")
 */

import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="page-tracker">
      <main className="trade-main">
        <div className="trade-empty">
          <h1>Page not found</h1>
          <p>There’s nothing at this address. The link may be mistyped, or the page has moved.</p>
          <p><Link to="/">Go to your collection room →</Link></p>
        </div>
      </main>
    </div>
  )
}
