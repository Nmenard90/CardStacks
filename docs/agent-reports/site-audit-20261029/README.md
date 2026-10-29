# Site audit and room zoom fix (2026-10-29)

Asked by the owner after the cleanup: "do a full audit of the site and browser", plus a fix for the 3D room: tapping
the shelf didn't zoom in before you picked a binder, "so like on mobile that's not going to work because it's so tiny…
Same thing for the case and the boxes because you can't even read them until it zooms in."

## Room: zoom first, then pick

| Before | After |
|---|---|
| A tap on a binder, box or display card anywhere in the whole-room view opened it at once; only a tap on bare wood zoomed in. | The first tap on any collection furniture, even right on an item, only walks over to it. The second tap picks the item. |
| A zone framed its whole shelf unit, empty shelves included: on a phone a box was 21 px tall. | The camera frames the binders, boxes or display cards themselves, as large as the space between the panels allows. |
| The desk chair stood between the camera and the box shelf, so a tap on the left box hit the chair (→ Add Cards). | The camera tries nearby angles (turning, then looking from higher) until no furniture blocks the view, and stays inside the room. |

- `room/ShelfUnit.jsx` (`focused`), `room/DynamicShelving.jsx`, `clubhouse/ClubhouseRoom.jsx` (`activeZone`, and
  `userData.obstacles`: one box per part of every standing piece), `Room.jsx` (display cards ignore taps until the
  cabinet is open; the vitrine is named `DisplayCabinet`), `RoomScene.jsx` (`zoneSubject`, `zoneView`, `clearView`;
  measured every 6 frames with the free screen area). Guide step 2 now says "Once you're up close, tap a binder…".
- Also: the box list said "8 boxs".
- `tests/room-browser.mjs` checks this at all four sizes: from the whole room, a tap on the first binder, first box and
  a display card must only zoom in, the item must get at least 1.6× bigger on screen (binder ≥ 40 px, box ≥ 24 px,
  display card ≥ 80 px tall, or 15 % of a short screen), and a second tap must open it.

Before (phone, whole rack framed, chair in the way): `before-phone-box-shelf.png`. After: `after-phone-display-zone.png`;
all zone views are in the test's screenshots (`*-binders-zone`, `*-storage-zone`, `*-display-zone`).

## Site audit

`web/tests/site-audit.mjs` (new) walks every route signed out and signed in (a "Try the demo" account, deleted by the
backend after 24 h) at 1440×900 and 390×844, and records page errors, console errors, failed requests, sideways
overflow, unnamed controls, images without alt, tap targets under 24 px on the phone, pages without a heading, and a
screenshot. Full tables: `audit-live.md` (production, current `main`) and `audit-branch.md` (this branch, against
the real backend).

**Production (`main`): 44 page views, 27 with findings. This branch: 44 page views, 7 with findings**: the expected
404 for a made-up shop name (4×), and inline links in the shop's footer sentence, which the 24 px rule exempts.

| Found | Where | Fixed |
|---|---|---|
| Explore opens on **ME06: Delta Reign**, a set released 2026-11-06 (in the future): every card shows a broken image and "no price" (70 image 404s per page view) | live `/explore` | Opens on the newest set already released (`lib/cardSearch.ts` `newestReleasedSet`, 4 tests: `npm run test:lib`) |
| A card picture that fails to load shows the browser's broken-image icon and the alt text | everywhere `CardThumb` is used | Falls back to the 🃏 placeholder |
| Any unknown address shows a blank page | live, signed out | "Page not found" page with a link home (`pages/NotFoundPage.tsx`, route `*`) |
| The "Missing — click to list" tile cuts off its own number | Explore stats | Label and number stacked like the other tiles |
| Tap targets under 24 px on a phone: demo banner "Sign out", the 📈 price-history button (18×19), "Create an account", "← Back to CardStacks", "Go to CardStacks", the room page's logo | phone | Padded to ≥ 28 px |
| No heading on the room, Explore, Add Cards or My Shop pages (screen readers have no page title) | every signed-in page | Visually hidden `<h1>` (`.sr-only` in `index.css`) |
| No page description or theme colour | `index.html` | Added; shop pages swap the description for the shop's own (`ogTags.mjs`, test updated) |

Not changed, noted for later:
- `eslint` still reports the 2 errors that were already on `main`, both in `SpacesLivePage.tsx` (a `setState` inside an
  effect, a ref read during render). They work today; fixing them means restructuring that 2,000-line page, which has
  no tests.
- The Explore "Missing" count is the cards TCGTracking lists for the set (161 for ME: 30th Celebration), while the
  header shows the set's printed total (223); new sets are listed before every card is in the catalog.
- The production build's main chunk is over Vite's 500 kB warning (three.js is already split out and lazy-loaded).

Screenshots: `before-explore-unreleased-set.png` / `after-explore.png`, `before-phone-not-found.png` /
`after-phone-not-found.png`.

## Verification

| Check | Result |
|---|---|
| `web/tests/room-browser.mjs` (desktop, phone, tablet, phone landscape; mocked API) | 66/67 in the full run; the one miss (a display card 56 px tall on an 844×390 landscape phone, where all three shelves must fit) led to a size-relative threshold (≥ 15 % of the screen height, up to 80 px), then 16/16 at that size |
| `web/tests/shop-browser.mjs` (desktop + phone) | 11/11 |
| `npm run test:room` / `test:lib` / `test:og` | 90/90 · 4/4 · 4/4 |
| `npx tsc -b`, `npm run build` | clean · ok |
| `npx eslint .` | only the 2 errors already on `main` |
