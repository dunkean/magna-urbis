import { mergeRects } from '../../render/sceneDiff';
import type { Rect4 } from '../../render/view';

type Capture = (region: { x: number; y: number; width: number }, size: number) => HTMLCanvasElement | undefined;

/** Patch a whole-map capture in its own pixel grid. Render a halo for the screen-space water and crown passes, then
 * copy just the affected pixels. Return false when the changed area needs a new capture or a patch cannot be drawn. */
export function patchBackgroundCapture(image: HTMLCanvasElement, mapWidth: number, regions: readonly Rect4[], halo: number, capture: Capture): boolean {
  const size = image.width,
    metres = mapWidth / size,
    clamp = (n: number): number => Math.max(0, Math.min(size, n)),
    boxes = mergeRects(
      regions.map(r => ({ minX: clamp(Math.ceil(r.minX / metres - 0.5)), minY: clamp(Math.ceil(r.minY / metres - 0.5)), maxX: clamp(Math.floor(r.maxX / metres + 0.5)), maxY: clamp(Math.floor(r.maxY / metres + 0.5)) })).filter(r => r.minX < r.maxX && r.minY < r.maxY),
      1,
    );
  if (!boxes.length) return true;
  if (boxes.reduce((area, r) => area + (r.maxX - r.minX) * (r.maxY - r.minY), 0) > (size * size) / 4) return false;
  const ctx = image.getContext('2d')!;
  for (const { minX, minY, maxX, maxY } of boxes) {
    const width = maxX - minX,
      height = maxY - minY;
    const side = Math.min(size, Math.max(width, height) + 2 * halo),
      x = Math.min(size - side, Math.max(0, minX - halo)),
      y = Math.min(size - side, Math.max(0, minY - halo));
    const patch = capture({ x: x * metres, y: y * metres, width: side * metres }, side);
    if (!patch) return false;
    ctx.drawImage(patch, minX - x, minY - y, width, height, minX, minY, width, height);
  }
  return true;
}
