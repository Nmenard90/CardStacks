'use strict';
const fetch = require('node-fetch');

const BASE = 'https://api.pokemontcg.io/v2';

class PokemonAPI {
  get _headers() {
    // Read env var each time so it's always current
    const key = process.env.POKEMONTCG_API_KEY || '';
    return key ? { 'X-Api-Key': key } : {};
  }

  async _get(url) {
    const res = await fetch(url, { headers: this._headers });
    if (!res.ok) throw new Error(`PokemonAPI ${res.status}: ${url}`);
    return res.json();
  }

  // ── Sets ──────────────────────────────────────────────────────────────────
  async fetchSets() {
    const data = await this._get(`${BASE}/sets?orderBy=-releaseDate&pageSize=250`);
    return data.data || [];
  }

  // ── Cards ─────────────────────────────────────────────────────────────────
  async fetchCards(setId) {
    const first = await this._get(`${BASE}/cards?q=set.id:${setId}&pageSize=250&page=1`);
    if (!first.data) throw new Error(`No card data for set ${setId}`);

    let all = [...first.data];
    const total = first.totalCount || 0;

    if (total > 250) {
      const pages = Math.ceil(total / 250);
      const rest  = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          this._get(`${BASE}/cards?q=set.id:${setId}&pageSize=250&page=${i + 2}`)
        )
      );
      for (const r of rest) all = all.concat(r.data || []);
    }

    return this._dedupeAndSort(all);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _dedupeAndSort(cards) {
    const seen = new Set();
    const unique = cards.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return unique.sort((a, b) => {
      const na = parseInt(a.number), nb = parseInt(b.number);
      const aNum = !isNaN(na), bNum = !isNaN(nb);
      if (aNum && bNum) return na !== nb ? na - nb : a.number.localeCompare(b.number);
      if (aNum) return -1;
      if (bNum) return 1;
      return a.number.localeCompare(b.number);
    });
  }
}

module.exports = new PokemonAPI();
