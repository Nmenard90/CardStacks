/**
 * File: BulkAddPanel.tsx
 * Purpose:
 *   Rebuilds the V2 keyboard-efficient bulk-add workflow: choose a set,
 *   rapidly enter collector numbers, resolve ambiguous cross-set matches,
 *   review/edit staged rows, and save the whole batch with per-row results
 *   (FR-BULK-001 through FR-BULK-007).
 *
 * Why this file exists:
 *   High-volume collectors enter dozens of cards per sitting. Every number
 *   entry that required a full page round trip in V1 was a source of lost
 *   momentum; staging locally (and persisting to localStorage) keeps entry
 *   fast and safe against a dropped connection.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CARD_CONDITIONS, COLLECTION_QUANTITY_MAX, COLLECTION_QUANTITY_MIN, groupCandidatesBySet, type BulkAddRowInput, type CardCondition } from "@tcg/shared";
import { StatePanel } from "../../components/ui/StatePanel.js";
import { lookupCardsByNumber, loadCardVariants, saveStagedRows as saveStagedRowsRequest, type SearchResultCard } from "./bulkAddApi.js";
import { loadStagedRows, makeStagedRowKey, persistStagedRows, type StagedRow } from "./stagedRows.js";

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "choosing"; groups: { setId: string; candidates: SearchResultCard[] }[] };

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "done"; savedCount: number; failedCount: number };

/**
 * Renders the set-scoped number entry field, staged-row table, and save
 * controls for bulk add.
 */
