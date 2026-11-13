/**
 * ViewBars.jsx — the small HTML control strips under the 3D binder and card picker.
 *
 * BinderBar: turn pages, jump to "add a card" at the first empty pocket, show or hide the binder's details.
 * ShelfBar: the binder shelf's only panel — which shelf unit, its pages, the unplaced binders, "+ Add binder".
 *   The binders themselves are picked on the 3D shelf, so the bar stays one slim row.
 * AddBinderBar: name and pocket size for a new binder, made where the user tapped (or the first open spot).
 * PickerBar: browse your own cards or search the whole catalog (the rolodex above
 * shows the results) and place the chosen card in the pocket the user clicked, or
 * (ownedOnly) one of your own cards in an empty display slot.
 */
import React, { useEffect, useRef, useState } from 'react';

export function BinderBar({ pages, page, spread, onPage, onAdd, empty, detailsOpen, onDetails }) {
  const first = spread ? page - (page % 2) : page;
  const last = Math.min(pages, first + (spread ? 2 : 1));
  const label = spread && last - first > 1 ? `Pages ${first + 1}–${last}` : `Page ${first + 1}`;
  const step = spread ? 2 : 1;
  return (
    <div className="view-bar" role="group" aria-label="Binder pages">
      <button type="button" onClick={() => onPage(Math.max(0, first - step))} disabled={first <= 0} aria-label="Previous pages">‹</button>
      <span className="view-bar__label">{label} <small>of {pages}</small></span>
      <button type="button" onClick={() => onPage(Math.min(pages - 1, first + step))} disabled={last >= pages} aria-label="Next pages">›</button>
      <button type="button" className="view-bar__add" onClick={onAdd}>+ Add card</button>
      {onDetails && <button type="button" className={detailsOpen ? 'view-bar__toggle active' : 'view-bar__toggle'} aria-pressed={detailsOpen} onClick={onDetails}>Details</button>}
      {empty && <span className="view-bar__hint">Click an empty pocket to fill it</span>}
    </div>
  );
}

export function PickerBar({ label, ownedOnly = false, query, onQuery, resultCount, searching = false, chosen, onPlace, onCancel, busy, error }) {
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  return (
    <div className="view-bar view-bar--picker" role="group" aria-label={`Pick a card for ${label}`}>
      <label className="view-bar__search">
        <span>{label}</span>
        <input ref={input} type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={ownedOnly ? 'Search your cards by name or number…' : 'Search any card by name or number…'} aria-label="Search cards" />
      </label>
      <span className="view-bar__label" aria-live="polite"><small>{searching ? 'Searching…' : `${resultCount} ${resultCount === 1 ? 'card' : 'cards'}`}</small></span>
      <button type="button" className="view-bar__add" disabled={!chosen || busy} onClick={onPlace}>{busy ? 'Saving…' : chosen ? `Place ${chosen.name}` : 'Pick a card'}</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      {error && <span className="view-bar__error" role="alert">{error}</span>}
    </div>
  );
}

/**
 * @param unit       { name, count } of the shelf unit on show, or null when there is none yet
 * @param onStep     (-1 | 1) => void, or null when there is only one unit
 * @param pagers     [{ key, label, hasPrev, hasNext, onPrev, onNext }] when the unit has more shelves or spots than fit
 * @param unplaced   binders with no shelf spot: [{ id, name }]
 * @param onOpen     (id) => void, opens a binder
 * @param onAdd      () => void, starts adding a binder
 */
export function ShelfBar({ unit, canPrev, canNext, onStep, pagers, unplaced, onOpen, onAdd }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="view-bar view-bar--shelf" role="group" aria-label="Binder shelf">
      {unit && onStep && <button type="button" onClick={() => onStep(-1)} disabled={!canPrev} aria-label="Previous shelf unit">‹</button>}
      <span className="view-bar__label">{unit ? unit.name : 'No shelf yet'}{unit && <small> · {unit.count} {unit.count === 1 ? 'binder' : 'binders'}</small>}</span>
      {unit && onStep && <button type="button" onClick={() => onStep(1)} disabled={!canNext} aria-label="Next shelf unit">›</button>}
      {pagers.map((pager) => (
        <span key={pager.key} className="view-bar__pager">
          <button type="button" onClick={pager.onPrev} disabled={!pager.hasPrev} aria-label={`Previous ${pager.key}`}>‹</button>
          <small>{pager.label}</small>
          <button type="button" onClick={pager.onNext} disabled={!pager.hasNext} aria-label={`Next ${pager.key}`}>›</button>
        </span>
      ))}
      {unplaced.length > 0 && (
        <button type="button" className={menu ? 'view-bar__toggle active' : 'view-bar__toggle'} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Unplaced ({unplaced.length})</button>
      )}
      <button type="button" className="view-bar__add" onClick={onAdd}>+ Add binder</button>
      {menu && unplaced.length > 0 && (
        <div className="view-bar__menu" role="menu" aria-label="Binders not on a shelf">
          {unplaced.map((b) => <button key={b.id} type="button" role="menuitem" onClick={() => { setMenu(false); onOpen(b.id); }}>{b.name}</button>)}
        </div>
      )}
    </div>
  );
}

const POCKETS = [{ value: 'Nine', label: '9-pocket' }, { value: 'Four', label: '4-pocket' }, { value: 'Twelve', label: '12-pocket' }];

/**
 * @param where     what the new binder's place is called ("Shelf 2, spot 3"), or null when it will be unplaced
 * @param onCreate  async ({ name, pocketSize }) => void; throws to show an error
 */
export function AddBinderBar({ where, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [pocketSize, setPocketSize] = useState('Nine');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) { setError('A binder needs a name.'); input.current?.focus(); return; }
    setBusy(true); setError(null);
    try { await onCreate({ name: name.trim(), pocketSize }); }
    catch (e) { setBusy(false); setError(e?.response?.data?.message ?? e?.message ?? 'Could not add that binder.'); }
  };
  return (
    <form className="view-bar view-bar--picker view-bar--add-binder" aria-label="Add a binder" onSubmit={submit}>
      <label className="view-bar__search">
        <span>New binder · {where ?? 'not on a shelf'}</span>
        <input ref={input} type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Binder name, e.g. Base Set Master" aria-label="Binder name" />
      </label>
      <select className="view-bar__select" value={pocketSize} onChange={(e) => setPocketSize(e.target.value)} aria-label="Pocket format">
        {POCKETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <button type="submit" className="view-bar__add" disabled={busy}>{busy ? 'Adding…' : where ? 'Put it on the shelf' : 'Add binder'}</button>
      <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      {error && <span className="view-bar__error" role="alert">{error}</span>}
    </form>
  );
}
