const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(__dirname, 'cache.json');
const API = 'https://api.pokemontcg.io/v2';
const TCG_TRACK = 'https://tcgtracking.com/tcgapi/v1';
const apiHeaders = () => process.env.POKEMONTCG_API_KEY ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY } : {};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Clear cache if CLEAR_CACHE env var is set
if (process.env.CLEAR_CACHE === 'true') {
  try { fs.unlinkSync(CACHE_FILE); console.log('   ✓ Cache cleared.'); } catch {}
}

app.use(express.json());
app.use(express.static(__dirname));

// ── Cache ──────────────────────────────────────────────────────────────────
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { return { sets: null, setsAt: 0, cards: {}, prices: {}, tcgSets: null, tcgSetsAt: 0 }; }
}
function saveCache(c) { fs.writeFileSync(CACHE_FILE, JSON.stringify(c)); }
let cache = loadCache();
if (!cache.prices)  cache.prices  = {};
if (!cache.tcgSets) cache.tcgSets = null;
if (!cache.tcgSetsAt) cache.tcgSetsAt = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;

// ── Collection helpers ─────────────────────────────────────────────────────
function colFile(user) {
  return path.join(DATA_DIR, `collection_${user.replace(/[^a-z0-9_-]/gi, '_')}.json`);
}
function loadCollection(user) {
  try { return JSON.parse(fs.readFileSync(colFile(user), 'utf8')); } catch { return {}; }
}
function saveCollection(user, data) {
  fs.writeFileSync(colFile(user), JSON.stringify(data, null, 2));
}

// ── TCGTracking set map ────────────────────────────────────────────────────
// Fetch TCGTracking's Pokemon set list and build abbreviation → id map
async function getTcgTrackSets() {
  const now = Date.now();
  if (cache.tcgSets && (now - cache.tcgSetsAt) < CACHE_TTL) return cache.tcgSets;
  const data = await fetch(`${TCG_TRACK}/3/sets`).then(r => r.json());
  const map = {};
  for (const s of data.sets) {
    map[s.abbreviation.toUpperCase()] = s.id;
    map[s.name.toUpperCase()] = s.id;
  }
  cache.tcgSets = { map, sets: data.sets };
  cache.tcgSetsAt = now;
  saveCache(cache);
  return cache.tcgSets;
}

// Map a pokemontcg.io set to a TCGTracking numeric ID
// pokemontcg sets have a ptcgoCode field (e.g. "CRI", "SVI") that matches TCGTracking abbreviations
async function resolveTcgTrackId(ptcgSet) {
  const { map, sets } = await getTcgTrackSets();
  // Try ptcgoCode first, then name
  const code = ptcgSet.ptcgoCode?.toUpperCase();
  const name = ptcgSet.name?.toUpperCase();
  if (code && map[code]) return map[code];
  if (name && map[name]) return map[name];
  // fuzzy: find set whose name contains the ptcg set name
  const fuzzy = sets.find(s =>
    s.name.toLowerCase().includes(ptcgSet.name?.toLowerCase()) ||
    ptcgSet.name?.toLowerCase().includes(s.name.toLowerCase())
  );
  return fuzzy ? fuzzy.id : null;
}

// ── Fetch SKU prices from TCGTracking ─────────────────────────────────────
// Returns { "card_number": { "NM/Holofoil": price, "LP/Holofoil": price, ... } }
async function fetchSkuPrices(tcgTrackId) {
  const now = Date.now();
  const key = `tcgt_${tcgTrackId}`;
  if (cache.prices[key] && (now - cache.prices[key].at) < CACHE_TTL)
    return cache.prices[key].data;

  // Get product list (has card numbers) and SKU prices in parallel
  const [products, skus] = await Promise.all([
    fetch(`${TCG_TRACK}/3/sets/${tcgTrackId}`).then(r => r.json()),
    fetch(`${TCG_TRACK}/3/sets/${tcgTrackId}/skus`).then(r => r.json())
  ]);

  // Build product id → card number map
  const numMap = {};
  for (const p of (products.products || [])) {
    numMap[String(p.id)] = p.number;
  }

  // Build card number → { "COND/Variant": market_price } map
  const priceMap = {};
  for (const [prodId, skuData] of Object.entries(skus.products || {})) {
    const cardNum = numMap[prodId];
    if (!cardNum) continue;
    if (!priceMap[cardNum]) priceMap[cardNum] = {};
    for (const [skuId, sku] of Object.entries(skuData)) {
      if (skuId === 'id') continue;
      if (!sku.mkt) continue;
      const condKey = `${sku.cnd}/${sku.var}`;
      priceMap[cardNum][condKey] = sku.mkt;
    }
  }

  cache.prices[key] = { data: priceMap, at: now };
  saveCache(cache);
  return priceMap;
}

// ── API routes ─────────────────────────────────────────────────────────────

// GET /api/users
app.get('/api/users', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('collection_'));
  res.json(files.map(f => f.replace('collection_', '').replace('.json', '')));
});

