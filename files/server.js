const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(__dirname, 'cache.json');
const API = 'https://api.pokemontcg.io/v2';
const apiHeaders = () => process.env.POKEMONTCG_API_KEY ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY } : {};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(express.json());
app.use(express.static(__dirname));

// Cache helpers
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { return { sets: null, setsAt: 0, cards: {} }; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}
let cache = loadCache();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Collection helpers — one file per user
function colFile(user) {
  return path.join(DATA_DIR, `collection_${user.replace(/[^a-z0-9_-]/gi, '_')}.json`);
}
function loadCollection(user) {
  try { return JSON.parse(fs.readFileSync(colFile(user), 'utf8')); }
  catch { return {}; }
}
function saveCollection(user, data) {
  fs.writeFileSync(colFile(user), JSON.stringify(data, null, 2));
}

// List users
app.get('/api/users', (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('collection_'));
  const users = files.map(f => f.replace('collection_', '').replace('.json', ''));
  res.json(users);
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

async function fetchSet(setId) {
  const first = await fetch(`${API}/cards?q=set.id:${setId}&orderBy=number&pageSize=250&page=1`, { headers: apiHeaders() });
  const firstData = await first.json();
  if (!firstData.data) throw new Error(JSON.stringify(firstData));
  let all = [...firstData.data];
  const total = firstData.totalCount;
  if (total > 250) {
    const pageCount = Math.ceil(total / 250);
    const pageNums = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
    const results = await Promise.all(
      pageNums.map(p =>
        fetch(`${API}/cards?q=set.id:${setId}&orderBy=number&pageSize=250&page=${p}`, { headers: apiHeaders() })
          .then(r => r.json())
      )
    );
    for (const r of results) all = all.concat(r.data || []);
  }
  return all.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
}

// GET /api/cards/:setId
app.get('/api/cards/:setId', async (req, res) => {
  const { setId } = req.params;
  const now = Date.now();
  if (cache.cards[setId] && (now - cache.cards[setId].at) < CACHE_TTL)
    return res.json(cache.cards[setId].data);
  try {
    const all = await fetchSet(setId);
    cache.cards[setId] = { data: all, at: now };
    saveCache(cache);
    res.json(all);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/collection/:user
app.get('/api/collection/:user', (req, res) => {
  res.json(loadCollection(req.params.user));
});

// POST /api/collection/:user  { id, qty, price, setId, name }
app.post('/api/collection/:user', (req, res) => {
  const col = loadCollection(req.params.user);
  const { id, qty, price, setId, name } = req.body;
  if (!col[id]) col[id] = {};
  if (qty !== undefined) col[id].qty = Math.max(0, qty);
  if (price !== undefined) col[id].price = price;
  if (setId) col[id].setId = setId;
  if (name) col[id].name = name;
  saveCollection(req.params.user, col);
  res.json({ ok: true });
});

// POST /api/collection/:user/bulk  [{ id, qty, price, setId, name }]
app.post('/api/collection/:user/bulk', (req, res) => {
  const col = loadCollection(req.params.user);
  for (const item of req.body) {
    const { id, qty, price, setId, name } = item;
    if (!col[id]) col[id] = {};
    if (qty !== undefined) col[id].qty = Math.max(0, qty);
    if (price !== undefined) col[id].price = price;
    if (setId) col[id].setId = setId;
    if (name) col[id].name = name;
  }
  saveCollection(req.params.user, col);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n✅  Pokémon Tracker running at http://localhost:${PORT}\n`);
  console.log('   Open that URL in your browser.\n');
  console.log('   Press Ctrl+C to stop.\n');

  // Prefetch sets + top sets on startup so first user request is instant
  async function prewarm() {
    // sets
    if (!cache.sets || (Date.now() - cache.setsAt) >= CACHE_TTL) {
      try {
        const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=250`, { headers: apiHeaders() });
        const data = await r.json();
        cache.sets = data.data;
        cache.setsAt = Date.now();
        saveCache(cache);
        console.log(`   ✓ Cached ${data.data.length} sets.`);
        // pre-cache the 5 most recent sets in background
        const recent = data.data.slice(0, 5);
        for (const s of recent) {
          if (!cache.cards[s.id] || (Date.now() - cache.cards[s.id].at) >= CACHE_TTL) {
            try {
              console.log(`   Pre-caching ${s.name}...`);
              const cards = await fetchSet(s.id);
              cache.cards[s.id] = { data: cards, at: Date.now() };
              saveCache(cache);
              console.log(`   ✓ Cached ${s.name} (${cards.length} cards)`);
            } catch(e) { console.log(`   ⚠ Could not cache ${s.name}:`, e.message); }
          }
        }
      } catch(e) { console.log('   ⚠ Could not pre-load sets:', e.message); }
    } else {
      console.log(`   ✓ Sets already cached (${cache.sets.length} sets).`);
    }
  }
  prewarm();

});
