/**
 * File: CollectionPage.tsx
 * Purpose:
 *   Top-level page for viewing and managing the signed-in user's owned-card
 *   collection: quick/explicit add, condition/quantity edits, safe removal,
 *   and filtered/sorted/paginated browsing.
 */

import { CollectionPanel } from "../../features/collection/CollectionPanel.js";

export function CollectionPage() {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Collection</p>
        <h1>Your cards</h1>
        <p>Track the cards and variants you own.</p>
      </section>
      <CollectionPanel />
    </>
  );
}
