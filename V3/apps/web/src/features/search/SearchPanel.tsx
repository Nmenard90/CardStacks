/**
 * File: SearchPanel.tsx
 * Purpose:
 *   Lets signed-in users search cards by name, set, and/or collector number,
 *   and add a card to their collection straight from the results.
 *
 * Why this file exists:
 *   The landing page combines the multi-field catalog search (FR-CAT-003/004,
 *   same contract as CatalogSearch/searchApi) with the quick-add workflow, so
 *   collectors do not need to leave "/" to find and add a card. It must not
 *   collapse every field into a single name query: set ids, set names, and
 *   collector numbers are distinct filters on `/api/v1/search/cards`.
 */

import { useState, type FormEvent } from "react";
import {
  groupCandidatesBySet,
  hasMeaningfulSearchFilter,
  SEARCH_NAME_MAX_LENGTH,
  SEARCH_NUMBER_MAX_LENGTH,
  SEARCH_SET_ID_MAX_LENGTH,
  SEARCH_SET_NAME_MAX_LENGTH,
  type PageInfo
} from "@tcg/shared";
import { apiGet, apiSend } from "../../lib/api.js";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { PageControls } from "../catalog/SetBrowser.js";
import { searchCards, type SearchResultCard } from "./searchApi.js";

const RESULTS_PER_PAGE = 20;

interface CardDetail extends SearchResultCard {
  variants: Array<{ id: string; displayName: string }>;
}

type SearchState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: SearchResultCard[]; pageInfo: PageInfo; ambiguous: boolean };

/**
 * Renders card search and quick-add controls.
 */
export function SearchPanel() {
  const [name, setName] = useState("");
  const [setId, setSetId] = useState("");
  const [setNameFilter, setSetNameFilter] = useState("");
  const [number, setNumber] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [quickAddMessage, setQuickAddMessage] = useState<string | null>(null);

  function runSearch(requestedPage: number) {
    const filters = { q: name.trim(), setId: setId.trim(), setName: setNameFilter.trim(), number: number.trim() };

    if (!hasMeaningfulSearchFilter(filters)) {
      setState({
        status: "invalid",
        message: "Enter a card name, set id, set name, or collector number to search."
      });
      return;
    }

    setState({ status: "loading" });

    searchCards({ ...filters, page: requestedPage, limit: RESULTS_PER_PAGE })
      .then((result) => {
        setState({ status: "loaded", items: result.items, pageInfo: result.pageInfo, ambiguous: result.ambiguous });
      })
      .catch((error: unknown) => {
        setState({ status: "error", message: error instanceof Error ? error.message : "Search failed." });
      });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setQuickAddMessage(null);
    runSearch(1);
  }

  /**
   * Adds the first available variant of a card as a near-mint copy.
   */
  async function quickAdd(cardId: string) {
    try {
      const detail = await apiGet<CardDetail>(`/api/v1/cards/${cardId}`);
      const variant = detail.variants[0];

      if (!variant) {
        setQuickAddMessage("This card has no variants yet. Run catalog sync again.");
        return;
      }

      await apiSend("/api/v1/collection/quick-add", "POST", {
        cardId,
        variantId: variant.id,
        condition: "NEAR_MINT",
        quantity: 1
      });

      setQuickAddMessage(`Added ${detail.name}.`);
    } catch (error) {
      setQuickAddMessage(error instanceof Error ? error.message : "Could not add this card.");
    }
  }

  return (
    <section className="panel">
      <h2>Search Cards</h2>
      <form className="row" onSubmit={handleSubmit}>
        <input
          aria-label="Card name"
          placeholder="Name (e.g. Charizard)"
          value={name}
          maxLength={SEARCH_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="Set id"
          placeholder="Set id (e.g. sv1)"
          value={setId}
          maxLength={SEARCH_SET_ID_MAX_LENGTH}
          onChange={(event) => setSetId(event.target.value)}
        />
        <input
          aria-label="Set name"
          placeholder="Set name (e.g. Scarlet & Violet)"
          value={setNameFilter}
          maxLength={SEARCH_SET_NAME_MAX_LENGTH}
          onChange={(event) => setSetNameFilter(event.target.value)}
        />
        <input
          aria-label="Collector number"
          placeholder="Number (e.g. 080 or TG10)"
          value={number}
          maxLength={SEARCH_NUMBER_MAX_LENGTH}
          onChange={(event) => setNumber(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      {quickAddMessage ? <p role="status">{quickAddMessage}</p> : null}
      {state.status === "idle" ? null : <SearchResults state={state} onQuickAdd={quickAdd} onPageChange={runSearch} />}
    </section>
  );
}

interface SearchResultsProps {
  state: Exclude<SearchState, { status: "idle" }>;
  onQuickAdd: (cardId: string) => void;
  onPageChange: (page: number) => void;
}

function SearchResults({ state, onQuickAdd, onPageChange }: SearchResultsProps) {
  if (state.status === "invalid") {
    return <StatePanel kind="empty" title="Add a search filter" message={state.message} />;
  }

  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Searching" message="Looking through the catalog." />;
  }

  if (state.status === "error") {
    return <StatePanel kind="error" title="Search failed" message={state.message} />;
  }

  if (state.items.length === 0) {
    return <StatePanel kind="empty" title="No cards found" message="Try a different name, set, or collector number." />;
  }

  if (state.ambiguous) {
    const groups = groupCandidatesBySet(state.items);
    return (
      <div>
        <StatePanel
          kind="empty"
          title="Multiple sets share this number"
          message="This collector number exists in more than one set. Choose the card you meant."
        />
        {groups.map((group) => (
          <div key={group.setId}>
            <h3>{group.candidates[0]?.set.name ?? group.setId}</h3>
            <ResultGrid items={group.candidates} onQuickAdd={onQuickAdd} />
          </div>
        ))}
        <PageControls pageInfo={state.pageInfo} onPageChange={onPageChange} />
      </div>
    );
  }

  return (
    <>
      <ResultGrid items={state.items} onQuickAdd={onQuickAdd} />
      <PageControls pageInfo={state.pageInfo} onPageChange={onPageChange} />
    </>
  );
}

function ResultGrid({ items, onQuickAdd }: { items: SearchResultCard[]; onQuickAdd: (cardId: string) => void }) {
  return (
    <div className="grid">
      {items.map((card) => (
        <Card key={card.id} title={card.name} subtitle={`${card.set.name} #${card.number}`} imageUrl={card.imageSmall} imageAlt={card.name}>
          <button type="button" onClick={() => onQuickAdd(card.id)}>
            Quick Add
          </button>
        </Card>
      ))}
    </div>
  );
}
