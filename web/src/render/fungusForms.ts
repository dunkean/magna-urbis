/**
 * The parametric mushroom family shared by the Underdark's wild mushrooms (ui/terrain3dFungi.ts) and the myconid
 * dwellings (render/city3dMushroom.ts), so the town and the groves belong together.
 *
 * Each form is nine rings from the foot to the apex (a stalactite from its tip to the roof): (stem factor, cap factor,
 * height share); radius = a · stem radius + b · cap radius. Rings 0-2 are the stem, 3-4 the cap underside (gills),
 * 5-8 the cap top, unless FUNGUS_PARTS says otherwise.
 */
export const FUNGUS_FORMS = ['parasol', 'dome', 'bell', 'cone', 'funnel', 'puffball', 'morel', 'club', 'bracket', 'stalactite'] as const;
export type FungusForm = typeof FUNGUS_FORMS[number];
export const FUNGUS_FORM: Readonly<Record<FungusForm, number>> = Object.fromEntries(FUNGUS_FORMS.map((name, i) => [name, i])) as Record<FungusForm, number>;
export const FUNGUS_RINGS = 9;
export const FUNGUS_PROFILES: readonly (readonly (readonly [number, number, number])[])[] = [
  [[1.5, 0, -.02], [1.05, 0, .4], [.9, 0, .84], [1.2, 0, .86], [0, .96, .82], [0, 1, .85], [0, .8, .93], [0, .42, .985], [0, 0, 1]],   // parasol
  [[1.35, 0, -.02], [1.05, 0, .2], [.95, 0, .42], [1.3, 0, .46], [0, .9, .4], [0, 1, .5], [0, .86, .78], [0, .5, .95], [0, 0, 1]],     // dome
  [[1.3, 0, -.02], [1, 0, .22], [.9, 0, .45], [1.2, 0, .62], [0, .92, .36], [0, 1, .4], [0, .82, .72], [0, .48, .93], [0, 0, 1]],      // bell
  [[1.2, 0, -.02], [1, 0, .2], [.9, 0, .4], [1.1, 0, .5], [0, .95, .38], [0, 1, .42], [0, .62, .66], [0, .3, .86], [0, 0, 1]],         // cone
  [[1.1, 0, -.02], [1, 0, .3], [1.1, 0, .6], [1.6, 0, .66], [0, .92, .94], [0, 1, 1], [0, .75, .93], [0, .38, .86], [0, 0, .83]],      // funnel cup
  [[0, .45, -.02], [0, .78, .1], [0, .95, .25], [0, 1, .42], [0, .97, .58], [0, .88, .73], [0, .7, .86], [0, .4, .96], [0, 0, 1]],     // puffball
  [[1.2, 0, -.02], [1, 0, .18], [.95, 0, .35], [0, .85, .36], [0, .98, .42], [0, 1, .55], [0, .9, .72], [0, .55, .9], [0, 0, 1]],      // morel
  [[.6, 0, -.02], [.7, 0, .2], [.85, 0, .45], [1.05, 0, .65], [1.3, 0, .78], [1.45, 0, .88], [1.3, 0, .95], [.8, 0, .99], [0, 0, 1]],  // club
  [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, .08, 0], [0, .95, .25], [0, 1, .5], [0, .85, .8], [0, .45, .97], [0, 0, 1]],                   // bracket
  [[0, 0, -1], [0, .12, -.86], [0, .24, -.72], [0, .36, -.58], [0, .5, -.44], [0, .64, -.3], [0, .78, -.17], [0, .9, -.07], [0, 1, 0]], // stalactite
];
/** Last stem ring and last underside ring of each form (-1: none). */
export const FUNGUS_PARTS: readonly (readonly [number, number])[] = [[2, 4], [2, 4], [2, 4], [2, 4], [2, 4], [-1, -1], [2, 3], [-1, -1], [-1, 4], [-1, -1]];
/** Cap colours of the giant mushrooms, as the 2D ground paints them (underdarkMushroomCell): violet, rust, pale teal. */
export const FUNGUS_CAPS: readonly (readonly [number, number, number])[] = [[.30, .19, .33], [.34, .21, .14], [.20, .30, .27]];
/** Amanita cap of the myconid dwellings (render/city3dMushroom.ts): from the gills at the stem, the deep rounded gill
 * skirt down to its belly and out to the rim, then the broad, nearly flat top. (stem factor, cap factor, share of the
 * cap height above the eave.) */
export const FUNGUS_AMANITA: readonly (readonly [number, number, number])[] = [
  [1.15, 0, .02], [0, .42, -.28], [0, .78, -.2], [0, 1, .02], [0, 1.03, .22], [0, .88, .4], [0, .5, .48], [0, 0, .5]];
