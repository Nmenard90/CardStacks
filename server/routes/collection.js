'use strict';
const express = require('express');
const router  = express.Router();
const Storage = require('../lib/storage');

// ── GET /api/users ────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  res.json(Storage.listUsers());
});

// ── GET /api/collection/:user ─────────────────────────────────────────────
router.get('/collection/:user', (req, res) => {
  res.json(Storage.loadCollection(req.params.user));
});

// ── POST /api/collection/:user — save one card ────────────────────────────
router.post('/collection/:user', (req, res) => {
  const col = Storage.loadCollection(req.params.user);
  const { id, qty, price, setId, name, conditions, condPrices, selectedCond } = req.body;

  if (!col[id]) col[id] = {};
  if (qty          !== undefined) col[id].qty          = Math.max(0, qty);
  if (price        !== undefined) col[id].price        = price;
  if (setId)                      col[id].setId        = setId;
  if (name)                       col[id].name         = name;
  if (conditions   !== undefined) col[id].conditions   = conditions;
  if (condPrices   !== undefined) col[id].condPrices   = condPrices;
  if (selectedCond !== undefined) col[id].selectedCond = selectedCond;

  Storage.saveCollection(req.params.user, col);
  res.json({ ok: true });
});

// ── POST /api/collection/:user/bulk — save many cards ────────────────────
router.post('/collection/:user/bulk', (req, res) => {
  const col   = Storage.loadCollection(req.params.user);
  const items = req.body;

  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });

  for (const item of items) {
    const { id, qty, price, setId, name, conditions, condPrices, selectedCond } = item;
    if (!id) continue;
    if (!col[id]) col[id] = {};
    if (qty          !== undefined) col[id].qty          = Math.max(0, qty);
    if (price        !== undefined) col[id].price        = price;
    if (setId)                      col[id].setId        = setId;
    if (name)                       col[id].name         = name;
    if (conditions   !== undefined) col[id].conditions   = conditions;
    if (condPrices   !== undefined) col[id].condPrices   = condPrices;
    if (selectedCond !== undefined) col[id].selectedCond = selectedCond;
  }

  Storage.saveCollection(req.params.user, col);
  res.json({ ok: true });
});

module.exports = router;
