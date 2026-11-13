/** Power-of-two densities keep world-aligned drape squares reusable between cameras.
 * Exact capture keeps the original requested size. Live detail upgrades on approach,
 * never downgrades an already sharper patch during navigation. */
export function projectedTexturePixels(maximum: number, footprint: number, dpr: number, exact = false): number {
  if (exact || !Number.isFinite(footprint)) return maximum;
  return Math.min(maximum, Math.max(128, 2 ** Math.ceil(Math.log2(Math.max(1, footprint * dpr * 1.5)))));
}
