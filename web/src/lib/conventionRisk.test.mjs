/** Tests for lib/conventionRisk.ts (Node strips the types). Run: npm run test:lib */
import assert from 'node:assert/strict'
import test from 'node:test'
import { dealRisk } from './conventionRisk.ts'

const card = { name: 'Bidoof', rarity: 'Common', setId: 'sv1', releaseYear: 2023, market: 0.1, ask: 0, condition: 'NM' }

test('different cards get different risk (it used to be Medium for every card)', () => {
  const cheap = dealRisk(card)
  const chase = dealRisk({ ...card, name: 'Charizard ex', rarity: 'Special Illustration Rare', market: 120 })
  const vintage = dealRisk({ ...card, name: 'Charizard', rarity: 'Rare Holo', setId: 'base1', releaseYear: 1999, market: 600 })
  assert.equal(cheap.label, 'Low')
  assert.equal(chase.label, 'High')
  assert.equal(vintage.label, 'High')
  assert(vintage.score > chase.score && chase.score > cheap.score)
  assert.match(cheap.reasons[0], /rarely faked/)
  assert(chase.reasons.some(r => /most-faked/.test(r)) && chase.reasons.some(r => /chase rarities/.test(r)))
  assert(vintage.reasons.some(r => /Vintage card \(1999\)/.test(r)))
})

test('an ask far under market raises the risk, with the reason', () => {
  const mid = { ...card, name: 'Lapras', rarity: 'Rare', market: 40, condition: 'LP' }
  assert.equal(dealRisk(mid).label, 'Medium')
  const tooCheap = dealRisk({ ...mid, ask: 15 })
  assert.equal(tooCheap.label, 'High')
  assert(tooCheap.reasons.some(r => /63% under market/.test(r)))
  assert.equal(dealRisk({ ...mid, ask: 30 }).score, dealRisk(mid).score + 12, 'a 25% discount is worth a question')
  assert.equal(dealRisk({ ...mid, ask: 39 }).score, dealRisk(mid).score, 'a fair ask adds nothing')
})

test('whole names only, and vintage by set when the year is unknown', () => {
  assert(!dealRisk({ ...card, name: 'Mewtwo' }).reasons.some(r => /^Mew is/.test(r)))
  assert(dealRisk({ ...card, name: 'Mewtwo' }).reasons.some(r => /^Mewtwo is/.test(r)))
  assert(!dealRisk({ ...card, name: 'Pikachuish' }).reasons.some(r => /most-faked/.test(r)))
  assert(dealRisk({ ...card, setId: 'neo1', releaseYear: undefined }).reasons.some(r => /^Vintage card:/.test(r)))
})
