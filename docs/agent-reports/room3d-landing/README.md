# 3D room as the landing page (`feat/3d-room`, 2026-10-29)

## What shipped in this branch

- **`/` is now the 3D collector's room** (the Clubhouse prototype from
  `D:\Projects\CardStacks\experiments\nook-concept`, ported into `web/src/room3d/`).
  It draws the signed-in user's **real** binders, card boxes (with compartments)
  and display cases, with real prices. The prototype's example data, local
  repository, Add panel and in-room catalog are not shipped.
- **Spaces (the list view) moved to `/spaces`.** Old links (`/?area=…&box=…`),
  bookmarks and the back-stack redirect there; `/shelf`, `/owned` and
  `/spaces/default/storage` point there too. HeaderNav: 🏠 Room, 📦 Spaces, …
- **First-visit guide** (`room3d/RoomGuide.tsx`): four illustrated, animated
  steps (tap furniture → open things → swipe through cards → desk/pinboard/window
  go to the rest of the site). Opens on first visit, reopens from the **?** on
  the room's status chip, remembered per browser (`cardstacks.roomGuide.v1`),
  still under reduced motion.
- **What the furniture does:** box shelf / bookcase / cabinet open their zone;
  a binder opens as a 3D book, a box as a card rolodex, a displayed card comes
  forward. Desk → Add Cards, pinboard → My Shop, coffee table → Analyzer, card
  table → Convention, window and "04 Explore" → Explore. Panels link to the full
  pages (`/binder/:id`, Spaces box/case) for managing things.
- **One write in the room:** filling an empty binder pocket (your own cards, or
  a catalog search) uses the exact call the binder page makes
  (`PUT /api/binders/:userId/:binderId/slot/:n`).
- **Card art relay** `GET /card-art?u=` (`web/cardArt.mjs`, used by `server.mjs`
  and the Vite dev server): TCGplayer's CDN sends no CORS headers, so WebGL
  couldn't draw TCGTracking-set art (JP, newest English sets). Only the two
  TCGplayer image hosts over https, images only, 5 MB cap, 10 s timeout.

## How it fits the site

- 3D code is lazy-loaded (`RoomScene` chunk ≈ 314 KB gzip); other pages don't load three.js.
- Room CSS is scoped under `.room3d` at build time (`room3dCss.mjs` +
  postcss-prefix-selector in `vite.config.ts`), so it can't restyle other pages
  after a visit. Its viewport units are container units of the room area.
- No WebGL or a crash in the scene → a message with a link to Spaces.
- No backend change, no migration.

## Tests (all run on this branch)

| Check | Result |
|---|---|
| `npx tsc -b` | clean |
| `npx eslint .` | only the 2 errors already on `main` (SpacesLivePage lines 534/1866) |
| `npm run build` | ok |
| `npm run test:room` (room data/layout/foil/art + relay + CSS scoping unit tests) | 90/90 |
| `node --test ogTags.test.mjs` | pass |
| `tests/room-browser.mjs` — real Chromium/WebGL, mocked API, desktop 1440×900, phone 390×844 (touch), tablet 820×1180 (touch), phone landscape 844×390 (touch) | **55/55** (`browser-results.json`) |
| `tests/room-live-smoke.mjs` — real backend, fresh anonymous demo account | **6/6** (`live-results.json`) |

The browser test checks, at every size: the room loads and draws; nothing
overlaps or spills out of the room or under the phone tab bar; opening the
bookcase by tapping it; a binder card's price; filling a pocket (asserts the
PUT); catalog search in the picker; "Open binder page" and back; Esc/Back
stepping out; box compartments; TCGplayer art through the relay; tapping a
display card through the glass; desk → /add; Explore; old Spaces links; no
console errors. Screenshots for each are in this folder.

## Bugs found and fixed while testing

- drei `<Html>` unmounts synchronously → React 19 errors on every zone change.
  Replaced with `room/DomAnchor.jsx` (deferred unmount, pointer-transparent layer).
- That layer sat over the canvas and caught taps, so R3F aimed the ray from the
  wrong offset — display cards opened only when a DOM button happened to catch the tap.
- Clubhouse cabinet glass took the pointer ray before the cards behind it.
- Prototype phone CSS turned the status chip's last button into a "×" and hid the first.
- Zone views on tall screens backed the camera off as if fitting the whole room.
- Phone landscape: two-row header, side panel over the page bar and zone label,
  Add button off the bottom, oversized hit buttons selecting the neighbouring card.
- Raw box types ("auto_set:base1", "long-800") shown as labels.

## Test-harness notes

Software WebGL in headless Chrome draws a few frames a second, so the browser
test waits for rendered frames (camera still, target still for 8 frames —
longer than the 6-frame free-area re-measure) before tapping. Without that it
tapped where a binder card *was* while it was still sliding beside the opening
panel. On a failure it prints a trail of the last navigation/pointer events and
saves a `FAIL-*.png`.

## Not verified

- A real phone (touch and frame rate were emulated; WebGL here is software).
- The owner's own large collection: the room reads every box compartment and
  case (6 requests at a time); a very large account will take a few seconds on
  first load (later visits show the cached room at once and refresh behind it).
