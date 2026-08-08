# PokéTracker Spaces — Product and Interaction Specification

## Purpose

Spaces is the logged-in landing page and physical-collection organizer for PokéTracker.

It should feel like entering a collector's room, while remaining fast and usable for collectors with anywhere from one box to more than 100 boxes. It is not a generic dashboard, a free-roaming 3D game, or a reskinned copy of the old Shelf page.

The interface should be dimensional, tactile, modern, smooth, and inspired by creature-collecting adventure games without copying protected Pokémon artwork, characters, logos, names, or trade dress.

## Non-negotiable product rules

1. **Add Cards is a standalone top-level page.** It is not part of Spaces and must use `/add`.
2. **Spaces contains three separate areas:** Storage, Binder Library, and Display Gallery.
3. These three areas must not all render the old Shelf page.
4. A full-page loading screen may appear only during initial login/page load. Background saves and navigation must not black out or refresh the page.
5. Boxes must represent real physical box formats, capacities, proportions, colors, and stack behavior.
6. Clicking a box must visibly open that box and enter its inventory. It must not open a fake drawer modal.
7. Cards are tracked by printed variant, edition, language, condition, and quantity.
8. Multiple copies are valid. Duplicate database rows for the same inventory lot are not.
9. A collector cannot allocate more copies than they own.
10. Every card image, everywhere on the site, needs a usable zoom/detail interaction on desktop and mobile.
11. The design must work with 100+ boxes without rendering one enormous wall of tiny objects.
12. Desktop and mobile require purpose-built layouts; mobile is not a scaled-down desktop room.

## Site-level navigation

The persistent main navigation should contain:

- **Spaces** → `/`
- **Explore** → `/explore`
- **Add Cards** → `/add`
- **Tools** → `/analyzer`
- **Convention** → `/convention`

Rules:

- Add Cards must never appear active as part of Spaces.
- Legacy `/bulk` should redirect to `/add`.
- Legacy `/shelf` and `/owned` should redirect to `/` or a documented migration destination.
- Navigation should update without a full browser refresh.
- Route changes and background API calls must preserve the page shell and avoid a black flash.

## Spaces landing page

### Header

- **MY SPACES logo/button:** returns to the Spaces landing view without refreshing.
- **User badge:** shows the logged-in collector.
- **Search field:** searches across spaces, boxes, binders, display cases, and card locations. Selecting a result navigates directly to that object.
- **Main navigation:** uses the site-level routes listed above.

### Primary Space card

The primary Space card represents the user's default collection room.

It shows:

- Space name.
- Space type.
- Number of storage units and boxes.
- Number of binders.
- Number of display cases and displayed cards.
- A visual room illustration that matches the site style.

The card contains three distinct destinations:

#### Storage

- Label must be **Storage**.
- Shows box and shelf-unit counts.
- Opens the Storage area inside the selected Space.

#### Binder Library

- Label must be **Binder Library**.
- Shows binder and filled-slot counts.
- Opens the Binder Library inside the selected Space.

#### Display Gallery

- Label must be **Display Gallery**.
- Shows display-case and occupied-slot counts.
- Opens the Display Gallery inside the selected Space.

### Other Spaces

- Lists every non-selected Space.
- Each card shows its name, type, storage count, binder count, and display count.
- Clicking a Space selects it and updates all three areas to that Space's data.
- `+ Add Space` opens an in-app creation panel, not a browser prompt.

### Add Space panel

Fields:

- Name.
- Type: Collection Room, Archive, Trade Station, Showcase, or Custom.
- Optional visual theme.
- Make default checkbox when allowed.

Actions:

- **Create Space:** saves through Scala and enters the new Space.
- **Cancel:** closes without mutation.
- Validation errors appear inside the panel.

## Space navigation

Once inside a Space, a persistent local navigation bar shows:

- Back to All Spaces.
- Storage with real count.
- Binder Library with real count.
- Display Gallery with real count.

Switching areas:

- Must not reload the browser.
- Must not show a full-page loading screen.
- Must preserve the selected Space.
- Must update only the content area.

## Storage area

### Storage overview

The overview shows storage furniture, not a flat list of boxes.

Each storage unit card shows:

- Name.
- Furniture preset/type.
- Number of shelves.
- Number of occupied stack positions.
- Number of boxes.
- Capacity usage summary.

Actions:

- **Add Shelf Unit:** opens the furniture picker.
- **Add Box:** opens the real-world box picker.
- Clicking a storage unit enters that unit.

### Shelf-unit picker

Presets:

