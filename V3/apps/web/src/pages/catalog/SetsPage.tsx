/**
 * File: SetsPage.tsx
 * Purpose:
 *   Top-level page for browsing all Pokémon sets.
 */

import { SetBrowser } from "../../features/catalog/SetBrowser.js";

interface SetsPageProps {
  onSelectSet: (setId: string) => void;
}

export function SetsPage({ onSelectSet }: SetsPageProps) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Catalog</p>
        <h1>Browse sets</h1>
        <p>Pick a set to see its cards.</p>
      </section>
      <SetBrowser onSelectSet={onSelectSet} />
    </>
  );
}
