/**
 * File: AddCardPanel.tsx
 * Purpose:
 *   Lets a signed-in user search the catalog and add a card to their
 *   collection with full explicit detail: variant, condition, quantity,
 *   storage location, notes, paid price, purchase date, and seller
 *   (FR-COL-004/012). The search page's quick add only ever fills in a
 *   default variant/condition/quantity; this panel is the explicit-entry
 *   counterpart, kept inside the collection feature per the task scope.
 *
 * Why it reuses `features/search/searchApi.ts`:
 *   Card lookup by name/set/number is exactly the catalog search contract
 *   (FR-CAT-003/004) already implemented and tested there. Re-implementing
 *   the query-string/ambiguity logic here would duplicate normalization
 *   logic the coding standards explicitly forbid.
 */

import { useState, type FormEvent } from "react";
import {
  CARD_CONDITIONS,
  COLLECTION_QUANTITY_MAX,
  COLLECTION_QUANTITY_MIN,
  groupCandidatesBySet,
  hasMeaningfulSearchFilter,
  SEARCH_NAME_MAX_LENGTH,
  SEARCH_NUMBER_MAX_LENGTH,
  SEARCH_SET_ID_MAX_LENGTH,
  SEARCH_SET_NAME_MAX_LENGTH,
  type CardCondition,
  type PageInfo
} from "@tcg/shared";
import { apiGet } from "../../lib/api.js";
import { Card } from "../../components/ui/Card.js";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { PageControls } from "../catalog/SetBrowser.js";
import { searchCards, type SearchResultCard } from "../search/searchApi.js";
import { addToCollection } from "./collectionApi.js";

const RESULTS_PER_PAGE = 10;

interface CardVariantOption {
  id: string;
  displayName: string;
}

interface CardDetail extends SearchResultCard {
  variants: CardVariantOption[];
}

type SearchState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: SearchResultCard[]; pageInfo: PageInfo; ambiguous: boolean };

type SelectionState =
  | { status: "none" }
  | { status: "loading"; cardId: string }
  | { status: "error"; cardId: string; message: string }
  | { status: "ready"; card: SearchResultCard; variants: CardVariantOption[] };

interface AddCardPanelProps {
  onAdded: () => void;
}

/**
 * Collapsible "add a card with full detail" panel used by the collection
 * page. Collapsed by default so it never competes with the owned-card list
 * for attention.
 */
export function AddCardPanel({ onAdded }: AddCardPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [setId, setSetId] = useState("");
  const [setNameFilter, setSetNameFilter] = useState("");
  const [number, setNumber] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [selection, setSelection] = useState<SelectionState>({ status: "none" });
  const [formMessage, setFormMessage] = useState<string | null>(null);

  function runSearch(requestedPage: number) {
    const filters = { q: name.trim(), setId: setId.trim(), setName: setNameFilter.trim(), number: number.trim() };

    if (!hasMeaningfulSearchFilter(filters)) {
      setSearchState({ status: "invalid", message: "Enter a card name, set id, set name, or collector number to search." });
      return;
    }

    setSearchState({ status: "loading" });

    searchCards({ ...filters, page: requestedPage, limit: RESULTS_PER_PAGE })
      .then((result) => setSearchState({ status: "loaded", items: result.items, pageInfo: result.pageInfo, ambiguous: result.ambiguous }))
      .catch((error: unknown) => setSearchState({ status: "error", message: error instanceof Error ? error.message : "Search failed." }));
  }

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    setFormMessage(null);
    setSelection({ status: "none" });
    runSearch(1);
  }

  async function selectCard(card: SearchResultCard) {
    setSelection({ status: "loading", cardId: card.id });

    try {
      const detail = await apiGet<CardDetail>(`/api/v1/cards/${card.id}`);

      if (detail.variants.length === 0) {
        setSelection({ status: "error", cardId: card.id, message: "This card has no variants yet. Run catalog sync again." });
        return;
      }

      setSelection({ status: "ready", card, variants: detail.variants });
    } catch (error) {
      setSelection({ status: "error", cardId: card.id, message: error instanceof Error ? error.message : "Could not load card variants." });
    }
  }

  async function handleAddSubmit(event: FormEvent<HTMLFormElement>, card: SearchResultCard) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const storageLocation = String(form.get("storageLocation") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const pricePaidEachRaw = String(form.get("pricePaidEach") ?? "").trim();
    const purchasedAt = String(form.get("purchasedAt") ?? "").trim();
    const seller = String(form.get("seller") ?? "").trim();

    setFormMessage(null);

    try {
      await addToCollection({
        cardId: card.id,
        variantId: String(form.get("variantId") ?? ""),
        condition: String(form.get("condition") ?? "") as CardCondition,
        quantity: Number(form.get("quantity")),
        storageLocation: storageLocation || undefined,
        notes: notes || undefined,
        pricePaidEach: pricePaidEachRaw ? Number(pricePaidEachRaw) : undefined,
        purchasedAt: purchasedAt || undefined,
        seller: seller || undefined
      });

      setFormMessage(`Added ${card.name} to your collection.`);
      setSelection({ status: "none" });
      onAdded();
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "Could not add this card.");
    }
  }

  if (!expanded) {
    return (
      <section className="panel">
        <button type="button" onClick={() => setExpanded(true)}>
          Add a card with full details
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Add a Card</h2>
      <form className="row" onSubmit={handleSearchSubmit}>
        <input aria-label="Card name" placeholder="Name (e.g. Charizard)" value={name} maxLength={SEARCH_NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} />
        <input aria-label="Set id" placeholder="Set id" value={setId} maxLength={SEARCH_SET_ID_MAX_LENGTH} onChange={(event) => setSetId(event.target.value)} />
        <input aria-label="Set name" placeholder="Set name" value={setNameFilter} maxLength={SEARCH_SET_NAME_MAX_LENGTH} onChange={(event) => setSetNameFilter(event.target.value)} />
        <input aria-label="Collector number" placeholder="Number" value={number} maxLength={SEARCH_NUMBER_MAX_LENGTH} onChange={(event) => setNumber(event.target.value)} />
        <button type="submit">Search</button>
        <button type="button" onClick={() => setExpanded(false)}>
          Close
        </button>
      </form>
      {formMessage ? <p role="status">{formMessage}</p> : null}
      {searchState.status === "idle" ? null : (
        <SearchResults state={searchState} selection={selection} onSelect={selectCard} onSubmitAdd={handleAddSubmit} onPageChange={runSearch} />
      )}
    </section>
  );
}

