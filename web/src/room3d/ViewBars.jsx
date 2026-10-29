/**
 * ViewBars.jsx — the small HTML control strips under the 3D binder and card picker.
 *
 * BinderBar: turn pages and jump to "add a card" at the first empty pocket.
 * PickerBar: browse your own cards or search the whole catalog (the rolodex above
 * shows the results) and place the chosen card in the pocket the user clicked.
 */
import React, { useEffect, useRef } from 'react';

export function BinderBar({ pages, page, spread, onPage, onAdd, empty }) {
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
      {empty && <span className="view-bar__hint">Click an empty pocket to fill it</span>}
    </div>
  );
}

export function PickerBar({ slot, query, onQuery, resultCount, searching = false, chosen, onPlace, onCancel, busy, error }) {
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  return (
    <div className="view-bar view-bar--picker" role="group" aria-label="Pick a card for this pocket">
      <label className="view-bar__search">
        <span>Pocket {slot + 1}</span>
        <input ref={input} type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search any card by name or number…" aria-label="Search cards" />
      </label>
      <span className="view-bar__label" aria-live="polite"><small>{searching ? 'Searching…' : `${resultCount} ${resultCount === 1 ? 'card' : 'cards'}`}</small></span>
      <button type="button" className="view-bar__add" disabled={!chosen || busy} onClick={onPlace}>{busy ? 'Saving…' : chosen ? `Place ${chosen.name}` : 'Pick a card'}</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      {error && <span className="view-bar__error" role="alert">{error}</span>}
    </div>
  );
}
