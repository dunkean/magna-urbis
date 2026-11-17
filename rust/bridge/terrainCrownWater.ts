/**
 * One rule for every 2D crown over water, forest trees and the Underdark's giant mushroom caps alike, on rivers,
 * lakes and the sea shore:
 * - a crown stands only where its foot (trunk or stem, the crown's centre) is on land: water at the foot below half
 *   cover. No tree or mushroom stands in open water.
 * - a standing crown is drawn whole over the bank's water: the water shows only where no crown covers it, so crowns
 *   overhang the shore instead of being cut at the waterline.
 * The ground shaders (ui/terrainGl.ts, ui/terrain3d.ts) take the GLSL; the TS twins pin the rule in tests.
 */
export const CROWN_ROOT_WATER = .5;

/** True when a crown whose foot lies in this water cover (0-1) may stand. */
export const crownRooted = (waterAtFoot: number): boolean => waterAtFoot < CROWN_ROOT_WATER;

/** Water cover left visible under a standing crown's resolved cover (both 0-1). */
export const waterUnderCrown = (water: number, crown: number): number => water * (1 - Math.min(Math.max(crown, 0), 1));

export const CROWN_WATER_GLSL = /* glsl */ `
// Crowns over water (rust/bridge/terrainCrownWater.ts): rooted on land only, drawn whole over the bank's water.
bool crownRooted(float waterAtFoot){return waterAtFoot<${CROWN_ROOT_WATER.toFixed(2)};}
float waterUnderCrown(float water,float crown){return water*(1.-clamp(crown,0.,1.));}
`;
