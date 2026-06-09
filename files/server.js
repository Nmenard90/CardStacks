const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// Use /data volume if available (Railway persistent storage), else local
const PERSIST_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DATA_DIR = path.join(PERSIST_DIR, 'data');
const CARD_DATA_DIR = path.join(PERSIST_DIR, 'card-data');
const CACHE_FILE_PATH_PATH = path.join(PERSIST_DIR, 'cache.json');
// Cache file path defined after PERSIST_DIR
const API = 'https://api.pokemontcg.io/v2';
const TCG_TRACK = 'https://tcgtracking.com/tcgapi/v1';
const apiHeaders = () => process.env.POKEMONTCG_API_KEY ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY } : {};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Clear cache if CLEAR_CACHE env var is set
if (process.env.CLEAR_CACHE === 'true') {
  try { fs.unlinkSync(CACHE_FILE_PATH); console.log('   ✓ Cache file cleared.'); } catch {}
  try {
    if (fs.existsSync(CARD_DATA_DIR)) {
      fs.readdirSync(CARD_DATA_DIR).forEach(f => fs.unlinkSync(path.join(CARD_DATA_DIR, f)));
      console.log('   ✓ Cards cache cleared.');
    }
  } catch(e) { console.log('   ⚠ Could not clear cards cache:', e.message); }
}

app.use(express.json({limit:'10mb'}));

// Serve HTML files fresh (no cache) so updates deploy immediately
// Static middleware handles JS/CSS/images with normal caching
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Search cards by name across all sets
// First searches in-memory cached sets (which have prices), then falls back to API
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if(!q || q.length < 2) return res.json([]);
  try{
    const results = [];
    const seen = new Set();

    // Search cached sets first — these have SKU prices already merged in
    for(const setId of Object.keys(cache.cards)) {
      const setCards = cache.cards[setId]?.data;
      if(!setCards) continue;
      for(const card of setCards) {
        if(seen.has(card.id)) continue;
        if(card.name.toLowerCase().includes(q) || card.number === q) {
          results.push(card);
          seen.add(card.id);
          if(results.length >= 60) break;
        }
      }
      if(results.length >= 60) break;
    }

    // If not enough results from cache, also hit the API
    if(results.length < 10) {
      try {
        const url = `${API}/cards?q=name:"${q}*"&pageSize=20&orderBy=-set.releaseDate`;
        const data = await fetch(url, { headers: apiHeaders() }).then(r => r.json());
        for(const card of (data.data || [])) {
          if(seen.has(card.id)) continue;
          seen.add(card.id);
          // Check if we have a cached version with prices
          for(const setId of Object.keys(cache.cards)) {
            const cached = cache.cards[setId]?.data?.find(c => c.id === card.id);
            if(cached) { results.push(cached); break; }
          }
          if(!results.find(r => r.id === card.id)) results.push(card);
        }
      } catch(e) {}
    }

    // Sort by set release date (newest first)
    results.sort((a,b) => {
      const da = a.set?.releaseDate || '';
      const db = b.set?.releaseDate || '';
      return db.localeCompare(da);
    });

    res.json(results.slice(0, 60));
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});


// Clear cache for a specific set (admin)

