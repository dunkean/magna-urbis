/** Crown coverage supplied by the retained terrain, in world coordinates. */
type Region = { x: number; y: number; width: number };
let coverage: ((region: Region, pixels: number) => HTMLCanvasElement) | undefined;
let cached: { key: string; image: HTMLCanvasElement } | undefined;
export function setCityCanopy(source: typeof coverage): void { coverage = source; cached = undefined; }
/** Remove ground ink beneath crowns before painting the buildings above it. */
export function clearCityGroundUnderCanopy(ctx: CanvasRenderingContext2D, box: { minX: number; minY: number; maxX: number; maxY: number }, mpp: number): void {
  if (!coverage) return;
  const width = Math.max(box.maxX - box.minX, box.maxY - box.minY), pixels = Math.min(2048, Math.max(1, Math.ceil(width / mpp)));
  const region = { x: box.minX, y: box.minY, width }, key = `${region.x}:${region.y}:${width}:${pixels}`;
  if (cached?.key !== key) cached = { key, image: coverage(region, pixels) };
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1;
  ctx.drawImage(cached.image, region.x, region.y, width, width); ctx.restore();
}