export function BulkAddPanel() {
  const [setId, setSetId] = useState("");
  const [numberInput, setNumberInput] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>({ status: "idle" });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [stagedRows, setStagedRows] = useState<StagedRow[]>(() => loadStagedRows());
  const numberInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    persistStagedRows(stagedRows);
  }, [stagedRows]);

  async function stageCard(card: SearchResultCard) {
    try {
      const variants = await loadCardVariants(card.id);

      if (variants.length === 0) {
        setLookupState({ status: "error", message: `${card.name} has no variants yet. Run catalog sync again.` });
        return;
      }

      const row: StagedRow = {
        key: makeStagedRowKey(),
        cardId: card.id,
        cardName: card.name,
        setId: card.set.id,
        setName: card.set.name,
        number: card.number,
        variantOptions: variants,
        variantId: variants[0].id,
        condition: "NEAR_MINT",
        quantity: 1,
        storageLocation: "",
        notes: ""
      };

      setStagedRows((rows) => [...rows, row]);
      setLookupState({ status: "idle" });
      setNumberInput("");
      numberInputRef.current?.focus();
    } catch (error) {
      setLookupState({ status: "error", message: error instanceof Error ? error.message : "Could not load this card's variants." });
    }
  }

  async function handleNumberSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedNumber = numberInput.trim();

    if (!trimmedNumber) {
      return;
    }

    setLookupState({ status: "loading" });

    try {
      const { ambiguous, matches } = await lookupCardsByNumber(trimmedNumber, setId.trim() || undefined);

      if (matches.length === 0) {
        setLookupState({
          status: "error",
          message: `No card found for number "${trimmedNumber}"${setId.trim() ? ` in set "${setId.trim()}"` : ""}.`
        });
        return;
      }

      if (ambiguous || matches.length > 1) {
        setLookupState({ status: "choosing", groups: groupCandidatesBySet(matches) });
        return;
      }

      await stageCard(matches[0]);
    } catch (error) {
      setLookupState({ status: "error", message: error instanceof Error ? error.message : "Lookup failed." });
    }
  }

  function updateRow(key: string, patch: Partial<StagedRow>) {
    setStagedRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setStagedRows((rows) => rows.filter((row) => row.key !== key));
  }

  async function handleSaveAll() {
    if (stagedRows.length === 0) {
      return;
    }

    setSaveState({ status: "saving" });

    const rows: BulkAddRowInput[] = stagedRows.map((row) => ({
      cardId: row.cardId,
      variantId: row.variantId,
      condition: row.condition,
      quantity: row.quantity,
      storageLocation: row.storageLocation.trim() || undefined,
      notes: row.notes.trim() || undefined
    }));

    try {
      const result = await saveStagedRowsRequest(rows);

      const remaining: StagedRow[] = [];
      result.results.forEach((rowResult, index) => {
        const staged = stagedRows[index];
        if (!rowResult.ok) {
          remaining.push({ ...staged, lastError: rowResult.error?.message ?? "This row could not be saved." });
        }
      });

      // Failed rows stay staged (with their error attached) so the user can
      // fix and retry them instead of re-entering every card (FR-BULK-004).
      setStagedRows(remaining);
      setSaveState({ status: "done", savedCount: result.savedCount, failedCount: result.failedCount });
    } catch (error) {
      // The whole request failed (e.g. network drop) — every staged row is
      // left untouched so nothing entered so far is lost.
      setSaveState({ status: "error", message: error instanceof Error ? error.message : "Save failed. Your staged rows are still here — try again." });
    }
  }

  return (
    <section className="panel">
      <h2>Bulk Add</h2>
      <form className="row" onSubmit={handleNumberSubmit}>
        <input aria-label="Set id" placeholder="Set id (optional)" value={setId} onChange={(event) => setSetId(event.target.value)} />
        <input
          aria-label="Collector number"
          placeholder="Collector number, then Enter"
          value={numberInput}
          ref={numberInputRef}
          onChange={(event) => setNumberInput(event.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      {lookupState.status === "loading" ? <StatePanel kind="loading" title="Looking up card" message="Searching the catalog." /> : null}
      {lookupState.status === "error" ? <StatePanel kind="error" title="Lookup failed" message={lookupState.message} /> : null}
      {lookupState.status === "choosing" ? (
        <div>
          <StatePanel kind="empty" title="Multiple cards share this number" message="Choose the card you meant." />
          {lookupState.groups.map((group) => (
            <div key={group.setId}>
              <h3>{group.candidates[0]?.set.name ?? group.setId}</h3>
              <ul>
                {group.candidates.map((candidate) => (
                  <li key={candidate.id}>
                    {candidate.name} #{candidate.number}{" "}
                    <button type="button" onClick={() => stageCard(candidate)}>
                      Select
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <StagedRowTable rows={stagedRows} onUpdateRow={updateRow} onRemoveRow={removeRow} />

      {saveState.status === "error" ? <StatePanel kind="error" title="Save failed" message={saveState.message} /> : null}
      {saveState.status === "done" ? (
        <p role="status">
          Saved {saveState.savedCount} card{saveState.savedCount === 1 ? "" : "s"}.
          {saveState.failedCount > 0 ? ` ${saveState.failedCount} row${saveState.failedCount === 1 ? "" : "s"} failed and are still staged below.` : ""}
        </p>
      ) : null}

      <button type="button" onClick={handleSaveAll} disabled={stagedRows.length === 0 || saveState.status === "saving"}>
        {saveState.status === "saving" ? "Saving..." : `Save ${stagedRows.length} staged row${stagedRows.length === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}

interface StagedRowTableProps {
  rows: StagedRow[];
  onUpdateRow: (key: string, patch: Partial<StagedRow>) => void;
  onRemoveRow: (key: string) => void;
}

function StagedRowTable({ rows, onUpdateRow, onRemoveRow }: StagedRowTableProps) {
  if (rows.length === 0) {
    return <StatePanel kind="empty" title="No staged rows yet" message="Enter a collector number above to stage a card." />;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Card</th>
          <th>Set</th>
          <th>Number</th>
          <th>Variant</th>
          <th>Condition</th>
          <th>Quantity</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.cardName}</td>
            <td>{row.setName}</td>
            <td>{row.number}</td>
            <td>
              <select
                aria-label={`Variant for ${row.cardName}`}
                value={row.variantId}
                onChange={(event) => onUpdateRow(row.key, { variantId: event.target.value })}
              >
                {row.variantOptions.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.displayName}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <select
                aria-label={`Condition for ${row.cardName}`}
                value={row.condition}
                onChange={(event) => onUpdateRow(row.key, { condition: event.target.value as CardCondition })}
              >
                {CARD_CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <input
                aria-label={`Quantity for ${row.cardName}`}
                type="number"
                min={COLLECTION_QUANTITY_MIN}
                max={COLLECTION_QUANTITY_MAX}
                value={row.quantity}
                onChange={(event) => onUpdateRow(row.key, { quantity: Number(event.target.value) })}
              />
            </td>
            <td>
              <button type="button" aria-label={`Remove staged row for ${row.cardName}`} onClick={() => onRemoveRow(row.key)}>
                Remove
              </button>
              {row.lastError ? <p role="alert">{row.lastError}</p> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
