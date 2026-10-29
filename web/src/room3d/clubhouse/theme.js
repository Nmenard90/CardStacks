/**
 * theme.js — every colour in the Clubhouse room, as named tokens.
 *
 * Nothing in the room hard-codes a hex value: furniture builders read `theme.colors`, and layout props refer to
 * tokens by name (`pot: 'coral'`). Swap the theme and the whole room recolours. Themes are plain JSON, so they can be
 * saved, shared and reset to a preset. Pure module: no THREE, no DOM.
 */

/** The default palette: deep teal walls, natural oak, cream trim, terracotta, amber and mint accents. */
export const DEFAULT_COLORS = Object.freeze({
  // architecture
  wall: '#14525A', wallLow: '#1B6169', wainscot: '#E8DABC', wainscotPanel: '#F1E5CB', rail: '#C99C62',
  trim: '#F3E7D0', floor: '#C8A980', curtain: '#EBDDBE',
  // woods
  oak: '#D6AC70', oakDark: '#B58A52',
  // accents (layout props name these)
  teal: '#1B5E66', tealDeep: '#0E3F47', coral: '#C4694F', mint: '#8FCDB0', amber: '#E8A33D',
  cream: '#F3E7D0', ink: '#10282C', green: '#2E7D5B', leaf: '#3C9970',
  // soft furnishings
  sofa: '#B95B43', sofaSeat: '#C46A50', rugBase: '#EAD9B8', felt: '#1F6B5A', bed: '#D9A24A', bedCushion: '#F1E4C6',
});

export const COLOR_KEYS = Object.freeze(Object.keys(DEFAULT_COLORS));

/** Ready-made looks. Each lists only what it changes; everything else falls back to the default. */
export const PRESETS = Object.freeze({
  'teal-oak': { label: 'Teal & Oak', colors: {} },
  'forest-lodge': {
    label: 'Forest Lodge',
    colors: { wall: '#2E5A3C', wallLow: '#376A47', wainscot: '#E4D6B6', rail: '#B98A52', teal: '#2F6B4A', tealDeep: '#1B3F2A', coral: '#B4572F', sofa: '#8C4A2E', sofaSeat: '#9C5A3B', felt: '#25573F', curtain: '#E6DABD' },
  },
  'sunset-den': {
    label: 'Sunset Den',
    colors: { wall: '#7A3B3A', wallLow: '#8A4743', wainscot: '#F0DEC0', rail: '#D6A25C', teal: '#2B6A73', tealDeep: '#1D4A52', coral: '#E0804F', amber: '#F0B04A', sofa: '#2D6670', sofaSeat: '#38757F', felt: '#2B5F59', curtain: '#F2E2C5' },
  },
});

export const isHex = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/** Keep only known tokens with valid #rrggbb values: a theme from storage or the network can never inject junk. */
export function sanitizeColors(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of COLOR_KEYS) if (isHex(input[key])) out[key] = input[key].toUpperCase();
  return out;
}

/** A complete theme: defaults, then an optional preset, then user overrides. `mode` is 'day' or 'night'. */
export function makeTheme({ preset = 'teal-oak', overrides = {}, mode = 'day' } = {}) {
  const base = PRESETS[preset] ?? PRESETS['teal-oak'];
  return {
    preset: PRESETS[preset] ? preset : 'teal-oak',
    mode: mode === 'night' ? 'night' : 'day',
    colors: { ...DEFAULT_COLORS, ...sanitizeColors(base.colors), ...sanitizeColors(overrides) },
    overrides: sanitizeColors(overrides),
  };
}

/** Only what the user changed, so a saved theme stays small and survives palette updates. */
export const serializeTheme = (theme) => JSON.stringify({ v: 1, preset: theme.preset, mode: theme.mode, overrides: theme.overrides });

export function parseTheme(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || data.v !== 1) return makeTheme();
    return makeTheme({ preset: data.preset, overrides: data.overrides, mode: data.mode });
  } catch {
    return makeTheme();
  }
}

/** Resolve a layout prop that may be a token name ('coral') or a literal hex. */
export const tokenColor = (colors, nameOrHex) => (colors[nameOrHex] ?? (isHex(nameOrHex) ? nameOrHex : colors.cream));
