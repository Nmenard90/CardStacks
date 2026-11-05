/**
 * ShopRequestChat — the seller's side of a request's chat in My Shop (the buyer's side is on their request page).
 * Loads the messages (which marks them read, so the unread dot and nav badge clear) and checks for new ones every
 * 10s while the request is on screen, like the trade offer chat. Uses the shared MessageThread, so it looks the same.
 *
 * USED BY: pages/ShopRequestsPage (each request from a signed-in buyer)
 * DEPENDS ON: api/shop (getRequestMessages, postSellerMessage), components/MessageThread, components/Toast
 */

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRequestMessages, postSellerMessage, type ShopRequest } from '../api/shop'
import { MessageThread } from './MessageThread'
import { useToast } from './Toast'

export function ShopRequestChat({ userId, request }: { userId: string; request: ShopRequest }) {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['shop-request-messages', request.id]
  const { data: messages = [], isSuccess } = useQuery({
    queryKey: key, queryFn: () => getRequestMessages(userId, request.id), refetchInterval: 10_000,
  })
  // Opening the chat marked it read: refresh the inbox (its unread dot and the nav badge) once that has landed.
  useEffect(() => {
    if (isSuccess && request.unread) void qc.invalidateQueries({ queryKey: ['shop-requests', userId] })
  }, [isSuccess, request.unread, qc, userId])

  return (
    <MessageThread
      title={`Chat with ${request.buyerName}`}
      empty={`No messages yet. Write to ${request.buyerName} here; they get an email and see it on their request.`}
      otherName={request.buyerName}
      messages={messages.map(m => ({ id: m.id, mine: m.fromSeller, who: request.buyerName, body: m.body, createdAt: m.createdAt }))}
      onSend={async body => {
        try {
          qc.setQueryData(key, await postSellerMessage(userId, request.id, body))
          void qc.invalidateQueries({ queryKey: ['shop-requests', userId] })
          return true
        } catch {
          toast("Couldn't send that. Please try again.")
          return false
        }
      }}
    />
  )
}
