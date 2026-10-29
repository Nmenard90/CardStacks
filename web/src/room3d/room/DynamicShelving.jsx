/**
 * DynamicShelving.jsx — the generated binder shelf and storage rack, standing
 * exactly where the baked furniture used to (anchors copied from Room.jsx's
 * BinderLibrary and StorageWall), so the room layout, camera hotspots and
 * lighting are unchanged. Room.jsx renders this instead of the two GLB
 * wrappers unless the baked furniture is requested (`?furniture=baked`).
 */
import React from 'react';
import ShelfUnit from './ShelfUnit.jsx';
import useFurnitureParts from './furnitureParts.js';

const BINDER_ANCHOR = { position: [-0.6, 0, -2.54], rotation: [0, Math.PI, 0] };
const BOX_ANCHOR = { position: [-3.53, 0, 1.35], rotation: [0, -Math.PI / 2, 0] };

export default function DynamicShelving({
  zones, anchors = {}, hoveredBinder, selectedBinder, setHoveredBinder, onSelectBinder, hoveredBin, selectedBin, setHoveredBin, onSelectBin, onSelect, setHovered,
}) {
  const parts = useFurnitureParts();
  return (
    <>
      <ShelfUnit
        kind="boxes" zoneType="storage" zone={zones.boxes} parts={parts} {...(anchors.boxes ?? BOX_ANCHOR)}
        hoveredId={hoveredBin} selectedId={selectedBin} onSelectItem={onSelectBin} onHoverItem={setHoveredBin}
        onSelectZone={() => onSelect('storage')} onHoverZone={setHovered}
      />
      <ShelfUnit
        kind="binders" zoneType="binders" zone={zones.binders} parts={parts} {...(anchors.binders ?? BINDER_ANCHOR)}
        hoveredId={hoveredBinder} selectedId={selectedBinder} onSelectItem={onSelectBinder} onHoverItem={setHoveredBinder}
        onSelectZone={() => onSelect('binders')} onHoverZone={setHovered}
      />
    </>
  );
}
