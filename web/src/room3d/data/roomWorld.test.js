/**
 * Layout + world-model tests — run with `node --test "src/data/*.test.js"`.
 * (Never a bare `node --test`: it also discovers the browser scripts in scripts/.)
 * The central guarantee: no item in the collection is ever unreachable because
 * of what the 3D furniture can fit — every placed binder/box can be paged into
 * view, and every unplaced one is listed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_PRESETS, SHELF_PRESETS } from './contracts.js';
import { createLocalRepository } from './localRepository.js';
import { seedDevFixture } from './fixtures.js';
import { DEFAULT_NAV, DISPLAY_PAGE_SIZE, revealNav, toWorldModel } from './roomWorld.js';
import {
  BINDER_STYLE, BOX_STYLE, binderPlacement, boxPlacement, locate, pageFor, planWindow, windowSizes,
} from '../room/unitLayout.js';
import { LABEL_SPECS, atlasLayout, wrapLines } from '../room/labelAtlas.js';

const U = 'local-user';
const newRepo = () => createLocalRepository({ now: () => '2026-10-23T12:00:00.000Z' });
const close = (actual, expected, eps = 0.011) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('with no units the zones draw the original furniture dimensions, empty', () => {
  const binders = planWindow(null, BINDER_STYLE);
  close(binders.frame.width, 3.5);
  assert.equal(binders.rows, 4);
  assert.equal(binders.cols, 10);
  close(binders.frame.height, 3.28, 0.02);
  const boxes = planWindow(null, BOX_STYLE);
  close(boxes.frame.width, 2.55);
  close(boxes.spacing, 0.74);
  assert.equal(boxes.rows, 4);
  assert.equal(boxes.cols, 2);
});

test('window sizes follow stack height; big units page instead of growing', () => {
  assert.deepEqual(windowSizes({ shelfCount: 5, positionsPerShelf: 6, maxStackHeight: 4 }, BOX_STYLE), { stack: 4, spacing: 0.62 * 4 + 0.12, maxShelves: 1, maxPositions: 2, shelfPages: 5, positionPages: 3 });
  assert.equal(windowSizes({ shelfCount: 6, positionsPerShelf: 3, maxStackHeight: 2 }, BOX_STYLE).maxShelves, 2);
  assert.equal(windowSizes({ shelfCount: 6, positionsPerShelf: 3, maxStackHeight: 3 }, BOX_STYLE).maxShelves, 1);
  assert.equal(windowSizes({ shelfCount: 4, positionsPerShelf: 1, maxStackHeight: 1 }, BOX_STYLE).maxShelves, 4);
  const wide = planWindow({ shelfCount: 9, positionsPerShelf: 25, maxStackHeight: 1 }, BINDER_STYLE, { shelfPage: 99, positionPage: 99 });
  assert.deepEqual([wide.shelfPage, wide.positionPage, wide.rows, wide.cols], [2, 2, 1, 5], 'pages clamp; the last window is partial');
  assert.ok(wide.frame.width < 3.5, 'a partial window gets a smaller frame, not a gap');
});

test('every cell of a large unit belongs to exactly one window, in both zones', () => {
  for (const style of [BINDER_STYLE, BOX_STYLE]) {
    const unit = { shelfCount: 7, positionsPerShelf: 23, maxStackHeight: 3 };
    const sizes = windowSizes(unit, style);
    for (let shelf = 0; shelf < unit.shelfCount; shelf++) {
      for (let position = 0; position < unit.positionsPerShelf; position++) {
        let hits = 0;
        for (let sp = 0; sp < sizes.shelfPages; sp++) {
          for (let pp = 0; pp < sizes.positionPages; pp++) if (locate(planWindow(unit, style, { shelfPage: sp, positionPage: pp }), shelf, position)) hits++;
        }
        assert.equal(hits, 1, `${style.kind} cell ${shelf}:${position}`);
        const { shelfPage, positionPage } = pageFor(unit, style, shelf, position);
        assert.ok(locate(planWindow(unit, style, { shelfPage, positionPage }), shelf, position), 'pageFor finds the owning window');
      }
    }
  }
});

test('placements sit on their plank and inside the frame', () => {
  const plan = planWindow({ shelfCount: 4, positionsPerShelf: 10, maxStackHeight: 1 }, BINDER_STYLE);
  for (let row = 0; row < plan.rows; row++) {
    for (let col = 0; col < plan.cols; col++) {
      for (const variant of [0, 1, 2]) {
        const p = binderPlacement(plan, row, col, variant);
        close(p.y - p.height / 2, plan.frame.levels[row] + 0.05, 1e-9);
        assert.ok(p.y + p.height / 2 < plan.frame.levels[row + 1] - 0.05, 'clears the plank above');
        assert.ok(Math.abs(p.x) + p.width / 2 < plan.frame.width / 2 - 0.11, 'inside the side panels');
      }
    }
  }
  const stacked = planWindow({ shelfCount: 2, positionsPerShelf: 2, maxStackHeight: 3 }, BOX_STYLE);
  const top = boxPlacement(stacked, 0, 0, 2);
  const lidTop = top.y + 0.255 + 0.065; // lid centre is 0.255 above the body centre, 0.13 thick
  assert.ok(lidTop < stacked.frame.levels[1] - 0.05, 'a full stack clears the plank above');
  assert.ok(Math.abs(boxPlacement(stacked, 0, 0, 1).y - boxPlacement(stacked, 0, 0, 0).y - 0.62) < 1e-9, 'stack pitch');
});

test('an empty collection still describes complete empty furniture', () => {
  const world = toWorldModel(newRepo().getState());
  assert.equal(world.zones.binders.unit, null);
  assert.equal(world.zones.binders.plan.cols, 10);
  assert.deepEqual([world.zones.binders.items, world.zones.boxes.items, world.displayCards], [[], [], []]);
  assert.equal(world.zones.display.case, null);
  assert.equal(world.meta.isEmpty, true);
  assert.equal(world.lookup.binder('nope'), null);
  assert.equal(world.lookup.box(null), null);
  assert.equal(world.lookup.displayCard('nope'), null);
});

test('a created unit sets the frame from CardStacks numbers; items land in their cells with names and colours', async () => {
  const repo = newRepo();
  const unit = await repo.createStorageUnit(U, { ...SHELF_PRESETS[1], spaceId: 'space-1', name: 'Wood shelf' }); // 4 × 5
  const binder = await repo.createBinder(U, 'A very long binder name that will not fit a spine', 'Nine', { accent: 'teal' });
  await repo.placeBinder(U, binder.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex: 2, shelfPosition: 4 });
  const world = toWorldModel(repo.getState());
  const zone = world.zones.binders;
  assert.equal(zone.unit.name, 'Wood shelf');
  assert.deepEqual([zone.plan.rows, zone.plan.cols], [4, 5]);
  close(zone.plan.frame.width, 5 * 0.31 + 0.4);
  assert.deepEqual(zone.items.map((i) => [i.name, i.row, i.col, i.color]), [['A very long binder name that will not fit a spine', 2, 4, '#1fb79a']]);
  assert.equal(zone.inUnit, 1);
});

test('the 300-binder / 400-box fixture is fully navigable: nothing is unreachable', async () => {
  const repo = newRepo();
  await seedDevFixture(repo, { binders: 300, boxes: 400 });
  const state = repo.getState();
  const started = performance.now();
  let world = toWorldModel(state);

  // Rendering stays bounded: every window holds a handful of items, never hundreds.
  const maxBinders = 4 * 10; const maxBoxes = 2 * 4 * 4;
  assert.ok(world.zones.binders.items.length <= maxBinders && world.zones.boxes.items.length <= maxBoxes);
  assert.equal(world.navigator.units.length, 19);

  // Every PLACED binder and box can be paged into view and then appears in the rendered window.
  let placedBinders = 0; let placedBoxes = 0; let worstItems = 0;
  for (const binder of state.binders.filter((b) => b.storageUnitId)) {
    const nav = revealNav(state, DEFAULT_NAV, 'binder', binder.id);
    world = toWorldModel(state, { nav });
    assert.ok(world.zones.binders.items.some((i) => i.id === binder.id), `binder ${binder.id} reachable`);
    assert.equal(revealNav(state, nav, 'binder', binder.id), nav, 'revealing a visible item changes nothing');
    worstItems = Math.max(worstItems, world.zones.binders.items.length);
    placedBinders++;
  }
  for (const box of state.boxes.filter((b) => b.storageUnitId)) {
    const nav = revealNav(state, DEFAULT_NAV, 'box', box.id);
    world = toWorldModel(state, { nav });
    assert.ok(world.zones.boxes.items.some((i) => i.id === box.id), `box ${box.id} reachable`);
    worstItems = Math.max(worstItems, world.zones.boxes.items.length);
    placedBoxes++;
  }
  // Every UNPLACED one is listed and resolvable.
  const { unplaced } = world.navigator;
  assert.equal(placedBinders + unplaced.binders.length, 300);
  assert.equal(placedBoxes + unplaced.boxes.length, 400);
  for (const item of [...unplaced.binders, ...unplaced.boxes]) {
    const resolved = item.kind === 'binder' ? world.lookup.binder(item.id) : world.lookup.box(item.id);
    assert.ok(resolved && resolved.placed === false && resolved.name.startsWith('[DEV]'));
  }
  // Every displayed card can be paged in.
  let displayed = 0;
  for (const allocation of state.allocations.filter((a) => a.displaySlotId)) {
    const nav = revealNav(state, DEFAULT_NAV, 'display', allocation.displaySlotId);
    world = toWorldModel(state, { nav });
    assert.ok(world.displayCards.some((c) => c.id === allocation.displaySlotId), 'displayed card reachable');
    displayed++;
  }
  console.log(`  navigated ${placedBinders} binders, ${placedBoxes} boxes, ${unplaced.binders.length + unplaced.boxes.length} unplaced, ${displayed} displayed cards; largest window ${worstItems} items; ${Math.round(performance.now() - started)} ms`);
});

test('display cases page five slots at a time and reveal puts the right slot on screen', async () => {
  const repo = newRepo();
  repo.registerCards([{ id: 'c1', setId: 's', name: 'Showpiece', number: '1', images: { small: 'a', large: 'b' } }]);
  const displayCase = await repo.createDisplayCase(U, { ...DISPLAY_PRESETS[1], spaceId: 'space-1', name: 'Cabinet' }); // 9 slots
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 2 });
  await repo.placeCopies(U, { lotId: lot.id, displaySlotId: displayCase.slots[7].id, quantity: 1 });
  await repo.placeCopies(U, { lotId: lot.id, displaySlotId: displayCase.slots[1].id, quantity: 1 });
  const state = repo.getState();
  let world = toWorldModel(state);
  assert.equal(world.zones.display.pageCount, 2);
  assert.equal(DISPLAY_PAGE_SIZE, 5);
  assert.deepEqual(world.displayCards.map((c) => c.displayIndex), [1]);
  const nav = revealNav(state, DEFAULT_NAV, 'display', displayCase.slots[7].id);
  world = toWorldModel(state, { nav });
  assert.equal(world.zones.display.page, 1);
  assert.deepEqual(world.displayCards.map((c) => [c.displayIndex, c.name]), [[2, 'Showpiece']]);
  assert.equal(world.lookup.displayCard(displayCase.slots[7].id).displayIndex, 2);
  assert.equal(world.lookup.displayCard(displayCase.slots[0].id), null, 'empty slots resolve to nothing');
});

test('label atlas: every cell is distinct, inside the texture, and long names wrap instead of overflowing', () => {
  for (const kind of ['binders', 'boxes']) {
    const spec = LABEL_SPECS[kind];
    const layout = atlasLayout(40, spec);
    assert.equal(layout.cells.length, 40);
    assert.ok(layout.width <= 4096 && layout.height <= 4096, 'fits a common GPU texture limit');
    assert.equal(new Set(layout.cells.map((c) => `${c.x},${c.y}`)).size, 40, 'no two labels share a cell');
    for (const c of layout.cells) {
      assert.ok(c.u0 >= 0 && c.u1 <= 1 && c.vBottom >= 0 && c.vTop <= 1 && c.u1 > c.u0 && c.vTop > c.vBottom);
      assert.ok(c.x + spec.cellW <= layout.width && c.y + spec.cellH <= layout.height);
    }
  }
  assert.deepEqual(atlasLayout(0, LABEL_SPECS.boxes).cells, []);
  const measure = (text) => text.length * 10; // fixed-width stand-in for canvas text metrics
  assert.deepEqual(wrapLines(measure, 'Trade Night binder', 120), ['Trade Night', 'binder']);
  assert.deepEqual(wrapLines(measure, 'Supercalifragilistic', 100), ['Supercalif', 'ragilistic'], 'a single long word breaks by character');
  assert.deepEqual(wrapLines(measure, '', 100), ['']);
});
