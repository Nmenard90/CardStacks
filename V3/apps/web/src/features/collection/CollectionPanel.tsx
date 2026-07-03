/**
 * File: CollectionPanel.tsx
 * Purpose:
 *   Shows the logged-in user's collection inventory.
 *
 * Why this file exists:
 *   Users need a simple way to confirm what they own after quick-adding cards.
 */

import { useState } from "react";
import { apiGet, apiSend } from "../../lib/api.js";

interface CollectionItem {
  id: string;
  condition: string;
  quantity: number;
  card: { name: string; number: string; imageSmall?: string; set: { name: string } };
  variant: { displayName: string };
}

/**
 * Renders collection list and remove controls.
 */
export function CollectionPanel() {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Loads collection items from the backend.
   */
  async function loadCollection() {
    setMessage(null);
    setItems(await apiGet<CollectionItem[]>("/api/v1/collection"));
  }

  /**
   * Removes one collection item.
   */
  async function removeItem(itemId: string) {
    await apiSend(`/api/v1/collection/items/${itemId}`, "DELETE");
    setMessage("Removed item.");
    await loadCollection();
  }

  return (
    <section className="panel">
      <h2>Collection</h2>
      <button onClick={loadCollection}>Refresh Collection</button>
      {message ? <p>{message}</p> : null}
      <div className="grid">
        {items.map((item) => (
          <article className="card" key={item.id}>
            {item.card.imageSmall ? <img alt={item.card.name} src={item.card.imageSmall} /> : null}
            <h3>{item.card.name}</h3>
            <p>{item.card.set.name} #{item.card.number}</p>
            <p>{item.variant.displayName} · {item.condition} · Qty {item.quantity}</p>
            <button onClick={() => removeItem(item.id)}>Remove</button>
          </article>
        ))}
      </div>
    </section>
  );
}
