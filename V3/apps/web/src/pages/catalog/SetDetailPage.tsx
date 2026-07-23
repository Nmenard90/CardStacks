/**
 * File: SetDetailPage.tsx
 * Purpose:
 *   Top-level page for browsing the cards within one set.
 */

import { SetCardBrowser } from "../../features/catalog/SetCardBrowser.js";

interface SetDetailPageProps {
  setId: string;
  onSelectCard: (cardId: string) => void;
}

export function SetDetailPage({ setId, onSelectCard }: SetDetailPageProps) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Catalog</p>
        <h1>Set cards</h1>
        <button type="button" className="button" onClick={() => window.history.back()}>
          Back to sets
        </button>
      </section>
      <SetCardBrowser setId={setId} onSelectCard={onSelectCard} />
    </>
  );
}
