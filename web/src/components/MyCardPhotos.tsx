/**
 * MyCardPhotos — the photo screen (front and back, with the camera's alignment guide) for a card in your
 * collection, so you don't need your shop open to photograph your cards. Same photos as your shop's.
 *
 * HOW IT WORKS
 *   Reads which photos you have, then each existing side of this card in this condition as a picture (the
 *   requests carry your sign-in, so the pictures are fetched and shown from memory). Adding or removing one
 *   re-reads them, and your shop page if it is open.
 *
 * USED BY: pages/CollectionPage.tsx (the 📷 Photos button on an owned card)
 * DEPENDS ON: ShopPhotoManager (which opens CardCamera), api/shop
 */
import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShopPhotoManager } from './ShopPhotoManager'
import { getMyPhoto, getMyPhotos, type PhotoSide } from '../api/shop'
import type { Card } from '../types'

export function MyCardPhotos({ userId, card, cond, onClose }: { userId: string; card: Card; cond: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: photos = [] } = useQuery({ queryKey: ['my-photos', userId], queryFn: () => getMyPhotos(userId), enabled: !!userId })
  const mine = photos.filter(p => p.cardId === card.id && p.condition === cond)
  const version = (side: PhotoSide) => mine.find(p => p.side === side)?.version
  const front = usePhoto(userId, card.id, cond, 'front', version('front'))
  const back = usePhoto(userId, card.id, cond, 'back', version('back'))
  return (
    <ShopPhotoManager userId={userId} card={card} cond={cond}
      photoUrl={side => (side === 'front' ? front : back)}
      onChanged={() => Promise.all([qc.invalidateQueries({ queryKey: ['my-photos', userId] }), qc.invalidateQueries({ queryKey: ['shop'] })])}
      onClose={onClose} />
  )
}

/** One side's picture as an address for <img>, while it exists; the version changes when it is replaced. */
function usePhoto(userId: string, cardId: string, cond: string, side: PhotoSide, version: number | undefined) {
  const { data: blob } = useQuery({
    queryKey: ['my-photo', userId, cardId, cond, side, version],
    queryFn: () => getMyPhoto(userId, cardId, cond, side),
    enabled: version !== undefined,
    staleTime: Infinity,
  })
  const url = useMemo(() => (blob && version !== undefined ? URL.createObjectURL(blob) : undefined), [blob, version])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}
