/**
 * File: CardDetailView.tsx
 * Purpose:
 *   Renders one card's detail: image, identifying fields, and its variants.
 *
 * Why this file exists:
 *   FR-CAT-008 requires card detail to include variants. Collector numbers
 *   are not globally unique, so this view always shows the owning set
 *   alongside the number to keep the card unambiguous.
 */

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { getCardDetail, type CatalogCardDetail } from "./catalogApi.js";

type CardDetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; card: CatalogCardDetail };

interface CardDetailViewProps {
  cardId: string;
  onSelectSet?: (setId: string) => void;
}

export function CardDetailView({ cardId, onSelectSet }: CardDetailViewProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CardDetailState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    getCardDetail(cardId)
      .then((card) => {
        if (active) setState({ status: "loaded", card });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Could not load this card." });
        }
      });

    return () => {
      active = false;
    };
  }, [cardId, attempt]);

  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading card" message="Fetching this card's details." />;
  }

  if (state.status === "error") {
    return (
      <StatePanel
        kind="error"
        title="Could not load this card"
        message={state.message}
        action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
      />
    );
  }

  const { card } = state;

  return (
    <section className="panel">
      <Card
        title={card.name}
        subtitle={card.rarity ? `#${card.number} · ${card.rarity}` : `#${card.number}`}
        imageUrl={card.imageLarge ?? card.imageSmall}
        imageAlt={card.name}
      >
        <p>
          {onSelectSet ? (
            <button type="button" onClick={() => onSelectSet(card.setId)}>
              {card.set.name}
            </button>
          ) : (
            card.set.name
          )}
          {card.artist ? ` · Illustrated by ${card.artist}` : null}
        </p>
        {card.supertype ? <p>{[card.supertype, ...card.subtypes].join(" · ")}</p> : null}
      </Card>

      <h2>Variants</h2>
      {card.variants.length === 0 ? (
        <StatePanel kind="empty" title="No variants recorded" message="This card has no catalog variants yet." />
      ) : (
        <ul>
          {card.variants.map((variant) => (
            <li key={variant.id}>
              {variant.displayName}
              {variant.finish ? ` · ${variant.finish}` : ""} · {variant.language}
              {variant.isMasterSetVariant ? " · Master set variant" : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
