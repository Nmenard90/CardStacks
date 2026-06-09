'use strict';
const fetch    = require('node-fetch');
const cache    = require('./cardCache');

const TCG_TRACK = 'https://tcgtracking.com/tcgapi/v1';
const TTL       = 6 * 60 * 60 * 1000; // 6 hours for prices

class PriceService {

  // ── TCGTracking set map ───────────────────────────────────────────────────
  async _getTcgSets() {
    if (cache.getTcgSets() && !cache.tcgSetsExpired()) return cache.getTcgSets();
    try {
      const res  = await fetch(`${TCG_TRACK}/sets?game=Pokemon`);
      const data = await res.json();
      const sets = data.sets || data || [];
      cache.setTcgSets(sets);
      return sets;
    } catch { return cache.getTcgSets() || []; }
  }

  async _mapSetId(pokemonSetId, setMeta) {
    const tcgSets = await this._getTcgSets();
    const ptcgo   = setMeta?.ptcgoCode?.toUpperCase();
    const name    = setMeta?.name || '';

    // Match by ptcgoCode abbreviation
    if (ptcgo) {
      const match = tcgSets.find(s =>
        s.abbreviation?.toUpperCase() === ptcgo ||
        s.code?.toUpperCase()         === ptcgo
      );
      if (match) return match.id || match.setId;
    }

    // Fuzzy match by name
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byName = tcgSets.find(s => norm(s.name || '') === norm(name));
    if (byName) return byName.id || byName.setId;

    return null;
  }

  async fetchSkuPrices(tcgTrackId) {
    const key = `sku_${tcgTrackId}`;
    const cached = cache.getPrices(key);
    if (cached && !cache.pricesExpired(key)) return cached.data;

    try {
      const res  = await fetch(`${TCG_TRACK}/prices?setId=${tcgTrackId}&game=Pokemon`);
      const data = await res.json();
      const prices = data.prices || data || {};
      cache.setPrices(key, prices);
      return prices;
    } catch { return cached?.data || {}; }
  }

  // Resolve ptcg set → TCGTracking prices map
  async getPricesForSet(setId, setMeta) {
    const cacheKey = `set_${setId}`;
    const cached   = cache.getPrices(cacheKey);
    if (cached && !cache.pricesExpired(cacheKey)) return cached.data;

    const tcgId = await this._mapSetId(setId, setMeta);
    if (!tcgId) return {};

    const prices = await this.fetchSkuPrices(tcgId);
    cache.setPrices(cacheKey, prices);
    return prices;
  }

  // Find the NM price for a specific card number within a price map
  findCardPrice(skuPrices, cardNumber) {
    if (!skuPrices || !cardNumber) return null;
    const nInt = parseInt(cardNumber);

    // Direct match
    if (skuPrices[cardNumber]) return skuPrices[cardNumber];

    // Integer match
    for (const key of Object.keys(skuPrices)) {
      if (parseInt(key) === nInt) return skuPrices[key];
    }
    return null;
  }

  // Merge SKU prices into card objects
  mergeIntoCards(cards, skuPrices) {
    return cards.map(card => ({
      ...card,
      skuPrices: this.findCardPrice(skuPrices, card.number) || undefined,
    }));
  }
}

module.exports = new PriceService();
