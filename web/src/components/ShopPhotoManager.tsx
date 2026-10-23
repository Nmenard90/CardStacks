/**
 * ShopPhotoManager — the seller's screen for the photos of one card in one
 * condition: a Front slot and a Back slot, each with "take / retake" (opens
 * CardCamera) and "remove".
 *
 * HOW IT WORKS
 *   A photo is for the copy you actually hold (this card in this condition),
 *   so buyers can check its edges and corners. Taking one uploads the JPEG to
 *   the seller's own shop photos and refreshes the shop page's data, so the
 *   new picture shows up straight away in its frame on the tile.
 *
 * USED BY: ShopPage (only when the seller is looking at their own shop)
 * DEPENDS ON: CardCamera, api/shop, lib/conditions
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CardCamera } from './CardCamera'
import { deleteShopPhoto, uploadShopPhoto, type PhotoSide } from '../api/shop'
import { condLabel } from '../lib/conditions'
import type { Card } from '../types'

const SIDES: PhotoSide[] = ['front', 'back']

export function ShopPhotoManager({ slug, userId, card, cond, photoUrl, onClose }: {
  slug: string
  userId: string
  card: Card
  cond: string
  /** The current picture's address for a side, if there is one. */
  photoUrl: (side: PhotoSide) => string | undefined
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [camera, setCamera] = useState<PhotoSide | null>(null)
  const [busy, setBusy] = useState<PhotoSide | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = () => qc.invalidateQueries({ queryKey: ['shop', slug] })
  const explain = (e: unknown, fallback: string) => {
    const body = (e as { response?: { data?: unknown } }).response?.data
    return typeof body === 'string' && body ? body : fallback
  }

  const save = async (side: PhotoSide, jpeg: Blob) => {
    setCamera(null); setBusy(side); setMsg('')
    try { await uploadShopPhoto(userId, card.id, cond, side, jpeg); await refresh() }
    catch (e) { setMsg(explain(e, 'Could not save that photo. Please try again.')) }
    finally { setBusy(null) }
  }

  const remove = async (side: PhotoSide) => {
    setBusy(side); setMsg('')
    try { await deleteShopPhoto(userId, card.id, cond, side); await refresh() }
    catch (e) { setMsg(explain(e, 'Could not remove that photo.')) }
    finally { setBusy(null) }
  }

  return (
    <>
      <div className="shop-modal" role="dialog" aria-modal="true" aria-label={`Photos of ${card.name}`}>
        <div className="shop-sheet">
          <h2>Photos: {card.name} <small>({condLabel(cond)})</small></h2>
          <p className="shop-sub">Take a photo of the card you actually have, front and back. Buyers see them in a frame on this card and can zoom in to check the edges and corners.</p>
          <div className="photo-slots">
            {SIDES.map(side => {
              const url = photoUrl(side)
              return (
                <div className="photo-slot" key={side}>
                  <div className="photo-frame photo-frame-lg">
                    {url ? <img src={url} alt={`${side} of your ${card.name}`} /> : <span className="photo-empty">No {side} photo yet</span>}
                  </div>
                  <b>{side === 'front' ? 'Front' : 'Back'}</b>
                  <button type="button" className="shop-btn" disabled={busy !== null} onClick={() => setCamera(side)}>
                    {busy === side ? 'Saving…' : url ? '📷 Retake' : '📷 Take photo'}
                  </button>
                  {url && <button type="button" className="shop-btn shop-btn-ghost" disabled={busy !== null} onClick={() => remove(side)}>Remove</button>}
                </div>
              )
            })}
          </div>
          {msg && <p className="shop-error" role="alert">{msg}</p>}
          <div className="shop-sheet-btns">
            <button type="button" className="shop-btn shop-btn-ghost" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
      {camera && <CardCamera side={camera} onCapture={jpeg => save(camera, jpeg)} onClose={() => setCamera(null)} />}
    </>
  )
}
