import test from 'node:test';
import assert from 'node:assert/strict';
import { isHoloRarity } from './holoFoil.js';

test('holographic rarities get the foil', () => {
  for (const rarity of ['Rare Holo', 'Rare Holo EX', 'Reverse Holofoil', 'Ultra Rare', 'Secret Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Double Rare ex', 'Rare Holo VMAX', 'Rare Holo V', 'Rare Holo GX', 'Rare BREAK']) {
    assert.equal(isHoloRarity(rarity), true, rarity);
  }
});

test('plain rarities stay matte', () => {
  for (const rarity of ['Common', 'Uncommon', 'Rare', 'Promo', '', null, undefined, 42]) assert.equal(isHoloRarity(rarity), false, String(rarity));
});
