/**
 * File: SetCardBrowser.tsx
 * Purpose:
 *   Renders one set's header plus a bounded, paginated grid of its cards.
 *
 * Why this file exists:
 *   A set can hold hundreds of cards. This view must page through them
 *   instead of requesting or rendering the whole set at once (FR-CAT-002).
 */

import { useEffect, useState, type CSSProperties } from "react";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { getSet, listCardsInSet, type CatalogCard, type CatalogSet } from "./catalogApi.js";
import { PageControls } from "./SetBrowser.js";
import type { PageInfo } from "@tcg/shared";

const CARDS_PER_PAGE = 24;

const unstyledButton: CSSProperties = {
  all: "unset",
  display: "block",
  cursor: "pointer",
  width: "100%"
};

type SetCardBrowserState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; set: CatalogSet; items: CatalogCard[]; pageInfo: PageInfo };

interface SetCardBrowserProps {
  setId: string;
  onSelectCard: (cardId: string) => void;
}

export function SetCardBrowser({ setId, onSelectCard }: SetCardBrowserProps) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SetCardBrowserState>({ status: "loading" });

  useEffect(() => {
    setPage(1);
  }, [setId]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    Promise.all([getSet(setId), listCardsInSet(setId, page, CARDS_PER_PAGE)])
      .then(([set, cardsPage]) => {
        if (active) setState({ status: "loaded", set, items: cardsPage.items, pageInfo: cardsPage.pageInfo });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load this set."
          });
        }
      });

    return () => {
      active = false;
    };
  }, [setId, page, attempt]);

  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading set" message="Fetching this set's cards." />;
  }

  if (state.status === "error") {
    return (
      <StatePanel
        kind="error"
        title="Could not load this set"
        message={state.message}
        action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
      />
    );
  }

  return (
    <section className="panel">
      <h2>
        {state.set.name} <small>({state.set.series})</small>
      </h2>
      {state.items.length === 0 ? (
        <StatePanel kind="empty" title="No cards found" message="This set does not have any cards yet." />
      ) : (
        <>
          <div className="grid">
            {state.items.map((card) => (
              <button key={card.id} type="button" style={unstyledButton} onClick={() => onSelectCard(card.id)}>
                <Card
                  title={card.name}
                  subtitle={card.rarity ? `#${card.number} · ${card.rarity}` : `#${card.number}`}
                  imageUrl={card.imageSmall}
                  imageAlt={card.name}
                />
              </button>
            ))}
          </div>
          <PageControls pageInfo={state.pageInfo} onPageChange={setPage} />
        </>
      )}
    </section>
  );
}
