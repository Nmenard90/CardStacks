'use strict';
const express = require('express');
const router  = express.Router();
const Storage = require('../lib/storage');

// ── GET /api/binders/:user ────────────────────────────────────────────────
router.get('/:user', (req, res) => {
  try { res.json(Storage.loadBinders(req.params.user)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/binders/:user — create binder ───────────────────────────────
router.post('/:user', (req, res) => {
  const id     = `binder_${Date.now()}`;
  const binder = {
    id,
    name:      req.body.name   || 'My Binder',
    cover:     req.body.cover  || '',
    size:      req.body.size   || '9',
    slots:     {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  Storage.saveBinder(req.params.user, id, binder);
  res.json(binder);
});

// ── GET /api/binders/:user/:id ────────────────────────────────────────────
router.get('/:user/:id', (req, res) => {
  try { res.json(Storage.loadBinder(req.params.user, req.params.id)); }
  catch { res.status(404).json({ error: 'Not found' }); }
});

// ── PUT /api/binders/:user/:id — update binder ────────────────────────────
router.put('/:user/:id', (req, res) => {
  try {
    const existing = Storage.loadBinder(req.params.user, req.params.id);
    const updated  = { ...existing, ...req.body, id: existing.id, updatedAt: Date.now() };
    Storage.saveBinder(req.params.user, req.params.id, updated);
    res.json(updated);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

// ── DELETE /api/binders/:user/:id ─────────────────────────────────────────
router.delete('/:user/:id', (req, res) => {
  try { Storage.deleteBinder(req.params.user, req.params.id); res.json({ ok: true }); }
  catch { res.status(404).json({ error: 'Not found' }); }
});

// ── POST /api/binders/:user/:id/cover — upload cover image ───────────────
router.post('/:user/:id/cover', (req, res) => {
  try {
    const binder    = Storage.loadBinder(req.params.user, req.params.id);
    binder.cover    = req.body.cover;
    binder.updatedAt = Date.now();
    Storage.saveBinder(req.params.user, req.params.id, binder);
    res.json({ ok: true });
  } catch { res.status(404).json({ error: 'Not found' }); }
});

module.exports = router;
