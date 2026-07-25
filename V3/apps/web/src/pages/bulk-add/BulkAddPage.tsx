/**
 * File: BulkAddPage.tsx
 * Purpose:
 *   Top-level page for the keyboard-efficient bulk-add workflow: rapid
 *   collector-number entry, staged-row review, and batch save.
 */

import { BulkAddPanel } from "../../features/bulk-add/BulkAddPanel.js";

export function BulkAddPage() {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Bulk Add</p>
        <h1>Add many cards quickly</h1>
        <p>Enter collector numbers one after another, review the staged rows, then save the whole batch.</p>
      </section>
      <BulkAddPanel />
    </>
  );
}