interface SearchResultsProps {
  state: Exclude<SearchState, { status: "idle" }>;
  selection: SelectionState;
  onSelect: (card: SearchResultCard) => void;
  onSubmitAdd: (event: FormEvent<HTMLFormElement>, card: SearchResultCard) => void;
  onPageChange: (page: number) => void;
}

function SearchResults({ state, selection, onSelect, onSubmitAdd, onPageChange }: SearchResultsProps) {
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
        <StatePanel kind="empty" title="Multiple sets share this number" message="This collector number exists in more than one set. Choose the card you meant." />
        {groups.map((group) => (
          <div key={group.setId}>
            <h3>{group.candidates[0]?.set.name ?? group.setId}</h3>
            <ResultGrid items={group.candidates} selection={selection} onSelect={onSelect} onSubmitAdd={onSubmitAdd} />
          </div>
        ))}
        <PageControls pageInfo={state.pageInfo} onPageChange={onPageChange} />
      </div>
    );
  }

  return (
    <>
      <ResultGrid items={state.items} selection={selection} onSelect={onSelect} onSubmitAdd={onSubmitAdd} />
      <PageControls pageInfo={state.pageInfo} onPageChange={onPageChange} />
    </>
  );
}

function ResultGrid({
  items,
  selection,
  onSelect,
  onSubmitAdd
}: {
  items: SearchResultCard[];
  selection: SelectionState;
  onSelect: (card: SearchResultCard) => void;
  onSubmitAdd: (event: FormEvent<HTMLFormElement>, card: SearchResultCard) => void;
}) {
  return (
    <div className="grid">
      {items.map((card) => (
        <Card key={card.id} title={card.name} subtitle={`${card.set.name} #${card.number}`} imageUrl={card.imageSmall} imageAlt={card.name}>
          <button type="button" onClick={() => onSelect(card)}>
            Select
          </button>
          {selection.status !== "none" && (selection.status === "ready" ? selection.card.id : selection.cardId) === card.id ? (
            <SelectionDetail selection={selection} onSubmitAdd={onSubmitAdd} />
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function SelectionDetail({
  selection,
  onSubmitAdd
}: {
  selection: Exclude<SelectionState, { status: "none" }>;
  onSubmitAdd: (event: FormEvent<HTMLFormElement>, card: SearchResultCard) => void;
}) {
  if (selection.status === "loading") {
    return <StatePanel kind="loading" title="Loading variants" message="Fetching this card's variants." />;
  }

  if (selection.status === "error") {
    return <StatePanel kind="error" title="Could not load variants" message={selection.message} />;
  }

  return (
    <form onSubmit={(event) => onSubmitAdd(event, selection.card)}>
      <label>
        Variant
        <select aria-label="Variant" name="variantId" required defaultValue={selection.variants[0]?.id}>
          {selection.variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Condition
        <select aria-label="Condition" name="condition" required defaultValue="NEAR_MINT">
          {CARD_CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {condition.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input aria-label="Quantity" name="quantity" type="number" min={COLLECTION_QUANTITY_MIN} max={COLLECTION_QUANTITY_MAX} defaultValue={1} required />
      </label>
      <label>
        Storage location
        <input aria-label="Storage location" name="storageLocation" type="text" maxLength={120} placeholder="default" />
      </label>
      <label>
        Notes
        <input aria-label="Notes" name="notes" type="text" maxLength={1000} />
      </label>
      <label>
        Paid price (each)
        <input aria-label="Paid price each" name="pricePaidEach" type="number" min={0} step="0.01" />
      </label>
      <label>
        Purchase date
        <input aria-label="Purchase date" name="purchasedAt" type="date" />
      </label>
      <label>
        Seller
        <input aria-label="Seller" name="seller" type="text" maxLength={120} />
      </label>
      <button type="submit">Add to collection</button>
    </form>
  );
}
