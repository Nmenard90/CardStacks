'use strict';
const express      = require('express');
const path         = require('path');
const cache        = require('./lib/cardCache');
const pokemonApi   = require('./lib/pokemonApi');
const priceService = require('./lib/priceService');
const Storage      = require('./lib/storage');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Page routes (serve HTML) ──────────────────────────────────────────────
const CLIENT_DIR = path.join(__dirname, '..');
const page = file => (req, res) => res.sendFile(path.join(CLIENT_DIR, file));

app.get('/',        page('index.html'));
app.get('/shelf',   page('shelf.html'));
app.get('/binder',  page('binder.html'));
app.get('/analyzer',page('analyzer.html'));

// ── API routes ────────────────────────────────────────────────────────────
app.use('/api',            require('./routes/cards'));
app.use('/api',            require('./routes/collection'));
app.use('/api/binders',    require('./routes/binders'));
app.use('/api/admin',      require('./routes/admin'));

// ── Static assets ─────────────────────────────────────────────────────────
app.use(express.static(CLIENT_DIR));

// ── Startup ───────────────────────────────────────────────────────────────
async function startup() {
  console.log(`\n🚀 PokéTracker starting on port ${PORT}`);
  console.log(`   Storage: ${Storage.PERSIST_DIR}`);

  // Clear cache if requested
  if (process.env.CLEAR_CACHE === 'true') {
    cache.clearAll();
    console.log('   ✓ Cache cleared');
  }

  // Load sets — try disk first, then API with retries
  let sets = cache.getSets();
  if (!sets || cache.setsExpired()) {
    const fromDisk = Storage.loadSetsFile();
    if (fromDisk) {
      cache.setSets(fromDisk);
      sets = fromDisk;
      console.log(`   ✓ ${sets.length} sets loaded from disk`);
    } else {
      // Retry API up to 3 times with increasing delay
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 2000));
          sets = await pokemonApi.fetchSets();
          cache.setSets(sets);
          Storage.saveSetsFile(sets);
          console.log(`   ✓ ${sets.length} sets fetched from API`);
          break;
        } catch (e) {
          console.error(`   ✗ Sets fetch attempt ${attempt}/3 failed: ${e.message}`);
        }
      }
    }
  } else {
    console.log(`   ✓ ${sets.length} sets in cache`);
  }

  // Pre-warm sets in background
  if (sets?.length) {
    prewarm(sets).catch(e => console.error('Prewarm error:', e.message));
  }

  app.listen(PORT, () => console.log(`   ✓ Listening on port ${PORT}\n`));
}

async function prewarm(sets) {
  let loaded = 0, fetched = 0;
  const delay = ms => new Promise(r => setTimeout(r, ms));

  for (const set of sets) {
    if (cache.hasCards(set.id)) {
      loaded++;
      continue;
    }
    try {
      const cards  = await pokemonApi.fetchCards(set.id);
      const prices = await priceService.getPricesForSet(set.id, set);
      const merged = priceService.mergeIntoCards(cards, prices);
      cache.setCards(set.id, merged);
      fetched++;
      console.log(`   ✓ ${set.name} (${merged.length} cards)`);
      await delay(300); // avoid rate limiting
    } catch (e) {
      console.log(`   ⚠ ${set.name}: ${e.message}`);
      await delay(1000);
    }
  }

  console.log(`\n   ✓ Prewarm complete: ${loaded} from cache, ${fetched} fetched\n`);
}

startup();