// GET /api/sets
app.get('/api/sets', async (req, res) => {
  const now = Date.now();
  if (cache.sets && (now - cache.setsAt) < CACHE_TTL) return res.json(cache.sets);
  try {
    const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=250`, { headers: apiHeaders() });
    const data = await r.json();
    cache.sets = data.data;
    cache.setsAt = now;
    saveCache(cache);
    res.json(data.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch all cards for a set (parallel pages)
async function fetchSet(setId) {
  const first = await fetch(`${API}/cards?q=set.id:${setId}&orderBy=number&pageSize=250&page=1`, { headers: apiHeaders() });
  const firstData = await first.json();
  if (!firstData.data) throw new Error(JSON.stringify(firstData));
  let all = [...firstData.data];
  if (firstData.totalCount > 250) {
    const pages = Math.ceil(firstData.totalCount / 250);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        fetch(`${API}/cards?q=set.id:${setId}&orderBy=number&pageSize=250&page=${i+2}`, { headers: apiHeaders() })
          .then(r => r.json())
      )
    );
    for (const r of rest) all = all.concat(r.data || []);
  }
  return all.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
}

// GET /api/cards/:setId  — returns cards + sku prices merged
app.get('/api/cards/:setId', async (req, res) => {
  const { setId } = req.params;
  const now = Date.now();
  if (cache.cards[setId] && (now - cache.cards[setId].at) < CACHE_TTL)
    return res.json(cache.cards[setId].data);
  try {
    const cards = await fetchSet(setId);

    // Try to get TCGTracking prices
    let skuPrices = {};
    try {
      const setMeta = cards[0]?.set;
      if (setMeta) {
        const tcgId = await resolveTcgTrackId(setMeta);
        if (tcgId) skuPrices = await fetchSkuPrices(tcgId);
      }
    } catch(e) { console.log('TCGTracking prices failed:', e.message); }

    // Merge SKU prices onto each card
    const merged = cards.map(c => ({
      ...c,
      skuPrices: skuPrices[c.number] || skuPrices[c.number?.replace(/^0+/, '')] || null
    }));

    cache.cards[setId] = { data: merged, at: now };
    saveCache(cache);
    res.json(merged);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/collection/:user
app.get('/api/collection/:user', (req, res) => res.json(loadCollection(req.params.user)));

// POST /api/collection/:user
app.post('/api/collection/:user', (req, res) => {
  const col = loadCollection(req.params.user);
  const { id, qty, price, setId, name, conditions } = req.body;
  if (!col[id]) col[id] = {};
  if (qty !== undefined) col[id].qty = Math.max(0, qty);
  if (price !== undefined) col[id].price = price;
  if (setId) col[id].setId = setId;
  if (name) col[id].name = name;
  if (conditions !== undefined) col[id].conditions = conditions;
  saveCollection(req.params.user, col);
  res.json({ ok: true });
});

// POST /api/collection/:user/bulk
app.post('/api/collection/:user/bulk', (req, res) => {
  const col = loadCollection(req.params.user);
  for (const item of req.body) {
    const { id, qty, price, setId, name, conditions } = item;
    if (!col[id]) col[id] = {};
    if (qty !== undefined) col[id].qty = Math.max(0, qty);
    if (price !== undefined) col[id].price = price;
    if (setId) col[id].setId = setId;
    if (name) col[id].name = name;
    if (conditions !== undefined) col[id].conditions = conditions;
  }
  saveCollection(req.params.user, col);
  res.json({ ok: true });
});

// ── Startup ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Pokémon Tracker running at http://localhost:${PORT}\n`);
  async function prewarm() {
    try {
      // Warm sets
      if (!cache.sets || (Date.now() - cache.setsAt) >= CACHE_TTL) {
        const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=250`, { headers: apiHeaders() });
        const data = await r.json();
        cache.sets = data.data; cache.setsAt = Date.now(); saveCache(cache);
        console.log(`   ✓ Cached ${data.data.length} sets.`);
      } else { console.log(`   ✓ Sets cached (${cache.sets.length}).`); }
      // Warm TCGTracking set map
      await getTcgTrackSets();
      console.log('   ✓ TCGTracking set map ready.');
      // Pre-cache 3 most recent sets
      const recent = cache.sets.slice(0, 3);
      for (const s of recent) {
        if (!cache.cards[s.id] || (Date.now() - cache.cards[s.id].at) >= CACHE_TTL) {
          try {
            console.log(`   Pre-caching ${s.name}...`);
            const cards = await fetchSet(s.id);
            const tcgId = await resolveTcgTrackId(s);
            let skuPrices = {};
            if (tcgId) skuPrices = await fetchSkuPrices(tcgId);
            cache.cards[s.id] = { data: cards.map(c => ({ ...c, skuPrices: skuPrices[c.number] || null })), at: Date.now() };
            saveCache(cache);
            console.log(`   ✓ ${s.name} (${cards.length} cards, prices: ${Object.keys(skuPrices).length})`);
          } catch(e) { console.log(`   ⚠ ${s.name}:`, e.message); }
        }
      }
    } catch(e) { console.log('   ⚠ Prewarm failed:', e.message); }
  }
  prewarm();
});
