/** Sea cover of the 3D water layer, shared by the V2 and City Bench (CLAUDE.md: one shared choice).
 *
 * The 2D map draws the coast at the zero level of the height field it shades (ui/terrainGl.ts land cover: sea where the
 * sampled ground is below 0 m). The 3D view used the sea flag of coarser planning cells instead (78 m cells on a 40 km V2
 * region, a cell is sea when its mean height is <= 0), which put shore houses standing on dry ground into the sea.
 * Both views now read the same test on the finest height grid at hand. */

/** Paints `rgba` on every grid point of `height` at or below sea level; `pixels` is the RGBA buffer of the same n × n grid. */
export function paintSeaCover(pixels: Uint8ClampedArray, height: ArrayLike<number>, rgba: ArrayLike<number>): void {
  for (let i = 0; i < height.length; i++) if (height[i] <= 0) pixels.set(rgba, i * 4);
}
