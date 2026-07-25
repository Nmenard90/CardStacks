/**
 * File: CollectionPanel.tsx
 * Purpose:
 *   Shows the logged-in user's paginated, filterable, sortable owned-card
 *   collection with inline quantity increment/decrement, condition
 *   correction, and safe (confirm-first) removal (FR-COL-001/002/005/006).
 *
 * Why this file exists:
 *   Collectors need to see and adjust what they own without leaving the
 *   page for every quantity or condition change.
 */

import { useEffect, useState, type FormEvent } from "react";
import { CARD_CONDITIONS, COLLECTION_SORT_FIELDS, type CardCondition, type CollectionSortDirection, type CollectionSortField, type PageInfo } from "@tcg/shared";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { PageControls } from "../catalog/SetBrowser.js";
import { AddCardPanel } from "./AddCardPanel.js";
import {
  adjustCollectionQuantity,
  listOwnedCollection,
  removeCollectionItem,
  updateCollectionItem,
  type OwnedCollectionItem
} from "./collectionApi.js";

const ITEMS_PER_PAGE = 24;

interface FilterDraft {
  setId: string;
  q: string;
  number: string;
  condition: CardCondition | "";
  variantKey: string;
  storageLocation: string;
}

const EMPTY_FILTERS: FilterDraft = { setId: "", q: "", number: "", condition: "", variantKey: "", storageLocation: "" };

type CollectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: OwnedCollectionItem[]; pageInfo: PageInfo };

const SORT_LABELS: Record<CollectionSortField, string> = {
  updatedAt: "Recently updated",
  name: "Card name",
  number: "Collector number",
  quantity: "Quantity",
  condition: "Condition"
};

/**
 * Renders the owned-collection view: filters, sort, pagination, and each
 * item's inline quantity/condition/removal controls.
 */
