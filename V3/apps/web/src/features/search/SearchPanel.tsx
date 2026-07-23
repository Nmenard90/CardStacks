/**
 * File: SearchPanel.tsx
 * Purpose:
 *   Lets users search cards and add them to their collection.
 *
 * Why this file exists:
 *   Fast search plus quick add is the main collector workflow.
 */

import { useState } from "react";
import { apiGet, apiSend } from "../../lib/api.js";

interface SearchCard {
  id: string;
  name: string;
  number: string;
  imageSmall?: string;
  set: { id: string; name: string };
}

interface CardDetail extends SearchCard {
  variants: Array<{ id: string; displayName: string }>;
}

/**
 * Renders card search and quick-add controls.
 */
export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<SearchCard[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Searches cards using the backend API.
   *
   * The search endpoint returns a bounded, paginated `{ items, pageInfo,
   * ambiguous }` result (CAT-303/CAT-304), not a bare array.
   */
  async function searchCards() {
    setMessage(null);

    if (!query.trim()) {
      setCards([]);
      setMessage("Enter a card name, set id, or collector number to search.");
      return;
    }

    const params = new URLSearchParams({ q: query, limit: "20" });

    try {
      const result = await apiGet<{ items: SearchCard[] }>(`/api/v1/search/cards?${params}`);
      setCards(result.items);
    } catch (error) {
      setCards([]);
      setMessage(error instanceof Error ? error.message : "Search failed.");
    }
  }

  /**
   * Adds the first available variant of a card as a near-mint copy.
   */
  async function quickAdd(cardId: string) {
    try {
      const detail = await apiGet<CardDetail>(`/api/v1/cards/${cardId}`);
      const variant = detail.variants[0];

      if (!variant) {
        setMessage("This card has no variants yet. Run catalog sync again.");
        return;
      }

      await apiSend("/api/v1/collection/quick-add", "POST", {
        cardId,
        variantId: variant.id,
        condition: "NEAR_MINT",
        quantity: 1
      });

      setMessage(`Added ${detail.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add this card.");
    }
  }

  return (
    <section className="panel">
      <h2>Search Cards</h2>
      <div className="row">
        <input placeholder="Charizard, sv1, 080..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <button onClick={searchCards}>Search</button>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="grid">
        {cards.map((card) => (
          <article className="card" key={card.id}>
            {card.imageSmall ? <img alt={card.name} src={card.imageSmall} /> : null}
            <h3>{card.name}</h3>
            <p>{card.set.name} #{card.number}</p>
            <button onClick={() => quickAdd(card.id)}>Quick Add</button>
          </article>
        ))}
      </div>
    </section>
  );
}
