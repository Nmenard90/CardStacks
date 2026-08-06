/**
 * Full-screen login: name box, "Let's Go →", chips for existing users.
 * Registering needs an email, so when a typed name isn't found, an email
 * field appears inline before the account is created.
 *
 * USED BY: App (rendered whenever no user is logged in)
 */

import { useEffect, useState } from 'react'
import { findUser, listUsers, registerUser } from '../api/users'
import { useUser } from '../context/UserContext'
import { useToast } from './Toast'
import { Mascot } from './Mascot'
import type { User } from '../types'

export function LoginScreen() {
  const { setUser } = useUser()
  const toast = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  // True once the typed name has been looked up and found to not exist —
  // switches the form into "create account" mode.
  const [needsEmail, setNeedsEmail] = useState(false)

  const [busy, setBusy] = useState(false)
  const [users, setUsers] = useState<User[]>([])

  useEffect(() => {
    listUsers().then(setUsers).catch(() => {})
  }, [])

  const loginAs = (u: User) => setUser(u)

  const start = async () => {
    const n = name.trim()
    if (!n) return
    setBusy(true)

    try {
      const existing = await findUser(n)
      if (existing) { setUser(existing); return }

      // No account for this name and haven't asked for an email yet — ask
      // and wait for the next submit rather than registering blind.
      if (!needsEmail) { setNeedsEmail(true); return }

      const e = email.trim()
      if (!e) { toast('Enter an email to register'); return }

      const created = await registerUser(n, e)
      setUser(created)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: string } }
      toast(typeof ax?.response?.data === 'string' ? ax.response.data : 'Login failed — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="loginScreen">
      <div className="login-box">
        <Mascot size={84} mood="idle" />
        <h1>POKÉDEX TRACKER</h1>
        <p>Enter your name to load your collection</p>
        <input
          type="text" placeholder="Your name" maxLength={30} autoComplete="off"
          value={name}
          // Editing the name invalidates the "needs email" state — a
          // different name might already have an account.
          onChange={e => { setName(e.target.value); setNeedsEmail(false) }}
          onKeyDown={e => { if (e.key === 'Enter') start() }}
          autoFocus
        />

        {needsEmail && (
          <input
            type="email" placeholder="Email (new user — one time)" autoComplete="off"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') start() }}
            autoFocus
          />
        )}
        <button onClick={start} disabled={busy}>
          {needsEmail ? 'Create account →' : "Let's Go →"}
        </button>

        {users.length > 0 && (
          <div className="existing-users">
            <p>Or pick an existing user</p>
            <div className="user-chips">
              {users.map(u => (
                <span key={u.id} className="user-chip" onClick={() => loginAs(u)}>
                  {u.username}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
