/**
 * CardCamera — a camera screen for photographing a trading card, with an
 * alignment guide so every photo is framed the same way.
 *
 * HOW IT WORKS
 *   Opens the phone's back camera inside the page (no separate camera app) and
 *   draws a card-shaped outline over the live picture: bold corner brackets,
 *   a NAME bar and the PICTURE BOX for the front, a centre LOGO ring for the
 *   back. The seller lines the card up with the outline, so all four edges
 *   and corners are in the shot (edges and corners are what decide condition).
 *   "Take photo" crops the live picture to exactly the guide area plus a small
 *   margin, shrinks it to a JPEG (900 px wide) and shows it for review —
 *   "Use this photo" hands the JPEG to the parent, "Retake" goes back.
 *   If the camera is blocked or unavailable, "Choose a photo" picks an existing
 *   picture instead (on a phone that also offers the camera app).
 *
 * USED BY: ShopPhotoManager
 */

import { useEffect, useRef, useState } from 'react'
import type { PhotoSide } from '../api/shop'

type Status = 'starting' | 'live' | 'blocked' | 'unsupported'

/** Width / height of the guide area: a 63 x 88 mm card plus a small margin all round. */
const ASPECT = 630 / 880
/** Width of a captured picture, in pixels. */
const OUT_W = 900
/** Longest side of a picture chosen from the gallery, in pixels. */
const MAX_SIDE = 1400

/** False on browsers without camera access (or pages not served over https). */
const hasCamera = () => typeof navigator.mediaDevices?.getUserMedia === 'function'

export function CardCamera({ side, onCapture, onClose }: {
  side: PhotoSide
  onCapture: (jpeg: Blob) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<Status>(hasCamera() ? 'starting' : 'unsupported')
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [note, setNote] = useState('')

  // Start the back camera; stop it again when this screen closes.
  useEffect(() => {
    if (!hasCamera()) return
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        stream.current = s
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => undefined) }
        setStatus('live')
      })
      .catch(() => { if (!cancelled) setStatus('blocked') })
    return () => { cancelled = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }
  }, [])

  // Free the review picture when it is replaced or the screen closes.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const keep = (blob: Blob | null) => {
    if (blob) setShot({ blob, url: URL.createObjectURL(blob) })
    else setNote('Could not make that photo. Please try again.')
  }

  /** Crops the live picture to the guide area (what the card outline frames, margin included). */
  const snap = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const vw = v.videoWidth, vh = v.videoHeight
    let cw = vw, ch = vh
    if (vw / vh > ASPECT) cw = vh * ASPECT; else ch = vw / ASPECT
    const w = Math.min(OUT_W, Math.round(cw)), h = Math.round(w / ASPECT)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d')?.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, w, h)
    setNote('')
    canvas.toBlob(keep, 'image/jpeg', 0.85)
  }

  /** Uses a picture from the gallery / camera app, shrunk to a sensible size. */
  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      setNote('')
      canvas.toBlob(keep, 'image/jpeg', 0.85)
    } catch {
      setNote('That file could not be read as a picture.')
    }
  }

  const label = side === 'front' ? 'Front of the card' : 'Back of the card'

  return (
    <div className="cam-modal" role="dialog" aria-modal="true" aria-label={`Photo: ${label}`}>
      <div className="cam-sheet">
        <header className="cam-head">
          <b>{label}</b>
          <button type="button" className="cam-x" onClick={onClose} aria-label="Close camera">✕</button>
        </header>

        <div className="cam-view">
          <video ref={video} playsInline muted autoPlay style={{ display: shot ? 'none' : 'block' }} />
          {shot && <img src={shot.url} alt="Your photo of the card" />}
          <Guide side={side} faint={!!shot} />
          {!shot && status === 'starting' && <p className="cam-msg">Starting the camera…</p>}
          {!shot && status === 'blocked' && <p className="cam-msg">The camera is blocked. Allow camera access in your browser, or choose a photo below.</p>}
          {!shot && status === 'unsupported' && <p className="cam-msg">This browser can't open the camera here. Choose a photo below.</p>}
        </div>

        {shot ? (
          <ul className="cam-tips" aria-label="Check your photo">
            <li>Are all four <b>edges and corners</b> inside the outline and sharp?</li>
            <li>No glare or shadow across the card?</li>
          </ul>
        ) : (
          <ul className="cam-tips" aria-label="Photo tips">
            <li>Line the card up with the outline{side === 'front' ? ': name in the name bar, picture in the box' : ', logo in the ring'}.</li>
            <li>Get <b>all four edges and corners</b> inside the outline. They show the condition.</li>
            <li>Lay it flat, with even light and no glare.</li>
          </ul>
        )}
        {note && <p className="shop-error" role="alert">{note}</p>}

        <div className="cam-btns">
          {shot ? (
            <>
              <button type="button" className="shop-btn" onClick={() => onCapture(shot.blob)}>Use this photo</button>
              <button type="button" className="shop-btn shop-btn-ghost" onClick={() => setShot(null)}>Retake</button>
            </>
          ) : (
            <>
              <button type="button" className="shop-btn" disabled={status !== 'live'} onClick={snap}>📷 Take photo</button>
              <label className="shop-btn shop-btn-ghost">
                📁 Choose a photo
                <input type="file" accept="image/*" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The overlay: card outline, corner brackets, and the markers to line up. Drawn on the same 630x880 grid as the capture. */
function Guide({ side, faint }: { side: PhotoSide; faint: boolean }) {
  const line = faint ? 'rgba(255,255,255,.4)' : '#ffd93d'
  const mark = { fill: 'none', stroke: line, strokeWidth: 3, strokeDasharray: '10 8' }
  const word = { fill: line, fontSize: 24, fontWeight: 800, fontFamily: 'sans-serif', letterSpacing: 2 }
  return (
    <svg className="cam-guide" viewBox="0 0 630 880" preserveAspectRatio="none" aria-hidden="true">
      <rect x="45" y="63" width="540" height="754" rx="28" {...mark} />
      {/* Bold corner brackets: line these up with the card's corners. */}
      <g fill="none" stroke={line} strokeWidth="9" strokeLinecap="round">
        <path d="M45 125 V91 Q45 63 73 63 H107" />
        <path d="M585 125 V91 Q585 63 557 63 H523" />
        <path d="M45 755 V789 Q45 817 73 817 H107" />
        <path d="M585 755 V789 Q585 817 557 817 H523" />
      </g>
      {side === 'front' ? (
        <>
          <rect x="83" y="97" width="300" height="46" rx="8" {...mark} />
          <text x="97" y="129" {...word}>NAME</text>
          <rect x="83" y="150" width="464" height="309" rx="8" {...mark} />
          <text x="315" y="312" textAnchor="middle" {...word}>PICTURE BOX</text>
        </>
      ) : (
        <>
          <circle cx="315" cy="440" r="96" {...mark} />
          <text x="315" y="448" textAnchor="middle" {...word}>LOGO</text>
        </>
      )}
      <text x="315" y="44" textAnchor="middle" {...word} fontSize={21}>FIT ALL 4 EDGES &amp; CORNERS</text>
    </svg>
  )
}
