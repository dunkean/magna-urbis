import type { ResolvedAppearance } from '../render/appearanceRecipe';

/** Material shaders and painted grounds have no editable SVG equivalent. Map palettes keep vector geometry. */
export function supportsSvgExport(appearance: ResolvedAppearance): boolean {
  return appearance.ground.traits.family === 'map' && appearance.diagnostic === 'none' && !appearance.composition.vegetation.procedural;
}
