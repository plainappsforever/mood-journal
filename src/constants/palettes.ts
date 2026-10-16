// Level colour sets for Appearance → Palette (applied to every mood by its level; each mood can still be recoloured).
// Index 0 = level 1 (worst) … 4 = level 5 (best). "contrast" follows a colour-vision-safe ramp (viridis-like).
export const PALETTES = {
  classic: ['#D64545', '#F08A4B', '#F2C14E', '#8BC34A', '#2E9E5B'],
  calm: ['#5B5F97', '#7A8CC2', '#A3B9D9', '#7CC6C0', '#3FA89B'],
  contrast: ['#440154', '#3B528B', '#21918C', '#5EC962', '#FDE725'],
  pastel: ['#E8A0A0', '#F2C6A0', '#F2E3A0', '#C3E2A8', '#A0D8B8'],
} as const;

export type PaletteName = keyof typeof PALETTES;
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

/** Colours offered in the mood editor. */
export const MOOD_COLORS = [...new Set([...PALETTES.classic, ...PALETTES.calm, ...PALETTES.contrast, '#9E9E9E', '#E91E63', '#795548'])];
