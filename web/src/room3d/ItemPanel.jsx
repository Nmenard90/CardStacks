import React from 'react';
import { isHoloRarity } from './room/holoFoil.js';
import { BOX_PRESETS } from './data/contracts.js';

const titleCase = (value = '') => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
/** A box's kind as people say it: the preset's name ("800 Count Box"), "Set box · auto-filed" for the boxes cards are
 *  filed into automatically, otherwise the stored type in words (Spaces' humanizeBoxType says the same). */
const boxKind = (boxType = '') => (boxType.startsWith('auto_set:') ? 'Set box · auto-filed'
  : BOX_PRESETS.find((p) => p.boxType === boxType)?.name ?? (boxType ? titleCase(boxType.replaceAll('-', ' ')) : 'Box'));
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const LANGUAGES = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;
/** "en" → "English", "ja" → "Japanese"; anything unrecognised is shown as stored. */
const languageName = (code) => { try { return LANGUAGES?.of(code) ?? code; } catch { return code; } };

/** Condition colours, the same ones the site's condition badges use (web/src/lib/conditions.ts). */
const COND_COLORS = { NM: '#22c55e', LP: '#84cc16', MP: '#eab308', HP: '#f97316', DMG: '#ef4444' };

/** The card record: the same facts the site's card tile shows — set, number, rarity, artist, price, condition, print, copies. */
function CardFacts({ card, compact = false }) {
  if (!card) return null;
  const holo = isHoloRarity(card.rarity);
  const qty = card.quantity ?? 1;
  const condColor = COND_COLORS[String(card.condition).split(' ')[0]];
  return (
    <div className={compact ? 'card-facts card-facts--compact' : 'card-facts'}>
      <div>
        <span>{card.setName}</span>
        <strong>{card.name}</strong>
        <small>{[card.number && `#${card.number}`, card.rarity].filter(Boolean).join(' · ')}{holo && <b className="holo-chip">Holo</b>}</small>
        {card.artist && <small>Illus. {card.artist}</small>}
      </div>
      {!compact && (
        <div className={`card-facts__price${card.price == null ? ' card-facts__price--none' : ''}`}>
          {card.price != null ? (
            <>
              <strong>{money(card.price)}</strong>
              {qty > 1 && <em>× {qty} = {money(card.value)}</em>}
              <small>{card.printLabel ? `${card.printLabel} · ` : ''}market price</small>
            </>
          ) : <strong>No price</strong>}
        </div>
      )}
      <dl>
        {/* Binder pockets record only which card is in them, so condition / protection / language show only when known. */}
        {card.condition && <div><dt>Condition</dt><dd>{condColor && <i className="cond-dot" style={{ background: condColor }} aria-hidden="true" />}{card.condition}</dd></div>}
        <div><dt>Copies</dt><dd>×{qty}</dd></div>
        {!compact && card.printLabel && <div><dt>Print</dt><dd>{card.printLabel}</dd></div>}
        {card.condition && card.protection && <div><dt>Protection</dt><dd>{titleCase(card.protection)}</dd></div>}
        {!compact && card.language && <div><dt>Language</dt><dd>{languageName(card.language)}</dd></div>}
        {compact && card.value != null && <div><dt>Value</dt><dd>{money(card.value)}</dd></div>}
      </dl>
      {card.notes && !compact && <p className="item-note">{card.notes}</p>}
    </div>
  );
}

function BinderPanel({ binder, selectedCard }) {
  // Real binders carry no capacity (CardStacks has no page count on the Binder record), so the meter only shows when one is known.
  const completion = binder.capacity ? Math.round((binder.cardCount / binder.capacity) * 100) : null;
  return (
    <>
      <div className="item-panel__stats">
        <div><strong>{binder.cardCount}</strong><span>cards</span></div>
        <div><strong>{binder.pocketSize}</strong><span>pocket</span></div>
        {completion !== null && <div><strong>{completion}%</strong><span>filled</span></div>}
      </div>
      {completion !== null && <div className="meter" aria-label={`${completion}% full`}>
        <span style={{ width: `${completion}%` }} />
      </div>}
      <p className="item-panel__instruction">Flip pages with ← → or the page bar. Tap a card to read it, or an empty pocket to add one.</p>
      {binder.cards.length === 0 ? (
        <div className="empty-selection"><span>0</span>This binder is empty — tap a pocket to add a card</div>
      ) : selectedCard ? (
        <CardFacts card={selectedCard} />
      ) : (
        <div className="empty-selection empty-selection--hint"><span>↔</span>Tap a card in the binder to see its record</div>
      )}
    </>
  );
}

