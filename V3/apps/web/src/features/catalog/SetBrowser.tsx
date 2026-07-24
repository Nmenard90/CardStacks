/**
 * File: SetBrowser.tsx
 * Purpose:
 *   Renders a bounded, paginated grid of Pokémon sets for browsing.
 *
 * Why this file exists:
 *   The web client must never request or render the complete catalog at
 *   once (FR-CAT-002/CAT-304). This component only ever asks the API for
 *   one bounded page of sets at a time.
 */

import { useEffect, useState, type CSSProperties } from "react";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { listSets, type CatalogSet } from "./catalogApi.js";
import type { PageInfo } from "@tcg/shared";

const SETS_PER_PAGE = 24;

/** Removes default button chrome so a Card can act as a clickable link. */
const unstyledButton: CSSProperties = {
  all: "unset",
  display: "block",
  cursor: "pointer",
  width: "100%"
};

type SetBrowserState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: CatalogSet[]; pageInfo: PageInfo };

interface SetBrowserProps {
  onSelectSet: (setId: string) => void;
}

export function SetBrowser({ onSelectSet }: SetBrowserProps) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SetBrowserState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    listSets(page, SETS_PER_PAGE)
      .then((result) => {
        if (active) setState({ status: "loaded", items: result.items, pageInfo: result.pageInfo });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Could not load sets." });
        }
      });

    return () => {
      active = false;
    };
  }, [page, attempt]);

  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading sets" message="Fetching the Pokémon set list." />;
  }

  if (state.status === "error") {
    return (
      <StatePanel
        kind="error"
        title="Could not load sets"
        message={state.message}
        action={{ label: "Try again", onClick: () => setAttempt((value) => value + 1) }}
      />
    );
  }

  if (state.items.length === 0) {
    return <StatePanel kind="empty" title="No sets found" message="The catalog does not have any sets yet." />;
  }

  return (
    <section className="panel">
      <div className="grid">
        {state.items.map((set) => (
          <button key={set.id} type="button" style={unstyledButton} onClick={() => onSelectSet(set.id)}>
            <Card
              title={set.name}
              subtitle={`${set.series} · ${set.printedTotal}/${set.total} cards`}
              imageUrl={set.logoUrl ?? set.symbolUrl}
              imageAlt={set.name}
            />
          </button>
        ))}
      </div>
      <PageControls pageInfo={state.pageInfo} onPageChange={setPage} />
    </section>
  );
}

interface PageControlsProps {
  pageInfo: PageInfo;
  onPageChange: (page: number) => void;
}

/** Bounded prev/next pagination shared by the set and set-detail browsers. */
export function PageControls({ pageInfo, onPageChange }: PageControlsProps) {
  const totalPages = Math.max(pageInfo.totalPages, 1);

  return (
    <div className="row" aria-label="Pagination">
      <button type="button" disabled={pageInfo.page <= 1} onClick={() => onPageChange(pageInfo.page - 1)}>
        Previous
      </button>
      <span>
        Page {pageInfo.page} of {totalPages} ({pageInfo.total} total)
      </span>
      <button type="button" disabled={pageInfo.page >= totalPages} onClick={() => onPageChange(pageInfo.page + 1)}>
        Next
      </button>
    </div>
  );
}
