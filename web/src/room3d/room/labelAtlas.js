/**
 * labelAtlas.js — user-defined names for binder spines and box labels.
 *
 * All labels of the focused unit's visible window are drawn into ONE canvas
 * texture (an atlas) and rendered by ONE merged mesh: a single draw call and a
 * single texture however many binders/boxes are visible, no per-object HTML
 * overlays. The atlas is rebuilt only when a visible name or colour changes
 * and the caller disposes the old texture, so it cannot leak.
 *
 * Long names are word-wrapped, shrunk to a minimum legible size, then
 * ellipsised; the full name is always available in the browser panel/tooltip.
 */

/** Cell sizes in pixels. Binder spines are portrait and read bottom-to-top; box labels are landscape. */
export const LABEL_SPECS = Object.freeze({
  binders: Object.freeze({ cellW: 160, cellH: 256, cols: 12, maxFont: 64, minFont: 26, maxLines: 2, weight: 800 }),
  boxes: Object.freeze({ cellW: 512, cellH: 128, cols: 4, maxFont: 66, minFont: 30, maxLines: 2, weight: 800 }),
});

/**
 * Atlas geometry for `count` cells: pixel size plus each cell's pixel rect and
 * texture coordinates (v measured with the canvas flipped, as CanvasTexture does).
 */
export function atlasLayout(count, spec) {
  const cols = Math.max(1, Math.min(spec.cols, count));
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * spec.cellW;
  const height = rows * spec.cellH;
  const cells = Array.from({ length: count }, (_, i) => {
    const x = (i % cols) * spec.cellW;
    const y = Math.floor(i / cols) * spec.cellH;
    return { x, y, u0: x / width, u1: (x + spec.cellW) / width, vTop: 1 - y / height, vBottom: 1 - (y + spec.cellH) / height };
  });
  return { width, height, cols, rows, cells };
}

/** Greedy word wrap that also breaks a single over-long word by character. */
export function wrapLines(measure, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const attempt = line ? `${line} ${word}` : word;
    if (measure(attempt) <= maxWidth) { line = attempt; continue; }
    if (line) lines.push(line);
    line = '';
    let chunk = '';
    for (const ch of word) {
      if (measure(chunk + ch) > maxWidth && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Largest font (down to the minimum) at which the text fits in `maxLines`; ellipsis as a last resort. */
export function fitLines(ctx, text, maxWidth, spec) {
  const label = text && text.trim() ? text.trim() : 'Untitled';
  const fontFor = (px) => `${spec.weight} ${px}px ${spec.family ?? 'system-ui, "Segoe UI", sans-serif'}`;
  for (let px = spec.maxFont; px >= spec.minFont; px -= 2) {
    ctx.font = fontFor(px);
    const lines = wrapLines((t) => ctx.measureText(t).width, label, maxWidth);
    if (lines.length <= spec.maxLines) return { px, lines };
  }
  ctx.font = fontFor(spec.minFont);
  const lines = wrapLines((t) => ctx.measureText(t).width, label, maxWidth).slice(0, spec.maxLines);
  let last = lines[lines.length - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  lines[lines.length - 1] = `${last}…`;
  return { px: spec.minFont, lines };
}

/**
 * Draw one label per item and return the canvas with its layout.
 * @param {{ name: string, color?: string }[]} items
 * @param {'binders'|'boxes'} kind
 */
/** Plate styles: `classic` is the original cream card; `catalog` is a parchment plate with a brass double rule and a serif face. */
export const LABEL_STYLES = Object.freeze({
  classic: Object.freeze({ paper: '#fff8e8', rule: '#c9b994', innerRule: null, ink: '#203b34', family: null, weight: null }),
  catalog: Object.freeze({ paper: '#efe3c6', rule: '#8a6a35', innerRule: 'rgba(138,106,53,0.55)', ink: '#241c14', family: 'Georgia, "Times New Roman", serif', weight: 700 }),
});

export function drawLabelAtlas(items, kind, styleName = 'classic') {
  const style = LABEL_STYLES[styleName] ?? LABEL_STYLES.classic;
  const spec = style.family ? { ...LABEL_SPECS[kind], family: style.family, weight: style.weight } : LABEL_SPECS[kind];
  const layout = atlasLayout(items.length, spec);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  items.forEach((item, i) => {
    const cell = layout.cells[i];
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.x, cell.y, spec.cellW, spec.cellH);
    ctx.clip();
    ctx.fillStyle = style.paper;
    ctx.fillRect(cell.x, cell.y, spec.cellW, spec.cellH);
    ctx.strokeStyle = style.rule;
    ctx.lineWidth = 6;
    ctx.strokeRect(cell.x + 3, cell.y + 3, spec.cellW - 6, spec.cellH - 6);
    if (style.innerRule) { ctx.strokeStyle = style.innerRule; ctx.lineWidth = 2; ctx.strokeRect(cell.x + 11, cell.y + 11, spec.cellW - 22, spec.cellH - 22); }
    ctx.fillStyle = item.color || '#2f7065';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    let maxWidth;
    if (kind === 'binders') {
      ctx.fillRect(cell.x + 6, cell.y + 6, 12, spec.cellH - 12); // colour stripe on the spine's left edge
      ctx.translate(cell.x + spec.cellW / 2 + 6, cell.y + spec.cellH / 2);
      ctx.rotate(-Math.PI / 2); // reads bottom-to-top like a book spine
      maxWidth = spec.cellH - 36;
    } else {
      ctx.fillRect(cell.x + 6, cell.y + 6, 14, spec.cellH - 12);
      ctx.translate(cell.x + spec.cellW / 2 + 8, cell.y + spec.cellH / 2);
      maxWidth = spec.cellW - 60;
    }
    const { px, lines } = fitLines(ctx, item.name, maxWidth, spec);
    ctx.fillStyle = style.ink;
    const lineHeight = px * 1.08;
    lines.forEach((line, n) => ctx.fillText(line, 0, (n - (lines.length - 1) / 2) * lineHeight));
    ctx.restore();
  });
  return { canvas, layout };
}