export function CollectionPanel() {
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTERS);
  const [sort, setSort] = useState<CollectionSortField>("updatedAt");
  const [direction, setDirection] = useState<CollectionSortDirection>("desc");
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<CollectionState>({ status: "loading" });
  const [itemMessage, setItemMessage] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    listOwnedCollection({
      page,
      limit: ITEMS_PER_PAGE,
      sort,
      direction,
      setId: filters.setId.trim() || undefined,
      q: filters.q.trim() || undefined,
      number: filters.number.trim() || undefined,
      condition: filters.condition || undefined,
      variantKey: filters.variantKey.trim() || undefined,
      storageLocation: filters.storageLocation.trim() || undefined
    })
      .then((result) => {
        if (active) setState({ status: "loaded", items: result.items, pageInfo: result.pageInfo });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : "Could not load your collection." });
      });

    return () => {
      active = false;
    };
  }, [page, sort, direction, filters, reloadToken]);

  function refresh() {
    setReloadToken((value) => value + 1);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  function toggleDirection() {
    setDirection((value) => (value === "asc" ? "desc" : "asc"));
    setPage(1);
  }

  async function changeCondition(itemId: string, condition: CardCondition) {
    setItemMessage(null);
    try {
      await updateCollectionItem(itemId, { condition });
      refresh();
    } catch (error) {
      setItemMessage(error instanceof Error ? error.message : "Could not update condition.");
    }
  }

  async function adjustQuantity(itemId: string, delta: number) {
    setItemMessage(null);
    try {
      const result = await adjustCollectionQuantity(itemId, delta);
      if ("deleted" in result) {
        setItemMessage("Removed item (quantity reached zero).");
      }
      refresh();
    } catch (error) {
      setItemMessage(error instanceof Error ? error.message : "Could not update quantity.");
    }
  }

  function requestRemove(itemId: string) {
    setConfirmingRemoveId(itemId);
  }

  function cancelRemove() {
    setConfirmingRemoveId(null);
  }

  async function confirmRemove(itemId: string) {
    setItemMessage(null);
    try {
      await removeCollectionItem(itemId);
      setConfirmingRemoveId(null);
      setItemMessage("Removed item.");
      refresh();
    } catch (error) {
      setItemMessage(error instanceof Error ? error.message : "Could not remove this item.");
    }
  }

  return (
    <section className="panel">
      <h2>Collection Filters</h2>
      <form className="row" onSubmit={applyFilters}>
        <input aria-label="Filter by set id" placeholder="Set id" value={draft.setId} onChange={(event) => setDraft({ ...draft, setId: event.target.value })} />
        <input aria-label="Filter by card name" placeholder="Name" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} />
        <input aria-label="Filter by collector number" placeholder="Number" value={draft.number} onChange={(event) => setDraft({ ...draft, number: event.target.value })} />
        <select
          aria-label="Filter by condition"
          value={draft.condition}
          onChange={(event) => setDraft({ ...draft, condition: event.target.value as CardCondition | "" })}
        >
          <option value="">Any condition</option>
          {CARD_CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {condition.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input aria-label="Filter by variant key" placeholder="Variant" value={draft.variantKey} onChange={(event) => setDraft({ ...draft, variantKey: event.target.value })} />
        <input aria-label="Filter by storage location" placeholder="Storage location" value={draft.storageLocation} onChange={(event) => setDraft({ ...draft, storageLocation: event.target.value })} />
        <select aria-label="Sort by" value={sort} onChange={(event) => { setSort(event.target.value as CollectionSortField); setPage(1); }}>
          {COLLECTION_SORT_FIELDS.map((field) => (
            <option key={field} value={field}>
              {SORT_LABELS[field]}
            </option>
          ))}
        </select>
        <button type="button" onClick={toggleDirection}>
          {direction === "asc" ? "Ascending" : "Descending"}
        </button>
        <button type="submit">Apply filters</button>
        <button type="button" onClick={clearFilters}>
          Clear
        </button>
      </form>

      <AddCardPanel onAdded={refresh} />

      {itemMessage ? <p role="status">{itemMessage}</p> : null}

      <CollectionResults
        state={state}
        confirmingRemoveId={confirmingRemoveId}
        onChangeCondition={changeCondition}
        onAdjustQuantity={adjustQuantity}
        onRequestRemove={requestRemove}
        onCancelRemove={cancelRemove}
        onConfirmRemove={confirmRemove}
        onPageChange={setPage}
      />
    </section>
  );
}

interface CollectionResultsProps {
  state: CollectionState;
  confirmingRemoveId: string | null;
  onChangeCondition: (itemId: string, condition: CardCondition) => void;
  onAdjustQuantity: (itemId: string, delta: number) => void;
  onRequestRemove: (itemId: string) => void;
  onCancelRemove: () => void;
  onConfirmRemove: (itemId: string) => void;
  onPageChange: (page: number) => void;
}

function CollectionResults({
  state,
  confirmingRemoveId,
  onChangeCondition,
  onAdjustQuantity,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  onPageChange
}: CollectionResultsProps) {
  if (state.status === "loading") {
    return <StatePanel kind="loading" title="Loading your collection" message="Fetching the cards you own." />;
  }

  if (state.status === "error") {
    return <StatePanel kind="error" title="Could not load your collection" message={state.message} />;
  }

  if (state.items.length === 0) {
    return <StatePanel kind="empty" title="No cards match these filters" message="Try clearing a filter, or add your first card above." />;
  }

  return (
    <>
      <div className="grid">
        {state.items.map((item) => (
          <Card
            key={item.id}
            title={item.card.name}
            subtitle={`${item.card.set.name} #${item.card.number}`}
            imageUrl={item.card.imageSmall}
            imageAlt={item.card.name}
          >
            <p>{item.variant.displayName}</p>
            <label>
              Condition
              <select
                aria-label={`Condition for ${item.card.name}`}
                value={item.condition}
                onChange={(event) => onChangeCondition(item.id, event.target.value as CardCondition)}
              >
                {CARD_CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <p className="row">
              <button type="button" aria-label={`Decrease quantity for ${item.card.name}`} onClick={() => onAdjustQuantity(item.id, -1)}>
                −
              </button>
              <span>Qty {item.quantity}</span>
              <button type="button" aria-label={`Increase quantity for ${item.card.name}`} onClick={() => onAdjustQuantity(item.id, 1)}>
                +
              </button>
            </p>
            <p>Storage: {item.storageLocation ?? "default"}</p>
            {item.notes ? <p>Notes: {item.notes}</p> : null}
            {confirmingRemoveId === item.id ? (
              <p className="row">
                <span>Remove this item?</span>
                <button type="button" onClick={() => onConfirmRemove(item.id)}>
                  Confirm remove
                </button>
                <button type="button" onClick={onCancelRemove}>
                  Cancel
                </button>
              </p>
            ) : (
              <button type="button" onClick={() => onRequestRemove(item.id)}>
                Remove
              </button>
            )}
          </Card>
        ))}
      </div>
      <PageControls pageInfo={state.pageInfo} onPageChange={onPageChange} />
    </>
  );
}
