/**
 * File: ImportPanel.tsx
 * Purpose:
 *   Lets the user upload a CSV/XLSX collection file and see the results.
 *
 * Why this file exists:
 *   Large collections enter the app through spreadsheets, not one-by-one
 *   adds. The panel must make partial failures visible row by row so a bad
 *   file never silently half-imports.
 */

import { useRef, useState } from "react";
import { apiUpload } from "../../lib/api.js";

interface ImportSummary {
  importJobId: string;
  rowsTotal: number;
  rowsImported: number;
  rowsFailed: number;
  errors: { rowNumber: number; message: string }[];
}

/**
 * Renders the import upload control and result summary.
 */
export function ImportPanel() {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Uploads the chosen file and shows the import outcome.
   */
  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];

    if (!file) {
      setErrorMessage("Choose a CSV or XLSX file first.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setSummary(null);

    try {
      setSummary(await apiUpload<ImportSummary>("/api/v1/imports/collection", file));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
      // Clearing the input lets the user re-upload the same corrected file;
      // browsers suppress the change event for an identical selection.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section className="panel">
      <h2>Import Collection</h2>
      <p>
        Upload a CSV or XLSX file with columns: <code>card_id</code>, <code>condition</code>, <code>quantity</code>,
        and optionally <code>variant_key</code>, <code>storage_location</code>, <code>notes</code>.
        Quantities merge only within the same condition.
      </p>
      <input ref={fileInputRef} type="file" accept=".csv,.xlsx" disabled={busy} />
      <button onClick={handleUpload} disabled={busy}>
        {busy ? "Importing…" : "Upload and Import"}
      </button>
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {summary ? (
        <div>
          <p>
            Imported {summary.rowsImported} of {summary.rowsTotal} rows
            {summary.rowsFailed > 0 ? ` — ${summary.rowsFailed} failed` : ""}.
          </p>
          {summary.errors.length > 0 ? (
            <ul>
              {summary.errors.map((error) => (
                <li key={`${error.rowNumber}-${error.message}`}>
                  Row {error.rowNumber}: {error.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
