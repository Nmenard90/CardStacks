/**
 * File: CardDetailPage.tsx
 * Purpose:
 *   Top-level page for one card's detail, reachable from both set browsing
 *   and search.
 */

import { CardDetailView } from "../../features/catalog/CardDetailView.js";

interface CardDetailPageProps {
  cardId: string;
  onSelectSet: (setId: string) => void;
}

export function CardDetailPage({ cardId, onSelectSet }: CardDetailPageProps) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Catalog</p>
        <h1>Card detail</h1>
        <button type="button" className="button" onClick={() => window.history.back()}>
          Back
        </button>
      </section>
      <CardDetailView cardId={cardId} onSelectSet={onSelectSet} />
    </>
  );
}
