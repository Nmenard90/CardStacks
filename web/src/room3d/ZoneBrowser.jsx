/**
 * ZoneBrowser.jsx — the visible inventory for a focused zone. It replaces the
 * old "every item in one rail" picker, which cannot scale to hundreds of
 * containers, and it is what guarantees nothing is unreachable:
 *
 *  - choose ANY shelf unit (or display case) and page through its shelves;
 *  - "On this shelf" lists what the 3D view currently shows;
 *  - "All" searches EVERY binder/box in the collection (paged, 24 at a time);
 *  - "Unplaced" lists containers with no shelf position yet.
 * Opening any entry pages its unit/window into view and opens it.
 *
 * Plain DOM list — one button per visible entry, keyboard accessible, no
 * per-object overlays in the 3D scene.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { paginate, searchContainers } from './data/selectors.js';

const PAGE_SIZE = 24;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Pager({ label, from, to, total, onPrev, onNext, hasPrev, hasNext }) {
  return (
    <div className="zone-browser__pager" role="group" aria-label={label}>
      <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label={`Previous ${label.toLowerCase()}`}>‹</button>
      <span>{label} {from}–{to} of {total}</span>
      <button type="button" onClick={onNext} disabled={!hasNext} aria-label={`Next ${label.toLowerCase()}`}>›</button>
    </div>
  );
}

export default function ZoneBrowser({ zone, world, state, nav, onOpen }) {
  const isDisplay = zone === 'display';
  const kind = zone === 'binders' ? 'binder' : 'box';
  const noun = zone === 'binders' ? 'binder' : zone === 'storage' ? 'box' : 'card';
  const nouns = noun === 'box' ? 'boxes' : `${noun}s`;
  const [tab, setTab] = useState('shelf');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { setTab('shelf'); setQuery(''); setPage(0); }, [zone]);
  useEffect(() => { setPage(0); }, [tab, query]);

  const unitNames = useMemo(() => new Map(world.navigator.units.map((u) => [u.id, u.name])), [world.navigator.units]);
  const results = useMemo(() => {
    if (isDisplay || tab === 'shelf') return null;
    return paginate(searchContainers(state, { kind, query, placement: tab === 'unplaced' ? 'unplaced' : undefined }), page, PAGE_SIZE);
  }, [state, isDisplay, tab, kind, query, page]);

  if (isDisplay) {
    const d = world.zones.display;
    const cases = world.navigator.cases;
    const from = d.page * 5 + 1;
    const to = Math.min(d.case?.slotCount ?? 0, (d.page + 1) * 5);
    return (
      <section className="zone-picker zone-browser" aria-label="Display cabinet browser">
        <div className="zone-browser__bar">
          <strong>Display cabinet</strong>
          {cases.length > 0 && (
            <label>Case
              <select value={world.navigator.caseId ?? ''} onChange={(e) => nav.setCase(e.target.value)}>
                {cases.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.filledCount}/{c.slotCount}</option>)}
              </select>
            </label>
          )}
          {d.pageCount > 1 && (
            <Pager label="Slots" from={from} to={to} total={d.case.slotCount} hasPrev={d.page > 0} hasNext={d.page < d.pageCount - 1}
              onPrev={() => nav.setCasePage(d.page - 1)} onNext={() => nav.setCasePage(d.page + 1)} />
          )}
        </div>
        <div className="zone-picker__rail">
          {!d.case && <div className="zone-picker__empty">No display case yet — the cabinet is ready for one.</div>}
          {d.slots.map((slot) => {
            const card = world.displayCards.find((c) => c.displayIndex === slot.displayIndex);
            return card
              ? <button key={slot.slotId} type="button" onClick={() => onOpen('display', slot.slotId)}><span>{String(from + slot.displayIndex).padStart(2, '0')}</span><strong>{card.name}</strong><small>{card.rarity || card.setName}</small></button>
              : <div key={slot.slotId} className="zone-browser__empty-slot"><span>{String(from + slot.displayIndex).padStart(2, '0')}</span>Empty slot</div>;
          })}
        </div>
      </section>
    );
  }

  const z = world.zones[zone === 'binders' ? 'binders' : 'boxes'];
  const plan = z.plan;
  const units = world.navigator.units;
  const unitId = zone === 'binders' ? world.navigator.binderUnitId : world.navigator.boxUnitId;
  const setUnit = zone === 'binders' ? nav.setBinderUnit : nav.setBoxUnit;
  const setWin = zone === 'binders' ? nav.setBinderWin : nav.setBoxWin;
  const countOf = (u) => (zone === 'binders' ? u.binderCount : u.boxCount);
  const total = zone === 'binders' ? world.totals.binders : world.totals.boxes;
  const unplaced = zone === 'binders' ? world.meta.unplaced.binders : world.meta.unplaced.boxes;
  const unitIndex = units.findIndex((u) => u.id === unitId);
  const stepUnit = (delta) => units[unitIndex + delta] && setUnit(units[unitIndex + delta].id);
  const shelfList = z.items
    .map((item) => ({ ...item, unitId }))
    .sort((a, b) => a.shelfIndex - b.shelfIndex || a.position - b.position || (a.level ?? 0) - (b.level ?? 0));
  const meta = (item) => {
    const where = item.unitId ? `${unitNames.get(item.unitId) ?? 'Shelf'} · shelf ${item.shelfIndex + 1}` : 'Unplaced';
    return `${where} · ${plural(item.cardCount, 'card')}`;
  };
  const entries = results ? results.items : shelfList;

  return (
    <section className="zone-picker zone-browser" aria-label={`${zone === 'binders' ? 'Binder library' : 'Bulk storage'} browser`}>
      <div className="zone-browser__bar">
        {units.length > 0 ? (
          <>
            <button type="button" onClick={() => stepUnit(-1)} disabled={unitIndex <= 0} aria-label="Previous shelf unit">‹</button>
            <label>Shelf unit
              <select value={unitId ?? ''} onChange={(e) => setUnit(e.target.value)}>
                {units.map((u, i) => <option key={u.id} value={u.id}>{i + 1}. {u.name} · {plural(countOf(u), noun, nouns)}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => stepUnit(1)} disabled={unitIndex >= units.length - 1} aria-label="Next shelf unit">›</button>
            {plan.shelfPages > 1 && (
              <Pager label="Shelves" from={plan.shelfStart + 1} to={plan.shelfStart + plan.rows} total={plan.shelfCount} hasPrev={plan.shelfPage > 0} hasNext={plan.shelfPage < plan.shelfPages - 1}
                onPrev={() => setWin({ shelfPage: plan.shelfPage - 1 })} onNext={() => setWin({ shelfPage: plan.shelfPage + 1 })} />
            )}
            {plan.positionPages > 1 && (
              <Pager label="Positions" from={plan.positionStart + 1} to={plan.positionStart + plan.cols} total={plan.positionsPerShelf} hasPrev={plan.positionPage > 0} hasNext={plan.positionPage < plan.positionPages - 1}
                onPrev={() => setWin({ positionPage: plan.positionPage - 1 })} onNext={() => setWin({ positionPage: plan.positionPage + 1 })} />
            )}
          </>
        ) : <strong>No shelf units yet — the {zone === 'binders' ? 'library' : 'storage wall'} is ready for one.</strong>}
        <div className="zone-browser__tabs" role="tablist" aria-label={nouns}>
          <button type="button" role="tab" aria-selected={tab === 'shelf'} className={tab === 'shelf' ? 'active' : ''} onClick={() => setTab('shelf')}>On this shelf ({z.items.length})</button>
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>All {nouns} ({total})</button>
          <button type="button" role="tab" aria-selected={tab === 'unplaced'} className={tab === 'unplaced' ? 'active' : ''} onClick={() => setTab('unplaced')}>Unplaced ({unplaced})</button>
        </div>
        {tab !== 'shelf' && (
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${nouns}…`} aria-label={`Search ${nouns}`} />
        )}
        {results && results.pageCount > 1 && (
          <Pager label="Page" from={results.page + 1} to={results.page + 1} total={results.pageCount} hasPrev={results.page > 0} hasNext={results.page < results.pageCount - 1}
            onPrev={() => setPage(results.page - 1)} onNext={() => setPage(results.page + 1)} />
        )}
      </div>
      <div className="zone-picker__rail">
        {entries.length === 0 && (
          <div className="zone-picker__empty">
            {tab === 'unplaced' ? `Every ${noun} has a place on a shelf.` : tab === 'all' ? (query ? `No ${noun} matches “${query}”.` : `No ${nouns} yet.`) : `No ${nouns} on this shelf.`}
          </div>
        )}
        {entries.map((item, i) => (
          <button key={item.id} type="button" title={item.name} onClick={() => onOpen(kind, item.id)}>
            <span>{String((results ? results.page * PAGE_SIZE : 0) + i + 1).padStart(2, '0')}</span>
            <strong>{item.name}</strong>
            <small>{meta(item)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