- Heavy-duty rack.
- Wood collection shelf.
- Enclosed cabinet.
- Closet storage.
- Custom shelf unit.

Each preset defines:

- Shelf count.
- Positions per shelf.
- Maximum vertical stack height.
- Physical visual style.
- Color/finish options.

Custom furniture fields:

- Name.
- Shelf count.
- Positions per shelf.
- Maximum box stack height.
- Color/finish.

Creating furniture must save it to the selected Space and show it immediately without a page blackout.

### Real-world box picker

The picker must be an in-app visual panel. Do not use `window.prompt`.

Required presets:

| Preset | Typical capacity | Visual requirement |
|---|---:|---|
| Deck box | 75–100 | Compact upright/front-facing deck box |
| Single-row long box | 800 | Narrow front, deep body |
| Two-row storage box | 1,600 | Two-row physical profile |
| Four-row monster box | 3,200 | Four internal rows/dividers |
| Five-row monster box | 5,000 | Five internal rows/dividers |
| Display-window organizer | Configurable | Visible front windows/dividers |
| Custom box | User-defined | User controls capacity and appearance |

Fields after choosing a preset:

- Box name.
- Color.
- Optional label text.
- Capacity, locked to preset unless Custom.
- Number of internal rows/dividers where applicable.
- Optional protection defaults.

Rules:

- Box proportions should be relatively square from the front because many boxes extend backward, not sideways.
- Different presets should visibly resemble their real physical formats.
- Boxes must not be drawn half inside shelf boards.
- Box color must persist.
- Creating a box should place it in the first valid open position or clearly leave it in an Unplaced area.
- A success message must identify its location.
- API failures must be visible.

### Shelf-unit view

Each shelf unit has:

- Clearly aligned horizontal shelf boards.
- Fixed stack positions per shelf.
- A visible maximum stack height.
- Front-facing boxes that visually extend backward.
- No floating furniture or boxes.

Box placement:

- Desktop: drag and drop a box into a stack position.
- Mobile: tap Move, then tap a valid destination.
- Dropping onto a stack places the box above existing boxes.
- Occupied levels cannot contain two boxes.
- Full stacks visibly reject placement.
- Moving a lower box must not leave impossible unsupported boxes without resolving the stack.
- Movement saves immediately but optimistically; failure restores the prior position and shows an error.
- Movement must not refresh or black out the page.

Scaling to 100+ boxes:

- Show shelf-unit summaries first.
- Enter one unit at a time.
- Allow search by box name, label, type, set, and contained card.
- Allow filters for full, nearly full, empty, unplaced, and custom.
- Virtualize or paginate extremely large lists.
- Do not render all 100 boxes at full detail on the landing page.

### Box appearance and state

Every box face shows:

- Name/label.
- Preset type.
- Current quantity and capacity.
- Color.
- Stack level.
- Capacity warning when nearly full or over capacity.

Hover/focus:

- Slight physical lift or highlight.
- No animation that clips into adjacent shelves.
- Accessible keyboard focus.

### Opening a box

Clicking/tapping a box:

1. Animates the selected physical box forward.
2. Opens its correct lid/flap/row configuration.
3. Transitions into an in-page box inventory workspace.
4. Keeps enough shelf context to make the physical location understandable.

It must not:

- Open a generic modal.
- Pretend the box is a chest of drawers.
- Jump instantly with no opening motion.
- Refresh the page.

### Box inventory workspace

Header:

- Back to shelf.
- Box name.
- Box preset/type.
- Physical location: Space → shelf unit → shelf → stack → level.
- Quantity used / capacity.
- Edit Box action.

Contents:

- Cards currently allocated to this box.
- Card image.
- Card name and set.
- Printed variant.
- Edition.
- Language.
- Condition.
- Quantity in this box.
- Protection state: raw, sleeved, double-sleeved, toploader, magnetic holder, or graded slab.
- Notes.

Actions:

- Add owned copies.
- Remove copies from this box without deleting ownership.
- Move copies to another box, binder slot, or display slot.
- Search inside the box.
- Sort/filter by set, name, number, variant, condition, duplicates, and protection.
- Edit quantity when more than one equivalent copy is stored together.

Copy rules:

- The available quantity is owned quantity minus all allocations.
- Adding one copy allocates exactly one copy of a specific inventory lot.
- The UI cannot allocate more than available.
- Removing an allocation makes that copy available again.
- Removing a copy from a box does not remove it from the collection.
- Decreasing overall ownership below allocated quantity must be rejected.

### Existing/unplaced boxes

