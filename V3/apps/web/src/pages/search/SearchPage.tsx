/**
 * File: SearchPage.tsx
 * Purpose:
 *   Top-level page for searching the catalog by name, set, and/or collector
 *   number.
 */

import { CatalogSearch } from "../../features/search/CatalogSearch.js";

interface SearchPageProps {
  onSelectCard: (cardId: string) => void;
}

export function SearchPage({ onSelectCard }: SearchPageProps) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Search</p>
        <h1>Search the catalog</h1>
        <p>Search by name, set, or collector number. Ambiguous collector numbers show every matching set.</p>
      </section>
      <CatalogSearch onSelectCard={onSelectCard} />
    </>
  );
}