/** Drawer and card choice live in App so the rolodex and this panel always agree. */
function StoragePanel({ box, drawerId, onDrawer, cardId: selectedCardId, onCard }) {
  const drawer = box.drawers.find((item) => item.id === drawerId) ?? box.drawers[0];
  const selectedStorageCard = drawer?.cards.find((card) => card.id === selectedCardId) ?? null;
  const fill = box.capacity ? Math.min(100, Math.round((box.cardCount / box.capacity) * 100)) : null;
  return (
    <>
      <div className="item-panel__stats">
        <div><strong>{box.cardCount}</strong><span>copies</span></div>
        <div><strong>{box.drawers.length}</strong><span>drawers</span></div>
        {fill !== null && <div><strong>{fill}%</strong><span>capacity</span></div>}
      </div>
      {fill !== null && <div className="meter meter--coral" aria-label={`${fill}% full`}>
        <span style={{ width: `${fill}%` }} />
      </div>}
      {selectedStorageCard && <CardFacts card={selectedStorageCard} />}
      <div className="drawer-tabs" role="tablist" aria-label="Box drawers">
        {box.drawers.map((item) => (
          <button
            key={item.id}
            className={item.id === drawer?.id ? 'active' : ''}
            onClick={() => onDrawer(item.id)}
            role="tab"
            aria-selected={item.id === drawer?.id}
          >
            {item.name}<span>{item.cardCount}</span>
          </button>
        ))}
      </div>
      <div className="drawer-cards" aria-label={`${drawer?.name ?? 'Drawer'} contents`}>
        {!drawer && <div className="empty-selection"><span>0</span>This box has no drawers yet</div>}
        {drawer && drawer.cards.length === 0 && <div className="empty-selection"><span>0</span>This drawer is empty</div>}
        {drawer?.cards.map((card) => (
          <button className={`drawer-card${selectedCardId === card.id ? ' active' : ''}`} key={`${drawer.id}-${card.id}`} onClick={() => onCard(selectedCardId === card.id ? null : card.id)}>
            <span className="drawer-card__swatch" style={{ '--seed': card.seed }} />
            <div><strong>{card.name}</strong><small>{card.setName} · {card.condition}</small></div>
            <b>×{card.quantity}</b>
          </button>
        ))}
      </div>
    </>
  );
}

export function ZonePicker({ zone, items, onSelect }) {
  const noun = zone === 'binders' ? 'binder' : zone === 'storage' ? 'box' : 'card';
  return (
    <section className={`zone-picker zone-picker--${zone}`} aria-label={`Choose a ${noun}`}>
      <div className="zone-picker__intro">
        <span>{String(items.length).padStart(2, '0')} items</span>
        <strong>Pick an individual {noun}</strong>
        <small>Click it in the room or use this index.</small>
      </div>
      <div className="zone-picker__rail">
        {items.length === 0 && <div className="zone-picker__empty">Nothing is assigned here in CardStacks yet.</div>}
        {items.map((item, index) => (
          <button key={item.id} data-item-id={item.id} onClick={() => onSelect(item)}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{item.name}</strong>
            <small>{zone === 'binders' ? `Shelf ${item.shelfIndex + 1}` : zone === 'storage' ? `${item.cardCount} copies` : item.rarity}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * PURPOSE: The side panel for an open binder, box or displayed card.
 * @param siteLink  { to, label } — the page on the rest of the site where this item is managed
 * @param onLink    navigates there (react-router), so the visit stays inside the app
 */
export default function ItemPanel({ type, item, selectedCard, onClose, drawerId, onDrawer, cardId, onCard, siteLink, onLink }) {
  const eyebrow = type === 'binder' ? (item.shelfIndex != null ? `Binder · shelf ${item.shelfIndex + 1}` : 'Binder · unplaced') : type === 'storage' ? boxKind(item.boxType) : 'Display slot';
  return (
    <aside className={`item-panel item-panel--${type}`} data-panel-type={type} aria-live="polite">
      <button className="item-panel__close" onClick={onClose} aria-label={`Close ${item.name}`}>×</button>
      <div className="item-panel__eyebrow">{eyebrow}</div>
      <h1>{item.name}</h1>
      <p className="item-panel__subhead">
        {type === 'binder' && `${item.shelfPosition != null ? `Shelf position ${item.shelfPosition + 1}` : 'Not on a shelf yet'}${item.capacity ? ` · ${item.capacity} total slots` : ''}`}
        {type === 'storage' && `${item.shelfIndex != null ? `Shelf ${item.shelfIndex + 1}` : 'Not on a shelf yet'}${item.capacity ? ` · ${item.capacity}-card capacity` : ''}`}
        {type === 'display' && [item.setName, item.number && `#${item.number}`].filter(Boolean).join(' · ')}
      </p>
      {type === 'binder' && <BinderPanel binder={item} selectedCard={selectedCard} />}
      {type === 'storage' && <StoragePanel box={item} drawerId={drawerId} onDrawer={onDrawer} cardId={cardId} onCard={onCard} />}
      {type === 'display' && <CardFacts card={item} />}
      {siteLink && <a className="item-panel__site-link" href={siteLink.to} onClick={(event) => { event.preventDefault(); onLink(siteLink.to); }}>{siteLink.label} →</a>}
    </aside>
  );
}
