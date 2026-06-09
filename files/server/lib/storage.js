'use strict';
const fs   = require('fs');
const path = require('path');

// Use Railway /data volume if available, else fall back to repo root
const PERSIST_DIR  = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../..');
const DATA_DIR     = path.join(PERSIST_DIR, 'data');
const CARD_DIR     = path.join(PERSIST_DIR, 'card-data');
const CACHE_FILE   = path.join(PERSIST_DIR, 'cache.json');

// Ensure base directories exist on startup
[DATA_DIR, CARD_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

class Storage {

  // ── Paths ────────────────────────────────────────────────────────────────
  static get DATA_DIR()    { return DATA_DIR; }
  static get CARD_DIR()    { return CARD_DIR; }
  static get PERSIST_DIR() { return PERSIST_DIR; }

  static _safeUser(user) { return user.replace(/[^a-z0-9_-]/gi, '_'); }

  // ── Collections ──────────────────────────────────────────────────────────
  static collectionFile(user) {
    return path.join(DATA_DIR, `collection_${this._safeUser(user)}.json`);
  }
  static loadCollection(user) {
    try { return JSON.parse(fs.readFileSync(this.collectionFile(user), 'utf8')); }
    catch { return {}; }
  }
  static saveCollection(user, data) {
    fs.writeFileSync(this.collectionFile(user), JSON.stringify(data, null, 2));
  }
  static listUsers() {
    try {
      return fs.readdirSync(DATA_DIR)
        .filter(f => f.startsWith('collection_') && f.endsWith('.json'))
        .map(f => f.slice('collection_'.length, -'.json'.length));
    } catch { return []; }
  }

  // ── Binders ──────────────────────────────────────────────────────────────
  static binderDir(user) {
    const d = path.join(DATA_DIR, `binders_${this._safeUser(user)}`);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }
  static loadBinders(user) {
    const dir = this.binderDir(user);
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  static loadBinder(user, id) {
    return JSON.parse(fs.readFileSync(path.join(this.binderDir(user), `${id}.json`), 'utf8'));
  }
  static saveBinder(user, id, data) {
    fs.writeFileSync(path.join(this.binderDir(user), `${id}.json`), JSON.stringify(data, null, 2));
  }
  static deleteBinder(user, id) {
    fs.unlinkSync(path.join(this.binderDir(user), `${id}.json`));
  }

  // ── Card data files ───────────────────────────────────────────────────────
  static cardFilePath(setId)  { return path.join(CARD_DIR, `${setId}.json`); }
  static setsFilePath()       { return path.join(CARD_DIR, '_sets.json'); }

  static loadCardFile(setId) {
    try { return JSON.parse(fs.readFileSync(this.cardFilePath(setId), 'utf8')); }
    catch { return null; }
  }
  static saveCardFile(setId, data) {
    fs.writeFileSync(this.cardFilePath(setId), JSON.stringify(data));
  }
  static deleteCardFile(setId) {
    try { fs.unlinkSync(this.cardFilePath(setId)); } catch {}
  }
  static listCardFiles() {
    try {
      return fs.readdirSync(CARD_DIR)
        .filter(f => f.endsWith('.json') && f !== '_sets.json')
        .map(f => f.slice(0, -'.json'.length));
    } catch { return []; }
  }

  static loadSetsFile()       { try { return JSON.parse(fs.readFileSync(this.setsFilePath(), 'utf8')); } catch { return null; } }
  static saveSetsFile(data)   { fs.writeFileSync(this.setsFilePath(), JSON.stringify(data, null, 2)); }

  // ── App cache (metadata only — card data lives in files) ─────────────────
  static loadCache() {
    try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
    catch { return { sets: null, setsAt: 0, cards: {}, prices: {}, tcgSets: null, tcgSetsAt: 0 }; }
  }
  static saveCache(cache) {
    const slim = { ...cache, cards: {} };
    for (const [id, v] of Object.entries(cache.cards || {})) {
      slim.cards[id] = { at: v.at, count: v.data?.length || 0 };
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(slim));
  }
  static clearCache() {
    try { fs.unlinkSync(CACHE_FILE); } catch {}
    this.listCardFiles().forEach(id => this.deleteCardFile(id));
    try { fs.unlinkSync(this.setsFilePath()); } catch {}
  }
}

module.exports = Storage;