// Debug: check cache counts
// Admin: refresh card data for a specific set from API and save to file
app.get('/api/admin/refresh-set/:setId', async (req, res) => {
  const { setId } = req.params;
  try {
    const cardFile = path.join(CARD_DATA_DIR, setId + '.json');
    if(fs.existsSync(cardFile)) fs.unlinkSync(cardFile);
    delete cache.cards[setId];
    const cards = await fetchSet(setId);
    if(!fs.existsSync(CARD_DATA_DIR)) fs.mkdirSync(CARD_DATA_DIR, {recursive:true});
    fs.writeFileSync(cardFile, JSON.stringify(cards));
    res.json({ ok: true, set: setId, cards: cards.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: refresh sets list from API
app.get('/api/admin/refresh-sets', async (req, res) => {
  try {
    const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=250`, { headers: apiHeaders() });
    const data = await r.json();
    if(!fs.existsSync(CARD_DATA_DIR)) fs.mkdirSync(CARD_DATA_DIR, {recursive:true});
    fs.writeFileSync(path.join(CARD_DATA_DIR, '_sets.json'), JSON.stringify(data.data, null, 2));
    cache.sets = data.data; cache.setsAt = Date.now(); saveCache(cache);
    res.json({ ok: true, sets: data.data.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/debug/cache', (req, res) => {
  const info = {
    sets: cache.sets?.length || 0,
    cards: Object.fromEntries(
      Object.entries(cache.cards).map(([k,v]) => [k, v.data?.length || 0])
    )
  };
  res.json(info);
});

app.get('/api/cache/clear/:setId', (req, res) => {
  const { setId } = req.params;
  if(cache.cards[setId]){
    delete cache.cards[setId];
    saveCache(cache);
    res.json({ ok: true, message: `Cache cleared for ${setId}` });
  } else {
    res.json({ ok: false, message: `No cache found for ${setId}` });
  }
});

// Clear ALL card caches
app.get('/api/cache/clear-all', (req, res) => {
  cache.cards = {};
  cache.sets = null;
  cache.setsAt = 0;
  // Also delete per-set card files
  try {
    const files = fs.readdirSync(CARDS_CACHE_DIR);
    files.forEach(f => fs.unlinkSync(path.join(CARDS_CACHE_DIR, f)));
  } catch(e) {}
  saveCache(cache);
  res.json({ ok: true, message: 'All caches cleared' });
});

app.get('/analyzer', (req, res) => res.sendFile(path.join(__dirname, 'analyzer.html')));

app.use(express.static(__dirname));

// ── Cache ──────────────────────────────────────────────────────────────────
const CARDS_CACHE_DIR = path.join(__dirname, 'cards_cache');
if (!fs.existsSync(CARDS_CACHE_DIR)) fs.mkdirSync(CARDS_CACHE_DIR, { recursive: true });

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8')); }
  catch { return { sets: null, setsAt: 0, cards: {}, prices: {}, tcgSets: null, tcgSetsAt: 0 }; }
}
function saveCache(c) {
  // Save everything EXCEPT card data (stored separately per set)
  const toSave = { ...c, cards: {} };
  // Save card timestamps only
  for (const [setId, v] of Object.entries(c.cards || {})) {
    toSave.cards[setId] = { at: v.at, count: v.data?.length || 0 };
  }
  fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(toSave));
}

// Save a single set's cards to its own file
function saveSetCards(setId, data) {
  const f = path.join(CARDS_CACHE_DIR, setId + '.json');
  fs.writeFileSync(f, JSON.stringify(data));
}

// Load a single set's cards from its own file
function loadSetCards(setId) {
  try {
    const f = path.join(CARDS_CACHE_DIR, setId + '.json');
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { return null; }
}

let cache = loadCache();
// Reload card data from per-set files into memory
for (const setId of Object.keys(cache.cards || {})) {
  const data = loadSetCards(setId);
  if (data) cache.cards[setId].data = data;
  else delete cache.cards[setId]; // file missing, will re-fetch
}
if (!cache.prices)  cache.prices  = {};
if (!cache.tcgSets) cache.tcgSets = null;
if (!cache.tcgSetsAt) cache.tcgSetsAt = 0;
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    if (s.abbreviation) map[s.abbreviation.toUpperCase()] = s.id;
    if (s.name) map[s.name.toUpperCase()] = s.id;
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

// TEMP: Debug SKU prices for a card
app.get('/api/debug-prices/:setId', async (req, res) => {
  try {
    const { setId } = req.params;
    // Get set meta from cache or fetch
    let setMeta = null;
    if (cache.cards[setId]) {
      setMeta = cache.cards[setId].data[0]?.set;
    } else {
      const r = await fetch(`${API}/cards?q=set.id:${setId}&orderBy=number&pageSize=1`, { headers: apiHeaders() });
      const d = await r.json();
      setMeta = d.data?.[0]?.set;
    }
    const tcgId = setMeta ? await resolveTcgTrackId(setMeta) : null;
    const skuPrices = tcgId ? await fetchSkuPrices(tcgId) : {};
    // Show first 3 card numbers and their prices
    const sample = Object.entries(skuPrices).slice(0, 3);
    // Also show what the cached card looks like
    const cachedCard = cache.cards[setId]?.data?.[0];
    res.json({
      setId, setMeta: setMeta?.name, tcgId,
      skuPriceSample: sample,
      firstCardSkuPrices: cachedCard?.skuPrices,
      firstCardNumber: cachedCard?.number
    });
  } catch(e) { res.status(500).json({ error: e.message, stack: e.stack }); }
});

// ── Binder routes ──────────────────────────────────────────────────────────

// Serve shelf page
app.get('/shelf', (req, res) => {
  res.sendFile(path.join(__dirname, 'shelf.html'));
});

// Serve binder page
app.get('/binder', (req, res) => {
  res.sendFile(path.join(__dirname, 'binder.html'));
});

// binder data dir per user
function binderDir(user) {
  const d = path.join(DATA_DIR, `binders_${user.replace(/[^a-z0-9_-]/gi,'_')}`);
  if (!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true});
  return d;
}

// GET /api/binders/:user — list all binders
app.get('/api/binders/:user', (req, res) => {
  const dir = binderDir(req.params.user);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const binders = files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch { return null; }
  }).filter(Boolean);
  binders.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  res.json(binders);
});

// POST /api/binders/:user — create binder
app.post('/api/binders/:user', (req, res) => {
  const dir = binderDir(req.params.user);
  const id = 'binder_' + Date.now();
  const binder = { id, name: req.body.name||'My Binder', cover: req.body.cover||'', size: req.body.size||'9', slots: {}, createdAt: Date.now(), updatedAt: Date.now() };
  fs.writeFileSync(path.join(dir, id+'.json'), JSON.stringify(binder, null, 2));
  res.json(binder);
});

// GET /api/binders/:user/:id — get one binder
app.get('/api/binders/:user/:id', (req, res) => {
  try {
    const f = path.join(binderDir(req.params.user), req.params.id+'.json');
    res.json(JSON.parse(fs.readFileSync(f,'utf8')));
  } catch { res.status(404).json({error:'Not found'}); }
});

// PUT /api/binders/:user/:id — update binder (name, cover, size, slots)
app.put('/api/binders/:user/:id', (req, res) => {
  try {
    const f = path.join(binderDir(req.params.user), req.params.id+'.json');
    const existing = JSON.parse(fs.readFileSync(f,'utf8'));
    const updated = { ...existing, ...req.body, id: existing.id, updatedAt: Date.now() };
    fs.writeFileSync(f, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch { res.status(404).json({error:'Not found'}); }
});

// DELETE /api/binders/:user/:id
app.delete('/api/binders/:user/:id', (req, res) => {
  try {
    fs.unlinkSync(path.join(binderDir(req.params.user), req.params.id+'.json'));
    res.json({ok:true});
  } catch { res.status(404).json({error:'Not found'}); }
});

// POST /api/binders/:user/:id/cover — upload cover image (base64)
app.post('/api/binders/:user/:id/cover', (req, res) => {
  try {
    const f = path.join(binderDir(req.params.user), req.params.id+'.json');
    const binder = JSON.parse(fs.readFileSync(f,'utf8'));
    binder.cover = req.body.cover; // base64 data URL
    binder.updatedAt = Date.now();
    fs.writeFileSync(f, JSON.stringify(binder, null, 2));
    res.json({ok:true});
  } catch { res.status(404).json({error:'Not found'}); }
});

// GET /api/users
app.get('/api/users', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('collection_'));
  res.json(files.map(f => f.replace('collection_', '').replace('.json', '')));
});

// GET /api/sets
app.get('/api/sets', async (req, res) => {
  const now = Date.now();
  if (cache.sets && (now - cache.setsAt) < CACHE_TTL) return res.json(cache.sets);

  // Try static sets file first
  const setsFile = path.join(CARD_DATA_DIR, '_sets.json');
  if (fs.existsSync(setsFile)) {
    try {
      const sets = JSON.parse(fs.readFileSync(setsFile, 'utf8'));
      cache.sets = sets; cache.setsAt = now; saveCache(cache);
      return res.json(sets);
    } catch(e) {}
  }

  // Fall back to API
  try {
    const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=250`, { headers: apiHeaders() });
    const data = await r.json();
    cache.sets = data.data; cache.setsAt = now; saveCache(cache);
    res.json(data.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch all cards for a set
// Reads from card-data/[setId].json if available (fast, no API call)
// Falls back to pokemontcg.io API if file not found
async function fetchSet(setId) {
  // Try static card data file first
  const cardFile = path.join(CARD_DATA_DIR, setId + '.json');
  if (fs.existsSync(cardFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cardFile, 'utf8'));
      console.log(`[fetchSet] ${setId}: loaded ${data.length} cards from file`);
      return data;
    } catch(e) {
      console.log(`[fetchSet] ${setId}: file read failed, falling back to API`);
    }
  }

  // Fall back to API
  console.log(`[fetchSet] ${setId}: no local file, fetching from API...`);
  const first = await fetch(`${API}/cards?q=set.id:${setId}&pageSize=250&page=1`, { headers: apiHeaders() });
  const firstData = await first.json();
  if (!firstData.data) throw new Error(JSON.stringify(firstData));
  let all = [...firstData.data];
  const total = firstData.totalCount || firstData.count || 0;
  if (total > 250) {
    const pages = Math.ceil(total / 250);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        fetch(`${API}/cards?q=set.id:${setId}&pageSize=250&page=${i+2}`, { headers: apiHeaders() })
          .then(r => r.json())
      )
    );
    for (const r of rest) all = all.concat(r.data || []);
  }

  // Deduplicate
  const seen = new Set();
  all = all.filter(c => { if(seen.has(c.id)) return false; seen.add(c.id); return true; });

  // Sort
  return all.sort((a, b) => {
    const na = parseInt(a.number), nb = parseInt(b.number);
    const aNum = !isNaN(na), bNum = !isNaN(nb);
    if(aNum && bNum) return na !== nb ? na - nb : a.number.localeCompare(b.number);
    if(aNum) return -1; if(bNum) return 1;
    return a.number.localeCompare(b.number);
  });
}

// GET /api/cards/:setId  — returns cards + sku prices merged
app.get('/api/cards/:setId', async (req, res) => {
  const { setId } = req.params;
  const now = Date.now();
  // Serve from memory cache first (fastest)
  if (cache.cards[setId]?.data) {
    return res.json(cache.cards[setId].data);
  }
  // Try disk cache (fast)
  const diskData = loadSetCards(setId);
  if (diskData) {
    cache.cards[setId] = { data: diskData, at: now };
    return res.json(diskData);
  }
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
    // TCGTracking uses formats like "007/165", pokemontcg uses "1" or "007"
    // Build a lookup that tries multiple formats
    const totalCards = cards.length;
    function findSkuPrice(cardNumber) {
      if (!cardNumber) return null;
      const n = cardNumber;
      const nInt = parseInt(n);
      // Try exact match first
      if (skuPrices[n]) return skuPrices[n];
      // Try padded with /total e.g. "007/165"
      for (const key of Object.keys(skuPrices)) {
        const keyNum = parseInt(key);
        if (keyNum === nInt) return skuPrices[key];
      }
      return null;
    }
    const merged = cards.map(c => ({
      ...c,
      skuPrices: findSkuPrice(c.number)
    }));

    cache.cards[setId] = { data: merged, at: now };
    saveSetCards(setId, merged);
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
      // Pre-cache most recent 10 sets immediately, rest in background
      const allSets = cache.sets;
      const immediate = allSets.slice(0, 10);
      const background = allSets.slice(10);

      // Cache first 10 sets immediately
      for (const s of immediate) {
        if (!cache.cards[s.id] || !cache.cards[s.id].data) {
          try {
            console.log(`   Pre-caching ${s.name}...`);
            const cards = await fetchSet(s.id);
            const tcgId = await resolveTcgTrackId(s);
            let skuPrices = {};
            if (tcgId) skuPrices = await fetchSkuPrices(tcgId);
            const totalCards2 = cards.length;
            function findSkuPrice2(cardNumber) {
              if (!cardNumber) return null;
              const nInt = parseInt(cardNumber);
              if (skuPrices[cardNumber]) return skuPrices[cardNumber];
              for (const key of Object.keys(skuPrices)) {
                if (parseInt(key) === nInt) return skuPrices[key];
              }
              return null;
            }
            const prewarmData = cards.map(c => ({ ...c, skuPrices: findSkuPrice2(c.number) }));
            cache.cards[s.id] = { data: prewarmData, at: Date.now() };
            saveSetCards(s.id, prewarmData);
            saveCache(cache);
            console.log(`   ✓ ${s.name} (${cards.length} cards)`);
          } catch(e) { console.log(`   ⚠ ${s.name}:`, e.message); }
        } else {
          console.log(`   ✓ ${s.name} (cached)`);
        }
      }

      // Cache remaining sets in background without blocking
      (async () => {
        let bgCount = 0;
        for (const s of background) {
          if (!cache.cards[s.id] || !cache.cards[s.id].data) {
            try {
              const cards = await fetchSet(s.id);
              const tcgId = await resolveTcgTrackId(s);
              let skuPrices = {};
              if (tcgId) skuPrices = await fetchSkuPrices(tcgId);
              function findSkuPrice3(cardNumber) {
                if (!cardNumber) return null;
                const nInt = parseInt(cardNumber);
                if (skuPrices[cardNumber]) return skuPrices[cardNumber];
                for (const key of Object.keys(skuPrices)) {
                  if (parseInt(key) === nInt) return skuPrices[key];
                }
                return null;
              }
              const data = cards.map(c => ({ ...c, skuPrices: findSkuPrice3(c.number) }));
              cache.cards[s.id] = { data, at: Date.now() };
              saveSetCards(s.id, data);
              saveCache(cache);
              bgCount++;
              // Delay to avoid rate limiting
              await new Promise(r => setTimeout(r, 300));
            } catch(e) {
              // retry once after longer delay
              await new Promise(r => setTimeout(r, 2000));
              try {
                const cards = await fetchSet(s.id);
                cache.cards[s.id] = { data: cards, at: Date.now() };
                saveSetCards(s.id, cards);
                bgCount++;
              } catch(e2) {}
            }
          } else {
            bgCount++;
          }
        }
        console.log(`   ✓ Background cache complete: ${bgCount} sets ready`);
      })();
    } catch(e) { console.log('   ⚠ Prewarm failed:', e.message); }
  }
  prewarm();
});
