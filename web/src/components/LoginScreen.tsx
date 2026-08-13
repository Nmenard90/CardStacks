/**
 * AuthScreen — full-screen sign-in/sign-up, and the app's landing page for
 * anyone without a session. Two panels: what the product is and how Spaces
 * work (left), and the actual Supabase-backed auth form (right). There is
 * no list of other users anywhere on this screen — the old "pick an
 * existing account" chips let anyone browse every registered username,
 * which is exactly what a real account system should never do.
 *
 * HOW IT WORKS
 *   Sign-up and sign-in both go straight to Supabase Auth (supabase.auth.*)
 *   — this app never touches a password. Once Supabase confirms the
 *   credentials, UserContext's onAuthStateChange listener picks up the new
 *   session automatically and fetches this collector's profile from the
 *   backend (GET /api/auth/me); nothing here needs to call setUser itself.
 *
 * USED BY: every page that gates on useUser().user being null
 */

import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { useUser } from '../context/UserContext'
import { Mascot } from './Mascot'

type Mode = 'signin' | 'signup'

const SPACE_AREAS = [
  {
    title: 'Storage',
    body: "Real boxes on real shelf units — pick a preset like an 800-count long box or a 5-row monster box, stack it, and every card you assign lives in an actual drawer position.",
  },
  {
    title: 'Binder Library',
    body: "Arrange owned cards into virtual binder pages by pocket size (4/9/12), the same way you'd flip through a physical binder.",
  },
  {
    title: 'Display Gallery',
    body: 'Showcase your favorites in a wall case, a lit cabinet, or a single-card pedestal — built for the cards you want to look at, not just store.',
  },
]

export function LoginScreen() {
  const toast = useToast()
  const { loading } = useUser()
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  const switchMode = (next: Mode) => { setMode(next); setCheckEmail(false) }

  // Avoids flashing the sign-in form for someone whose session is still
  // being checked (e.g. a page refresh for an already-logged-in collector).
  if (loading) return <div id="loginScreen" className="auth-page auth-loading"><Mascot size={52} mood="idle" /></div>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return

    if (mode === 'signup') {
      if (username.trim().length < 3) { toast('Username must be at least 3 characters'); return }
      if (password.length < 6) { toast('Password must be at least 6 characters'); return }
      if (password !== confirmPassword) { toast("Passwords don't match"); return }
    }

    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: username.trim() } },
        })
        if (error) throw error
        if (!data.session) {
          // Email confirmation is enabled on this Supabase project — no
          // session yet, so there's nothing for UserContext to pick up.
          setCheckEmail(true)
          setMode('signin')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Something went wrong — try again')
    } finally {
      setBusy(false)
    }
  }

  // Supabase anonymous auth — a real (if throwaway) session, so it flows
  // through UserContext/backend exactly like a normal account. The backend
  // marks it isAnonymous and clears the row 24h after creation.
  const tryDemo = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) throw error
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not start the demo — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="loginScreen" className="auth-page">
      <div className="auth-hero">
        <div className="auth-brand">
          <Mascot size={52} mood="idle" />
          <span className="auth-wordmark">CARDSTACKS</span>
        </div>
        <h1>Every card you own, organized like a real collection.</h1>
        <p className="auth-tagline">
          Track condition and quantity, value your collection from live market
          prices, and lay it out the way it actually sits in your room.
        </p>

        <div className="auth-explainer">
          <h2>How Spaces work</h2>
          <p className="auth-explainer-lede">
            Spaces is your collection room — every collector gets one, with three areas:
          </p>
          <div className="auth-explainer-grid">
            {SPACE_AREAS.map(area => (
              <div className="auth-explainer-card" key={area.title}>
                <h3>{area.title}</h3>
                <p>{area.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-tabs">
            <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>
              Log in
            </button>
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>
              Sign up
            </button>
          </div>

          {checkEmail && (
            <p className="auth-notice">Check your email to confirm your account, then log in below.</p>
          )}

          <form onSubmit={submit} className="auth-form">
            {mode === 'signup' && (
              <label htmlFor="auth-username">
                Username
                <input
                  id="auth-username" name="username"
                  type="text" value={username} maxLength={30} autoComplete="username"
                  onChange={e => setUsername(e.target.value)} required
                />
              </label>
            )}
            <label htmlFor="auth-email">
              Email
              <input
                id="auth-email" name="email"
                type="email" value={email} autoComplete="email"
                onChange={e => setEmail(e.target.value)} required
              />
            </label>
            <label htmlFor="auth-password">
              Password
              <input
                id="auth-password" name="password"
                type="password" value={password} minLength={6}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                onChange={e => setPassword(e.target.value)} required
              />
            </label>
            {mode === 'signup' && (
              <label htmlFor="auth-confirm-password">
                Confirm password
                <input
                  id="auth-confirm-password" name="confirmPassword"
                  type="password" value={confirmPassword} minLength={6} autoComplete="new-password"
                  onChange={e => setConfirmPassword(e.target.value)} required
                />
              </label>
            )}

            <button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'signin'
              ? <>New here? <button type="button" onClick={() => switchMode('signup')}>Create an account</button></>
              : <>Already have an account? <button type="button" onClick={() => switchMode('signin')}>Log in</button></>}
          </p>

          <div className="auth-divider"><span>or</span></div>
          <button type="button" className="auth-demo-btn" onClick={tryDemo} disabled={busy}>
            Try the demo — no signup required
          </button>
          <p className="auth-demo-note">Poke around with a temporary account. It's cleared automatically after 24 hours.</p>
        </div>
      </div>
    </div>
  )
}