- Existing legacy boxes with no Space appear in the default Space's **Unplaced Boxes** area.
- Existing boxes with no internal compartment are upgraded safely when opened or explicitly migrated.
- Unplaced boxes can be dragged/tapped into a shelf.
- Nothing silently disappears because `space_id` is null.

## Binder Library

### Library view

- Visually distinct from Storage.
- Binders stand upright like physical binders/books.
- Spine colors and labels persist.
- Binders align to actual shelves.
- Hover gives a subtle pull-forward animation.
- Clicking a binder opens its binder-page view.

Each binder shows:

- Name.
- Pocket format: 4, 9, or 12.
- Cover image when present.
- Filled slots / total known slots.
- Physical Space and shelf location.

Actions:

- Add Binder opens an in-app form.
- Edit name, color/cover, pocket format, and shelf placement.
- Move Binder between Spaces/shelves.
- Delete Binder requires confirmation and must not delete card ownership.

### Binder creation

Fields:

- Name.
- Pocket format.
- Cover/color.
- Space.
- Shelf unit and shelf position.

New binders should either auto-place into an open binder position or appear clearly as unplaced.

### Binder pages

- Page-turn interaction should be smooth.
- Empty slots are clearly addable.
- A slot holds one allocated physical copy.
- Placing a card requires selecting the exact condition/variant copy.
- Removing it from a slot does not remove ownership.
- All card images support zoom/detail.

## Display Gallery

### Display Gallery overview

Display cases are separate first-class furniture, not storage boxes or ordinary shelf tiles.

Required case presets:

- Wall-mounted case.
- Lit standing cabinet.
- Museum-quality vitrine.
- Floating display shelf.
- Pedestal case.
- Custom display.

Each case card shows:

- Name.
- Case preset.
- Shelf/slot count.
- Occupied slots.
- Lighting state.

### Display-case appearance

A lit cabinet should visibly include:

- Floor-standing frame/base.
- Glass doors.
- Door seams and handles.
- Interior shelves.
- LED lighting.
- Card/slab stands.
- Controlled reflections.
- Enough clearance that hover zoom is not clipped.

It must not look like:

- An ordinary wooden shelf.
- A chest of drawers on a shelf.
- A flat grid of generic dashboard cards.

### Display-case controls

- Add Display Case opens a visual preset picker.
- Lighting toggle persists without a refresh.
- Arrange Display enables slot-based placement.
- Add/remove shelves only when supported by the preset.
- Rename, recolor frame, change light color, and move case within the Space.
- Delete requires confirmation; displayed copies become unallocated, not deleted.

### Display slots

- Each slot holds one physical copy.
- The selected inventory lot determines condition, variant, edition, and language.
- Optional protection state is stored.
- Displayed cards remain part of overall ownership.
- A copy cannot simultaneously occupy a box, binder slot, and display slot.

### Card hover zoom and mobile detail

Desktop:

- Hover/focus enlarges the card enough to inspect it.
- Zoom uses an overlay/portal so cabinet overflow does not crop it.
- Zoom never shifts the underlying layout.
- Keyboard focus provides the same result.

Mobile:

- Tap opens a large card-detail sheet or full-screen viewer.
- Pinch zoom is allowed where practical.
- Viewer includes condition, variant, edition, language, location, and protection.
- Closing returns to the same scroll position.

## Add Cards page

Add Cards is outside Spaces at `/add`.

It adds or updates overall ownership. It should support:

- Bulk entry.
- Condition.
- Variant.
- Edition.
- Language.
- Quantity.
- Duplicate detection/merge preview.

After ownership is saved, the user may optionally file the new copies:

- Leave Unfiled.
- Place in a box.
- Place in a binder slot.
- Place in a display slot.

This filing step references Spaces, but the Add Cards page itself is not inside Spaces.

## Duplicate and inventory behavior

An inventory lot is uniquely identified by:

- User.
- Card.
- Printed variant.
- Edition.
- Language.
- Condition.

Adding another equivalent copy increments quantity. It does not create a duplicate lot row.

Examples:

- Two NM unlimited holofoil copies are one lot with quantity 2.
- One NM and one LP copy are two lots.
- One standard and one reverse-holo copy are two lots.
- One unlimited and one first-edition copy are two lots.

The UI should show a merge preview before bulk-save when an equivalent lot already exists.

## Loading, saving, and animation rules

