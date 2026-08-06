/**
 * BinderShelfPage — "My Binders." A grid of binder covers, plus the New
 * Binder modal (name, cover photo, pocket size).
 *
 * HOW IT WORKS
 *   Loads the shelf once per logged-in user. Cover photos are stored as
 *   data URLs (the file is read client-side and inlined as base64 —
 *   there's no separate image upload endpoint). Create is two calls:
 *   createBinder (name + pocketSize only) then, if a cover was picked, a
 *   follow-up updateBinder — the create endpoint doesn't accept a cover directly.
 *
 * USED BY: App (route "/shelf")
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBinder, deleteBinder, listBinders, updateBinder } from '../api/binders'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { HeaderNav } from '../components/HeaderNav'
import { Mascot } from '../components/Mascot'
import type { Binder, PocketSize } from '../types'

/** Display number for each backend pocket size. */
const SIZE_NUM: Record<PocketSize, number> = { Four: 4, Nine: 9, Twelve: 12 }

/** Modal pocket-size options in the old page's order: 9, 4, 12. */
const SIZE_OPTIONS: PocketSize[] = ['Nine', 'Four', 'Twelve']

export function BinderShelfPage() {
  const { user } = useUser()
  const toast = useToast()
  const navigate = useNavigate()

  // ── Page state ──────────────────────────────────────────────────────────
  const [binders, setBinders] = useState<Binder[]>([])              // the shelf
  const [loaded, setLoaded] = useState(false)                       // first fetch done
  const [confirmId, setConfirmId] = useState<string | null>(null)   // delete overlay open for this binder

  // Create-modal state.
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [cover, setCover] = useState<string | null>(null)           // chosen cover photo, as a data URL
  const [size, setSize] = useState<PocketSize>('Nine')
  const [creating, setCreating] = useState(false)                   // create request in flight

  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Logged-out visitors go back to the login screen.
  useEffect(() => { if (!user) navigate('/') }, [user, navigate])

  // Load the shelf once per user.
  useEffect(() => {
    if (!user) return
    listBinders(user.id)
      .then(b => { setBinders(b); setLoaded(true) })
      .catch(() => { setLoaded(true); toast('Could not load binders.') })
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create modal ────────────────────────────────────────────────────────

  // Opens the "New Binder" popup, resetting all its fields first.
  const openModal = () => {
    setName(''); setCover(null); setSize('Nine'); setModalOpen(true)

    // Give the popup a moment to appear, then put the cursor in the name box.
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  /** Reads the chosen image as a data URL for the cover preview. 5 MB cap. */
  const handleCover = (file: File | undefined) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB'); return }

    // Reads the picked file and turns it into one long piece of text that
    // an <img> tag can display directly, with no upload needed.
    const reader = new FileReader()
    reader.onload = ev => setCover(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  /**
   * Creates the binder, attaches the cover in a second call (the create
   * endpoint takes only name + pocketSize), then opens it.
   */
  const create = async () => {
    if (!user || creating) return
    setCreating(true)

    try {
      const b = await createBinder(user.id, name.trim() || 'My Binder', size)
      if (cover) await updateBinder(user.id, b.id, { coverImage: cover })
      navigate(`/binder/${b.id}`)
    } catch {
      toast('Failed to create binder')
      setCreating(false)
    }
  }

  // Deletes one binder by its id.
  const remove = async (id: string) => {
    if (!user) return
    try {
      await deleteBinder(user.id, id)
      setBinders(prev => prev.filter(b => b.id !== id))
      setConfirmId(null)
    } catch {
      toast('Delete failed — try again.')
    }
  }

  // Escape closes the modal; Enter inside it creates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false)
      if (e.key === 'Enter' && modalOpen) create()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bound each render so `create` always sees the current modal state

  // Nobody logged in — the redirect above is already sending them away.
  if (!user) return null

  return (
    <div className="page-shelf">
      <div id="bar">
        <span className="bar-title">My Binders</span>
        <span className="bar-user">{user.username}</span>
        <div className="sp" />
        <button className="new-btn" onClick={openModal}>+ New Binder</button>
        <HeaderNav />
      </div>

      <div id="main">
        <div className="shelf-label">
          {loaded ? `${binders.length} binder${binders.length !== 1 ? 's' : ''}` : 'Loading…'}
        </div>
        <div className="grid">

          {loaded && binders.length === 0 && (
            <div className="empty">
              <Mascot size={84} mood="idle" />
              <h3>No binders yet</h3>
              <p>Click "+ New Binder" to create your first one</p>
            </div>
          )}

          {binders.map(b => (
            <div className="bcard" key={b.id}>
              <div className="bcover" onClick={() => navigate(`/binder/${b.id}`)}>
                {b.coverImage
                  ? <img className="bcover-img" src={b.coverImage} alt={b.name} />
                  : <div className="bcover-default-icon">📖</div>}
                <div className="bcover-overlay" />
                {/* Three plain shapes styled by CSS to look like a binder's
                    metal spine rings. */}
                <div className="bcover-rings">
                  <div className="bcover-ring" /><div className="bcover-ring" /><div className="bcover-ring" />
                </div>
              </div>
              <div className="binfo">
                <div className="binfo-text">
                  <div className="bname">{b.name}</div>
                  <div className="bmeta">
                    {SIZE_NUM[b.pocketSize]}-pocket
                    {/* The shelf list doesn't include full slot data, so
                        this card count usually only fills in once you've
                        actually opened the binder at least once. */}
                    {b.slots.length > 0 ? ` · ${b.slots.filter(s => s.cardId).length} cards` : ''}
                  </div>
                </div>
                <button
                  className="bmore" title="Delete"
                  onClick={e => { e.stopPropagation(); setConfirmId(c => (c === b.id ? null : b.id)) }}
                >⋯</button>
              </div>
              <div className={'del-confirm' + (confirmId === b.id ? ' show' : '')}>
                <p>Delete <strong>{b.name}</strong>?<br />This cannot be undone.</p>
                <div className="del-btns">
                  <button className="del-no" onClick={() => setConfirmId(null)}>Cancel</button>
                  <button className="del-yes" onClick={() => remove(b.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create modal. Clicking the dark backdrop (not the box itself) closes it. */}
      <div id="modal" className={modalOpen ? 'open' : ''} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
        <div id="mbox">
          <div className="mhead">
            <h3>New Binder</h3>
            <button className="mx" onClick={() => setModalOpen(false)}>✕</button>
          </div>
          <div className="mbody">
            <div className="mfield">
              <label>Binder Name</label>
              <input
                ref={nameRef} type="text" placeholder="e.g. Base Set Collection" maxLength={40}
                value={name} onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="mfield">
              <label>Cover Photo</label>
              {/* Clicking this styled box triggers the real, hidden file
                  input below, so we're not stuck with the browser's plain
                  default "Choose File" button. */}
              <div className="cover-upload" onClick={() => fileRef.current?.click()}>
                {!cover && (
                  <div className="cover-upload-placeholder">
                    <div className="uicon">📷</div>
                    <p>Click to upload a photo</p>
                    <span>JPG, PNG, GIF — max 5MB</span>
                  </div>
                )}
                {cover && <img src={cover} alt="" />}
              </div>
              <input
                ref={fileRef} id="coverInput" type="file" accept="image/*"
                onChange={e => handleCover(e.target.files?.[0])}
              />
            </div>
            <div className="mfield">
              <label>Pocket Size</label>
              <div className="sz-row">
                {SIZE_OPTIONS.map(s => (
                  <div
                    key={s} className={'sz-opt' + (size === s ? ' on' : '')}
                    onClick={() => setSize(s)}
                  >
                    {SIZE_NUM[s]}-Pocket
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mfoot">
            <button className="m-cancel" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="m-create" onClick={create} disabled={creating}>
              {creating ? 'Creating…' : 'Create Binder →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
