'use strict';
const express      = require('express');
const router       = express.Router();
const cache        = require('../lib/cardCache');
const pokemonApi   = require('../lib/pokemonApi');
const priceService = require('../lib/priceService');
const Storage      = require('../lib/storage');

// ── GET /api/admin/refresh-set/:setId ─────────────────────────────────────
router.get('/refresh-set/:setId', async (req, res) => {
  const { setId } = req.params;
  try {
    cache.deleteCards(setId);
    const cards   = await pokemonApi.fetchCards(setId);
    const setMeta = cache.getSets()?.find(s => s.id === setId);
    const prices  = await priceService.getPricesForSet(setId, setMeta);
    const merged  = priceService.mergeIntoCards(cards, prices);
    cache.setCards(setId, merged);
    res.json({ ok: true, set: setId, cards: merged.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/refresh-sets ───────────────────────────────────────────
router.get('/refresh-sets', async (req, res) => {
  try {
    const sets = await pokemonApi.fetchSets();
    cache.setSets(sets);
    Storage.saveSetsFile(sets);
    res.json({ ok: true, sets: sets.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/cache ──────────────────────────────────────────────────
router.get('/cache', (req, res) => {
  res.json(cache.debugInfo());
});

// ── GET /api/admin/clear-all ──────────────────────────────────────────────
router.get('/clear-all', (req, res) => {
  cache.clearAll();
  res.json({ ok: true, message: 'All caches cleared' });
});

// ── GET /api/admin/clear/:setId ───────────────────────────────────────────
router.get('/clear/:setId', (req, res) => {
  cache.deleteCards(req.params.setId);
  res.json({ ok: true, message: `Cache cleared for ${req.params.setId}` });
});

module.exports = router;