- Full loading screen only on the initial page load.
- Background reloads retain the current UI.
- Use local pending states on the affected button/object.
- Optimistic placement is allowed when rollback is implemented.
- Never call `location.assign` for internal navigation.
- Never use browser prompts for production creation/edit forms.
- Animations should generally be 180–650 ms and respect reduced-motion settings.
- Dragging, opening, lighting, page turns, and card zoom should remain smooth on mid-range phones.
- Avoid rendering unnecessary 3D scenes or running continuous animation loops.

## Error behavior

Every mutation must show:

- Pending state.
- Success confirmation when not otherwise visually obvious.
- Human-readable failure.
- Retry where appropriate.

The UI must specifically handle:

- Shelf/stack full.
- Position collision.
- Capacity exceeded.
- Allocation exceeds ownership.
- Copy already occupies a one-copy slot.
- Missing/deleted furniture.
- Network failure.
- Stale client state.

Errors must not cause a black page or erase local navigation state.

## Accessibility

- Everything clickable is keyboard reachable.
- Drag/drop has a tap/keyboard alternative.
- All card images have meaningful alt text.
- Focus is visible.
- Dialogs trap focus and restore it on close.
- Color is never the only status indicator.
- Reduced-motion preference is respected.
- Touch targets are at least approximately 44×44 pixels.

## Mobile behavior

Spaces landing:

- Space cards stack vertically.
- The three areas are large tap targets.

Storage:

- Shelf units appear as horizontally scrollable summaries or a vertical list.
- Enter one shelf unit at a time.
- Use Move → Place interaction instead of relying on HTML drag/drop.
- Opening a box uses a full-screen workspace.

Binders:

- Horizontally scrollable binder shelf.
- Binder pages fill the screen.

Displays:

- One case at a time.
- Cards use tap-to-zoom/full-screen detail.

## Backend/API expectations

Required persisted concepts:

- Multiple `collection_spaces` per user.
- `storage_units` belonging to a Space.
- Box placement: Space, storage unit, shelf index, stack index, stack level.
- Binder placement: Space, storage unit, shelf index, shelf position.
- First-class `display_cases` and `display_slots`.
- Condition/variant-aware `inventory_lots`.
- Copy-level `card_allocations` targeting a box compartment, binder slot, or display slot.

Backend rules:

- Verify that every referenced object belongs to the user.
- Verify coordinates fit the furniture.
- Enforce unique physical positions.
- Enforce quantity and one-copy slot constraints transactionally.
- Return enough allocation data to reload a box/binder/display and show exactly what is inside.
- Never guess a legacy binder card's condition or variant during migration.

## Acceptance test checklist

### Navigation

- [ ] Spaces, Explore, Add Cards, Tools, and Convention open distinct correct pages.
- [ ] Add Cards uses `/add` and is not marked as part of Spaces.
- [ ] Switching Space areas does not refresh or black out.

### Spaces

- [ ] Create a Space using an in-app form.
- [ ] Select another Space and see its separate contents.
- [ ] Counts match backend data.

### Storage

- [ ] Create each box preset and verify stored type/capacity/color.
- [ ] Create a custom box.
- [ ] New box appears immediately.
- [ ] Legacy unplaced boxes remain visible.
- [ ] Drag a box to an open stack position.
- [ ] Stack boxes vertically.
- [ ] Collision/full-stack attempts are rejected visibly.
- [ ] Open a box and see a physical opening animation.
- [ ] Add one exact condition/variant copy.
- [ ] Reload and confirm it remains inside.
- [ ] Remove it and confirm ownership remains available.
- [ ] No action causes a full-page black flash.

### Binders

- [ ] Create a binder with chosen pocket format.
- [ ] Place it on a shelf.
- [ ] Open binder pages.
- [ ] Place and remove an exact physical copy.
- [ ] Card ownership remains intact.

### Displays

- [ ] Create every display preset.
- [ ] Toggle lighting and confirm persistence.
- [ ] Place an exact copy in a display slot.
- [ ] Reload and confirm placement.
- [ ] Hover zoom is not clipped.
- [ ] Mobile tap opens a readable full-screen card.

### Inventory integrity

- [ ] Equivalent additions merge into one lot.
- [ ] Different condition/variant/edition/language remain separate.
- [ ] Over-allocation is rejected.
- [ ] One copy cannot occupy multiple locations.
- [ ] Deleting furniture unallocates copies without deleting ownership.

## Definition of done

This feature is not done merely because pages render or endpoints compile. It is done only when every checklist workflow passes through the actual UI against the Scala backend on desktop and mobile, with no silent failures, fake data, repeated legacy pages, black refreshes, or disappearing objects.
