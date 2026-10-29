/** Planar card-face UVs; see CardSlab.jsx for why they are needed. */
/** Overwrite `geometry`'s UVs with a planar projection onto its width × height face. Returns the geometry. */
export function normalizeFaceUVs(geometry, width, height) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  for (let i = 0; i < position.count; i++) uv.setXY(i, clamp01(position.getX(i) / width + 0.5), clamp01(position.getY(i) / height + 0.5));
  uv.needsUpdate = true;
  return geometry;
}
