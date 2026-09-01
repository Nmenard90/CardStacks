/**
 * LegalPage — renders the Privacy Policy or Terms of Service.
 *
 * HOW IT WORKS
 *   One component, two static bodies, picked by the `page` prop. Exists
 *   because both the Google OAuth consent screen and the Play Store listing
 *   require a public, stable URL for these before they'll let the app go
 *   live — the content itself is a starting-point template, not
 *   lawyer-reviewed, and should be revisited before real user volume shows
 *   up.
 *
 * USED BY: App (routes "/privacy" and "/terms")
 */

import { Link } from 'react-router-dom'

const CONTACT_EMAIL = 'REPLACE_WITH_SUPPORT_EMAIL@example.com'
const LAST_UPDATED = 'August 24, 2026'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 80px', lineHeight: 1.6, color: 'var(--text, #e8e8e8)' }}>
      <Link to="/" style={{ fontSize: 14, opacity: 0.7 }}>&larr; Back to CardStacks</Link>
      <h1 style={{ marginTop: 16 }}>{title}</h1>
      <p style={{ opacity: 0.6, fontSize: 13 }}>Last updated {LAST_UPDATED}</p>
      {children}
    </div>
  )
}

function Privacy() {
  return (
    <Shell title="Privacy Policy">
      <p>
        CardStacks ("we", "us") is a personal card collection tracker. This
        page explains what data we collect and what we do with it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account info:</b> email address and username, via Supabase Auth (or your Google account if you sign in with Google). We never see or store your password.</li>
        <li><b>Collection data:</b> the cards, quantities, conditions, boxes, binders, and displays you create in the app.</li>
        <li><b>Demo accounts:</b> the "Try the demo" option creates a temporary anonymous account that is automatically deleted after 24 hours.</li>
      </ul>
      <p>We do not collect location data, contacts, or device identifiers for advertising, and we do not sell your data to anyone.</p>

      <h2>How we use it</h2>
      <p>Solely to run the app: authenticating you, storing and displaying your collection, and pricing your cards from third-party market data. We do not use your data for ad targeting.</p>

      <h2>Where it's stored</h2>
      <p>Account/auth data is stored with Supabase. Collection data is stored in a PostgreSQL database we operate on Railway. Both providers encrypt data in transit (HTTPS/TLS).</p>

      <h2>Third parties</h2>
      <p>We use Supabase for authentication and Google (if you choose "Continue with Google") solely to sign you in. Card pricing data comes from third-party TCG pricing APIs and does not involve your personal data.</p>

      <h2>Your choices</h2>
      <p>You can delete your account and all associated collection data at any time by contacting us at {CONTACT_EMAIL}.</p>

      <h2>Children</h2>
      <p>CardStacks is not directed at children under 13, and we do not knowingly collect data from them.</p>

      <h2>Contact</h2>
      <p>Questions about this policy: {CONTACT_EMAIL}</p>
    </Shell>
  )
}

function Terms() {
  return (
    <Shell title="Terms of Service">
      <p>By using CardStacks, you agree to these terms.</p>

      <h2>The service</h2>
      <p>CardStacks lets you track a trading card collection: cards owned, condition, quantity, and estimated market value, organized into boxes, binders, and displays. Pricing shown in the app is estimated from third-party market data and is not a guarantee of actual sale value.</p>

      <h2>Your account</h2>
      <p>You're responsible for the activity on your account and for keeping your login credentials secure. Demo accounts are temporary and are deleted automatically after 24 hours.</p>

      <h2>Your content</h2>
      <p>The collection data you enter is yours. We don't claim ownership of it; we store and display it back to you as part of the service.</p>

      <h2>Acceptable use</h2>
      <p>Don't use CardStacks to attempt to disrupt the service, access other users' data, or violate applicable law.</p>

      <h2>No warranty</h2>
      <p>CardStacks is provided "as is." Pricing data is estimated and may be inaccurate or delayed; we're not liable for decisions (trades, purchases, sales) made based on it.</p>

      <h2>Changes</h2>
      <p>We may update these terms or the app's features over time. Continued use after a change means you accept the update.</p>

      <h2>Contact</h2>
      <p>Questions: {CONTACT_EMAIL}</p>
    </Shell>
  )
}

export function LegalPage({ page }: { page: 'privacy' | 'terms' }) {
  return page === 'privacy' ? <Privacy /> : <Terms />
}
