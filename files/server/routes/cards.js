'use strict';
const express      = require('express');
const router       = express.Router();
const cache        = require('../lib/cardCache');
const pokemonApi   = require('../lib/pokemonApi');
const priceService = require('../lib/priceService');
const Storage      = require('../lib/storage');

// ── GET /api/sets ─────────────────────────────────────────────────────────
router.get('/sets', async (req, res) => {
  // Memory cache
  if (cache.getSets() && !cache.setsExpired()) return res.json(cache.getSets());

  // Disk file
  const fromDisk = Storage.loadSetsFile();
  if (fromDisk) { cache.setSets(fromDisk); return res.json(fromDisk); }

  // Fetch from API
  try {
    const sets = await pokemonApi.fetchSets();
    cache.setSets(sets);
    Storage.saveSetsFile(sets);
    res.json(sets);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/cards/:setId ─────────────────────────────────────────────────
router.get('/cards/:setId', async (req, res) => {
  const { setId } = req.params;

  // Cached in memory or on disk
  const cached = cache.getCards(setId);
  if (cached) return res.json(cached);

  // Fetch fresh
  try {
    const cards    = await pokemonApi.fetchCards(setId);
    const setMeta  = cache.getSets()?.find(s => s.id === setId);
    const prices   = await priceService.getPricesForSet(setId, setMeta);
    const merged   = priceService.mergeIntoCards(cards, prices);

    cache.setCards(setId, merged);
    res.json(merged);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/search?q=name ────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  try {
    const results = cache.search(q);

    // If not enough from cache, try API as fallback
    if (results.length < 5) {
      try {
        const apiCards = await pokemonApi._get(
          `https://api.pokemontcg.io/v2/cards?q=name:"${q}*"&pageSize=20&orderBy=-set.releaseDate`
        ).then(d => d.data || []);
        const seen = new Set(results.map(c => c.id));
        for (const card of apiCards) {
          if (!seen.has(card.id)) {
            // Use cached version if available (has prices)
            const setCards = cache.getCards(card.set?.id);
            const withPrice = setCards?.find(c => c.id === card.id);
            results.push(withPrice || card);
            seen.add(card.id);
          }
        }
      } catch {}
    }

    res.json(results.slice(0, 60));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
