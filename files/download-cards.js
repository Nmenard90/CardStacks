#!/usr/bin/env node
/**
 * download-cards.js
 * 
 * Run this once to download all Pokemon TCG card data.
 * Re-run whenever new sets are released.
 * 
 * Usage:
 *   node download-cards.js
 *   node download-cards.js --set sv9    (download one specific set)
 *   node download-cards.js --new        (only download sets not yet saved)
 * 
 * Requires: POKEMONTCG_API_KEY in environment (or .env file)
 * Output:   card-data/[setId].json for each set
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Load .env if present
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if(k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
} catch(e) {}

const API = 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMONTCG_API_KEY;
const OUT_DIR = path.join(__dirname, 'card-data');
const DELAY_MS = 200; // delay between requests to avoid rate limiting

if(!API_KEY) {
  console.warn('⚠  No POKEMONTCG_API_KEY set — requests will be rate limited');
}

const headers = API_KEY ? { 'X-Api-Key': API_KEY } : {};

if(!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const specificSet = args.includes('--set') ? args[args.indexOf('--set')+1] : null;
const newOnly = args.includes('--new');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllSets() {
  console.log('Fetching set list...');
  const r = await fetch(`${API}/sets?orderBy=-releaseDate&pageSize=250`, { headers });
  const data = await r.json();
  return data.data || [];
}

async function fetchSetCards(setId) {
  const first = await fetch(`${API}/cards?q=set.id:${setId}&pageSize=250&page=1`, { headers });
  const firstData = await first.json();
  if(!firstData.data) throw new Error(`No data for ${setId}: ${JSON.stringify(firstData)}`);
  
  let all = [...firstData.data];
  const total = firstData.totalCount || 0;
  
  if(total > 250) {
    const pages = Math.ceil(total / 250);
    for(let p = 2; p <= pages; p++) {
      await sleep(DELAY_MS);
      const r = await fetch(`${API}/cards?q=set.id:${setId}&pageSize=250&page=${p}`, { headers });
      const d = await r.json();
      all = all.concat(d.data || []);
    }
  }
  
  // Deduplicate by ID
  const seen = new Set();
  all = all.filter(c => { if(seen.has(c.id)) return false; seen.add(c.id); return true; });
  
  // Sort by number
  all.sort((a, b) => {
    const na = parseInt(a.number);
    const nb = parseInt(b.number);
    const aNum = !isNaN(na), bNum = !isNaN(nb);
    if(aNum && bNum) return na !== nb ? na - nb : a.number.localeCompare(b.number);
    if(aNum) return -1;
    if(bNum) return 1;
    return a.number.localeCompare(b.number);
  });
  
  return all;
}

async function main() {
  const sets = await fetchAllSets();
  console.log(`Found ${sets.length} sets`);
  
  // Save set list
  fs.writeFileSync(path.join(OUT_DIR, '_sets.json'), JSON.stringify(sets, null, 2));
  console.log('✓ Saved _sets.json');
  
  const toProcess = specificSet
    ? sets.filter(s => s.id === specificSet)
    : sets;
  
  if(specificSet && toProcess.length === 0) {
    console.error(`Set "${specificSet}" not found`);
    process.exit(1);
  }
  
  let done = 0, skipped = 0, failed = 0;
  
  for(const set of toProcess) {
    const outFile = path.join(OUT_DIR, `${set.id}.json`);
    
    if(newOnly && fs.existsSync(outFile)) {
      skipped++;
      continue;
    }
    
    try {
      process.stdout.write(`Fetching ${set.name} (${set.id}, ${set.total} cards)... `);
      const cards = await fetchSetCards(set.id);
      fs.writeFileSync(outFile, JSON.stringify(cards));
      console.log(`✓ ${cards.length} cards`);
      done++;
      await sleep(DELAY_MS);
    } catch(e) {
      console.log(`✗ FAILED: ${e.message}`);
      failed++;
    }
  }
  
  console.log(`\nDone! ${done} sets downloaded, ${skipped} skipped, ${failed} failed`);
  if(failed > 0) console.log('Re-run with --new to retry failed sets');
}

main().catch(e => { console.error(e); process.exit(1); });
