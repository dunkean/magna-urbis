/**
 * The parametric mushroom family shared by the Underdark's wild mushrooms (ui/terrain3dFungi.ts) and the myconid
 * dwellings (render/city3dMushroom.ts), so the town and the groves belong together.
 *
 * Each form is nine rings from the foot to the apex (a stalactite from its tip to the roof): (stem factor, cap factor,
 * height share); radius = a · stem radius + b · cap radius. Rings 0-2 are the stem, 3-4 the cap underside (gills),
 * 5-8 the cap top, unless FUNGUS_PARTS says otherwise.
 */
export const FUNGUS_FORMS = ['parasol', 'dome', 'bell', 'cone', 'funnel', 'puffball', 'morel', 'club', 'bracket', 'stalactite'] as const;
export type FungusForm = (typeof FUNGUS_FORMS)[number];
export const FUNGUS_FORM: Readonly<Record<FungusForm, number>> = Object.fromEntries(FUNGUS_FORMS.map((name, i) => [name, i])) as Record<FungusForm, number>;
export const FUNGUS_RINGS = 9;
export const FUNGUS_PROFILES: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [1.5, 0, -0.02],
    [1.05, 0, 0.4],
    [0.9, 0, 0.84],
    [1.2, 0, 0.86],
    [0, 0.96, 0.82],
    [0, 1, 0.85],
    [0, 0.8, 0.93],
    [0, 0.42, 0.985],
    [0, 0, 1],
  ], // parasol
  [
    [1.35, 0, -0.02],
    [1.05, 0, 0.2],
    [0.95, 0, 0.42],
    [1.3, 0, 0.46],
    [0, 0.9, 0.4],
    [0, 1, 0.5],
    [0, 0.86, 0.78],
    [0, 0.5, 0.95],
    [0, 0, 1],
  ], // dome
  [
    [1.3, 0, -0.02],
    [1, 0, 0.22],
    [0.9, 0, 0.45],
    [1.2, 0, 0.62],
    [0, 0.92, 0.36],
    [0, 1, 0.4],
    [0, 0.82, 0.72],
    [0, 0.48, 0.93],
    [0, 0, 1],
  ], // bell
  [
    [1.2, 0, -0.02],
    [1, 0, 0.2],
    [0.9, 0, 0.4],
    [1.1, 0, 0.5],
    [0, 0.95, 0.38],
    [0, 1, 0.42],
    [0, 0.62, 0.66],
    [0, 0.3, 0.86],
    [0, 0, 1],
  ], // cone
  [
    [1.1, 0, -0.02],
    [1, 0, 0.3],
    [1.1, 0, 0.6],
    [1.6, 0, 0.66],
    [0, 0.92, 0.94],
    [0, 1, 1],
    [0, 0.75, 0.93],
    [0, 0.38, 0.86],
    [0, 0, 0.83],
  ], // funnel cup
  [
    [0, 0.45, -0.02],
    [0, 0.78, 0.1],
    [0, 0.95, 0.25],
    [0, 1, 0.42],
    [0, 0.97, 0.58],
    [0, 0.88, 0.73],
    [0, 0.7, 0.86],
    [0, 0.4, 0.96],
    [0, 0, 1],
  ], // puffball
  [
    [1.2, 0, -0.02],
    [1, 0, 0.18],
    [0.95, 0, 0.35],
    [0, 0.85, 0.36],
    [0, 0.98, 0.42],
    [0, 1, 0.55],
    [0, 0.9, 0.72],
    [0, 0.55, 0.9],
    [0, 0, 1],
  ], // morel
  [
    [0.6, 0, -0.02],
    [0.7, 0, 0.2],
    [0.85, 0, 0.45],
    [1.05, 0, 0.65],
    [1.3, 0, 0.78],
    [1.45, 0, 0.88],
    [1.3, 0, 0.95],
    [0.8, 0, 0.99],
    [0, 0, 1],
  ], // club
  [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0.08, 0],
    [0, 0.95, 0.25],
    [0, 1, 0.5],
    [0, 0.85, 0.8],
    [0, 0.45, 0.97],
    [0, 0, 1],
  ], // bracket
  [
    [0, 0, -1],
    [0, 0.12, -0.86],
    [0, 0.24, -0.72],
    [0, 0.36, -0.58],
    [0, 0.5, -0.44],
    [0, 0.64, -0.3],
    [0, 0.78, -0.17],
    [0, 0.9, -0.07],
    [0, 1, 0],
  ], // stalactite
];
/** Last stem ring and last underside ring of each form (-1: none). */
export const FUNGUS_PARTS: readonly (readonly [number, number])[] = [
  [2, 4],
  [2, 4],
  [2, 4],
  [2, 4],
  [2, 4],
  [-1, -1],
  [2, 3],
  [-1, -1],
  [-1, 4],
  [-1, -1],
];
/** Cap colours of the giant mushrooms, as the 2D ground paints them (underdarkMushroomCell): violet, rust, pale teal. */
export const FUNGUS_CAPS: readonly (readonly [number, number, number])[] = [
  [0.3, 0.19, 0.33],
  [0.34, 0.21, 0.14],
  [0.2, 0.3, 0.27],
];
/** Amanita cap of the myconid dwellings (render/city3dMushroom.ts): from the gills at the stem, the deep rounded gill
 * skirt down to its belly and out to the rim, then the broad, nearly flat top. (stem factor, cap factor, share of the
 * cap height above the eave.) */
export const FUNGUS_AMANITA: readonly (readonly [number, number, number])[] = [
  [1.15, 0, 0.02],
  [0, 0.42, -0.28],
  [0, 0.78, -0.2],
  [0, 1, 0.02],
  [0, 1.03, 0.22],
  [0, 0.88, 0.4],
  [0, 0.5, 0.48],
  [0, 0, 0.5],
];
