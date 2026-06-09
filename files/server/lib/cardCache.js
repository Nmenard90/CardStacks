'use strict';
const Storage = require('./storage');

const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

class CardCache {
  constructor() {
    this._meta   = Storage.loadCache();   // timestamps, set list
    this._cards  = {};                     // in-memory card data
    this._prices = this._meta.prices || {};

    // Reload card timestamps — actual data loaded lazily from disk
    for (const [id, v] of Object.entries(this._meta.cards || {})) {
      this._cards[id] = { at: v.at, count: v.count, data: null };
    }
  }

  // ── Sets ──────────────────────────────────────────────────────────────────
  getSets()       { return this._meta.sets || null; }
  getSetsAge()    { return Date.now() - (this._meta.setsAt || 0); }
  setsExpired()   { return this.getSetsAge() > TTL; }

  setSets(sets) {
    this._meta.sets   = sets;
    this._meta.setsAt = Date.now();
    this._persist();
  }

  // ── Cards ─────────────────────────────────────────────────────────────────
  // Get card data for a set — from memory, then disk, then null
  getCards(setId) {
    const entry = this._cards[setId];
    if (entry?.data) return entry.data;

    // Try disk
    const fromDisk = Storage.loadCardFile(setId);
    if (fromDisk) {
      this._cards[setId] = { at: entry?.at || Date.now(), data: fromDisk };
      return fromDisk;
    }
    return null;
  }

  hasCards(setId) { return !!this.getCards(setId); }

  setCards(setId, data) {
    this._cards[setId] = { at: Date.now(), data };
    Storage.saveCardFile(setId, data);
    this._persist();
  }

  deleteCards(setId) {
    delete this._cards[setId];
    Storage.deleteCardFile(setId);
    this._persist();
  }

  // ── Prices ────────────────────────────────────────────────────────────────
  getPrices(key)         { return this._prices[key] || null; }
  getPricesAge(key)      { return Date.now() - (this._prices[key]?.at || 0); }
  pricesExpired(key)     { return this.getPricesAge(key) > TTL; }

  setPrices(key, data) {
    this._prices[key] = { data, at: Date.now() };
    this._meta.prices = this._prices;
    this._persist();
  }

  // ── TCG set map ───────────────────────────────────────────────────────────
  getTcgSets()   { return this._meta.tcgSets || null; }
  getTcgSetsAge(){ return Date.now() - (this._meta.tcgSetsAt || 0); }
  tcgSetsExpired(){ return this.getTcgSetsAge() > TTL; }

  setTcgSets(sets) {
    this._meta.tcgSets   = sets;
    this._meta.tcgSetsAt = Date.now();
    this._persist();
  }

  // ── Search ────────────────────────────────────────────────────────────────
  // Search all cached+disk sets by card name
  search(query) {
    const q   = query.toLowerCase().trim();
    const results = [];
    const seen    = new Set();

    // All known set IDs — memory + disk
    const allIds = new Set([
      ...Object.keys(this._cards),
      ...Storage.listCardFiles(),
    ]);

    for (const setId of allIds) {
      const cards = this.getCards(setId);
      if (!cards) continue;
      for (const card of cards) {
        if (seen.has(card.id)) continue;
        if (card.name.toLowerCase().includes(q) || card.number === q) {
          results.push(card);
          seen.add(card.id);
        }
      }
    }

    // Newest sets first
    results.sort((a, b) => (b.set?.releaseDate || '').localeCompare(a.set?.releaseDate || ''));
    return results.slice(0, 60);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  clearAll() {
    this._cards  = {};
    this._prices = {};
    this._meta   = { sets: null, setsAt: 0, cards: {}, prices: {}, tcgSets: null, tcgSetsAt: 0 };
    Storage.clearCache();
  }

  debugInfo() {
    return {
      sets:   this._meta.sets?.length || 0,
      cards:  Object.fromEntries(
        Object.entries(this._cards).map(([k, v]) => [k, v.data?.length || v.count || 0])
      ),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────
  _persist() {
    this._meta.prices = this._prices;
    Storage.saveCache({
      ...this._meta,
      cards: Object.fromEntries(
        Object.entries(this._cards).map(([id, v]) => [id, { at: v.at, count: v.data?.length || v.count || 0 }])
      ),
    });
  }
}

module.exports = new CardCache(); // singleton
