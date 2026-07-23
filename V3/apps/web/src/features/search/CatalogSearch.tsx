/**
 * File: CatalogSearch.tsx
 * Purpose:
 *   Lets a user search the catalog by name, set, and/or collector number,
 *   and resolves ambiguous cross-set collector-number results.
 *
 * Why this file exists:
 *   FR-CAT-003/004 require at least one meaningful filter; FR-CAT-005/007
 *   require cross-set collector-number ambiguity to be shown, not guessed
 *   at. The search API is the single source of truth for what counts as
 *   ambiguous (see `search.service.ts`); this view only renders that result.
 */

import { useState, type CSSProperties, type FormEvent } from "react";
import {
  groupCandidatesBySet,
  hasMeaningfulSearchFilter,
  SEARCH_NAME_MAX_LENGTH,
  SEARCH_NUMBER_MAX_LENGTH,
  SEARCH_SET_ID_MAX_LENGTH,
  type PageInfo
} from "@tcg/shared";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { searchCards, type SearchResultCard } from "./searchApi.js";

const RESULTS_PER_PAGE = 25;

const unstyledButton: CSSProperties = {
  all: "unset",
  display: "block",
  cursor: "pointer",
  width: "100%"
};

type SearchState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: SearchResultCard[]; pageInfo: PageInfo; ambiguous: boolean };

interface CatalogSearchProps {
  onSelectCard: (cardId: string) => void;
}

export function CatalogSearch({ onSelectCard }: CatalogSearchProps) {
  const [name, setName] = useState("");
  const [setId, setSetId] = useState("");
  const [number, setNumber] = useState("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<SearchState>({ status: "idle" });

  function runSearch(requestedPage: number) {
    const filters = { q: name.trim(), setId: setId.trim(), number: number.trim() };

    if (!hasMeaningfulSearchFilter(filters)) {
      setState({
        status: "invalid",
        message: "Provide a name, set, or collector number to search. Use Browse Sets to list every card without a filter."
      });
      return;
    }

    setPage(requestedPage);
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
    runSearch(1);
  }

  return (
    <section className="panel">
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
          aria-label="Collector number"
          placeholder="Number (e.g. 080 or TG10)"
          value={number}
          maxLength={SEARCH_NUMBER_MAX_LENGTH}
          onChange={(event) => setNumber(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {state.status === "idle" ? null : <SearchResults state={state} onSelectCard={onSelectCard} onPageChange={runSearch} />}
    </section>
  );
}

interface SearchResultsProps {
  state: Exclude<SearchState, { status: "idle" }>;
  onSelectCard: (cardId: string) => void;
  onPageChange: (page: number) => void;
}

function SearchResults({ state, onSelectCard, onPageChange }: SearchResultsProps) {
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
            <ResultGrid items={group.candidates} onSelectCard={onSelectCard} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <ResultGrid items={state.items} onSelectCard={onSelectCard} />
      <div className="row" aria-label="Pagination">
        <button type="button" disabled={state.pageInfo.page <= 1} onClick={() => onPageChange(state.pageInfo.page - 1)}>
          Previous
        </button>
        <span>
          Page {state.pageInfo.page} of {Math.max(state.pageInfo.totalPages, 1)} ({state.pageInfo.total} total)
        </span>
        <button
          type="button"
          disabled={state.pageInfo.page >= state.pageInfo.totalPages}
          onClick={() => onPageChange(state.pageInfo.page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}

function ResultGrid({ items, onSelectCard }: { items: SearchResultCard[]; onSelectCard: (cardId: string) => void }) {
  return (
    <div className="grid">
      {items.map((card) => (
        <button key={card.id} type="button" style={unstyledButton} onClick={() => onSelectCard(card.id)}>
          <Card
            title={card.name}
            subtitle={`${card.set.name} #${card.number}`}
            imageUrl={card.imageSmall}
            imageAlt={card.name}
          />
        </button>
      ))}
    </div>
  );
}
