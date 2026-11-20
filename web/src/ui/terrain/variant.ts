/**
 * Program variants of the 2D ground, shared by both backends: which compiled program (WebGL2 ShaderVariants key,
 * WebGPU pipeline overrides) draws a look, which passes it needs, and the quality policy that trims them on weak or
 * recovering GPUs (glContextRecovery.ts: low-end and light profiles).
 *
 * Map program variant: the look's mode, Render v2 number, forest and brushes as constants. Forest crowns and Render v2
 * water come from an auxiliary pass (mapPasses). Measured alone with FXC: Render v2 with forest 22 s for the map and
 * 21 s for its auxiliary pass (linking in parallel), Render v2 19 s + 12 s, natural 5 s; the full shader never loaded.
 * On FXC they link in the background. Natural water is a runtime uniform, not a variant: Satellite and Satellite-2
 * (ink water) share their programs.
 */
import { styleTraits } from '../../render/terrainStyle';
import { getDisplayQuality } from '../../render/displayQuality';
import { mapGpuLight, mapGpuLowEnd } from '../glContextRecovery';
import type { TerrainLook } from './contract';

export interface TerrainVariant {
  mode: number;
  v2: number;
  forest: boolean;
  brushes: boolean;
}
export const PREVIEW_VARIANT: TerrainVariant = { mode: 0, v2: 0, forest: false, brushes: false };
/** The Satellite look (the heaviest, the usual next choice): prepared while idle once the requested look is drawn. */
export const SATELLITE_VARIANT: TerrainVariant = { mode: 3, v2: 1, forest: true, brushes: false };
export const variantKey = (v: TerrainVariant): string => `${v.mode}.${v.v2}.${+v.forest}${+v.brushes}`;
/** Map passes of a look: forest crowns and Render v2 water are rendered first by an auxiliary pass
 * (one RGBA32UI texture: crowns in three words, the water colour in the fourth), then read by the map. */
export const mapPasses = (v: TerrainVariant): ('aux' | 'map')[] => (v.forest || v.v2 > 0 ? ['aux', 'map'] : ['map']);
/** The look needs the auxiliary pass (mapPasses without the array). */
export const hasAuxPass = (v: TerrainVariant): boolean => v.forest || v.v2 > 0;
/** Light profile variant (glContextRecovery.ts), after a GPU loss: no forest pass, no Render v2 material. On FXC
 * it links in about 5 s instead of 22 + 21 s; on Mesa/Intel it keeps the program and its memory far smaller. */
const lightVariant = (v: TerrainVariant): TerrainVariant => (mapGpuLight() ? { ...v, v2: 0, forest: false, brushes: false } : v);
export const lookMode = (look: TerrainLook): number => (styleTraits(look.style).elevation ? 1 : look.layers.hypsometry && styleTraits(look.style).ground3d ? 3 : styleTraits(look.style).neuralEarth && look.layers.hypsometry ? 2 : 0);

/** The forest switch follows the look (groundCover: procedural vegetation, whose field arrives a few seconds
 * later from a worker), not the field's arrival: deciding on the field compiled a forest-off pair first, then
 * the forest-on pair, two heavy compilations for one look. Without its field the forest code finds no stand.
 * `forestUploaded`: a forest field is on the GPU. */
export const lightTerrainAllowed = (look: TerrainLook): boolean => styleTraits(look.style).satelliteVariant === 0 || mapGpuLight();
/** A Satellite fast recipe simplifies buildings, while its complete ground and water keep full quality.
 * Pass selection and shader uniforms must use the same value or encoded river regimes reach the screen as RGB. */
export const terrainDrawQuality = (look: TerrainLook, quality: number): number => (lightTerrainAllowed(look) ? quality : 0);
export const lightTerrainLook = (look: TerrainLook): boolean => (look.displayLight ?? (!look.mesh3d && getDisplayQuality() === 'light')) && lightTerrainAllowed(look);
export function lookVariant(look: TerrainLook, forestUploaded: boolean): TerrainVariant {
  // Mode zero eliminates the entire natural-material shader and the auxiliary crown/water pass at compile time.
  // Captures pin displayLight=false; live world tiles use the same policy as the view, not capture quality.
  if (lightTerrainLook(look)) {
    const mode = styleTraits(look.style).elevation ? 1 : 0;
    return { mode, v2: 0, forest: false, brushes: treeSymbolsOn(look, mode) };
  }
  const mode = lookMode(look);
  return lightVariant({
    mode,
    v2: styleTraits(look.style).satelliteVariant,
    forest: !look.underdark && !styleTraits(look.style).fantasy && (look.independentCanopy === true || mode === 3) && (look.groundCover === true || forestUploaded),
    // Mode 3: the painted forest brushes; mode 0: the paper map's tree symbols on the same atlas binding.
    brushes: (styleTraits(look.style).forestBrushes && mode === 3) || treeSymbolsOn(look, mode),
  });
}
/** The variant draws the paper map's woods (render/treeSymbols.ts): only the shaded paper ground, mode 0. */
export const treeSymbolsOn = (look: TerrainLook, mode: number): boolean => mode === 0 && !!look.treeSymbols;

/** Speculative preparation of the next likely look: never on an integrated/software GPU or after a loss (a heavy
 * speculative link or pipeline can itself lose the context). */
export const speculativePrewarmAllowed = (): boolean => getDisplayQuality() !== 'light' && !(mapGpuLowEnd() || mapGpuLight());
