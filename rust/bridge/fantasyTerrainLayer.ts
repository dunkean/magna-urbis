import { brushFrame, paintingCanvas, paintingSvg, stampHeight, type BrushLibrary, type Stamp } from './fantasyPainting';
import type { FantasyTerrainPainting } from './fantasyTerrain';

const SVG = 'http://www.w3.org/2000/svg', TILE = 512, MAX_TILES = 64, MAX_VISIBLE = 48;
type View = { cx: number; cy: number; scale: number };
type Tile = { key: string; level: number; x: number; y: number; size: number; url: string; node: SVGSVGElement };
const decodedLibraries = new WeakMap<BrushLibrary, Promise<Map<string, HTMLImageElement>>>();
function decodeLibrary(library: BrushLibrary): Promise<Map<string, HTMLImageElement>> {
  let decoded = decodedLibraries.get(library);
  if (!decoded) {
    decoded = Promise.all(Object.entries(library.families).map(async ([family, atlas]) => {
      const image = new Image(); image.src = atlas.url; await image.decode(); return [family, image] as const;
    })).then(entries => new Map(entries));
    decodedLibraries.set(library, decoded);
    void decoded.catch(() => decodedLibraries.delete(library));
  }
  return decoded;
}

/** One bounded raster cache, shared by web and desktop. Camera motion only moves
 * a few SVG images; the deterministic, depth-sorted stamp scene stays intact. */
export function createFantasyTerrainLayer(onError: (error: unknown) => void = console.error) {
  let layer: SVGGElement | undefined, scene: FantasyTerrainPainting | undefined;
  let view: View = { cx: 0, cy: 0, scale: 1 }, width = 0, height = 0, epoch = 0;
  let running = false, scheduled = 0, disposed = false;
  let wanted: Tile[] = [], current = '', failed = false;
  let bounds = { left: 0, top: 0, right: 0, bottom: 0 }, maxHeight = 0, maxWidth = 0;
  const cache = new Map<string, Tile>();
  const release = () => { for (const tile of cache.values()) URL.revokeObjectURL(tile.url); cache.clear(); current = ''; wanted = []; };

  function setScene(nextLayer: SVGGElement, next: FantasyTerrainPainting | undefined): void {
    if (disposed) return;
    const changed = next !== scene;
    layer = nextLayer;
    if (changed) {
      epoch++; release(); scene = next; failed = false; maxHeight = maxWidth = 0;
      bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      if (scene) for (const stamp of scene.stamps) {
        const h = stampHeight(stamp, brushFrame(scene.library, stamp));
        maxHeight = Math.max(maxHeight, h); maxWidth = Math.max(maxWidth, stamp.width);
        bounds.left = Math.min(bounds.left, stamp.x - stamp.width / 2); bounds.right = Math.max(bounds.right, stamp.x + stamp.width / 2);
        bounds.top = Math.min(bounds.top, stamp.y - h * .95); bounds.bottom = Math.max(bounds.bottom, stamp.y + h * .05);
      }
      layer.replaceChildren();
    } else if (current && !layer.childElementCount) current = '';
    if (failed && scene) { layer.innerHTML = scene.svg ??= paintingSvg(scene.stamps, scene.library, scene.namespace); return; }
    schedule();
  }

  function setView(next: View, nextWidth: number, nextHeight: number): void {
    view = next; width = nextWidth; height = nextHeight; schedule();
  }

  function schedule(): void {
    if (scheduled || disposed || failed || !scene?.stamps.length || !layer || width <= 0 || height <= 0) return;
    scheduled = requestAnimationFrame(() => { scheduled = 0; selectTiles(); void paint(); });
  }

  function selectTiles(): void {
    if (!scene) return;
    const left = Math.max(bounds.left, view.cx - width / (2 * view.scale));
    const top = Math.max(bounds.top, view.cy - height / (2 * view.scale));
    const right = Math.min(bounds.right, view.cx + width / (2 * view.scale));
    const bottom = Math.min(bounds.bottom, view.cy + height / (2 * view.scale));
    let level = Math.max(0, Math.min(16, Math.ceil(Math.log2(scene.width * view.scale * Math.min(2, devicePixelRatio || 1) / TILE))));
    let size = scene.width / 2 ** level;
    const count = () => (Math.ceil(right / size) - Math.floor(left / size)) * (Math.ceil(bottom / size) - Math.floor(top / size));
    while (level > 0 && count() > MAX_VISIBLE) { level--; size *= 2; }
    wanted = [];
    if (right <= left || bottom <= top) return;
    for (let y = Math.floor(top / size); y < Math.ceil(bottom / size); y++) for (let x = Math.floor(left / size); x < Math.ceil(right / size); x++) {
      const key = `${level}/${x}/${y}`;
      wanted.push(cache.get(key) ?? { key, level, x: x * size, y: y * size, size, url: '', node: document.createElementNS(SVG, 'svg') });
    }
    // The centre enters first when navigating into a previously unseen area.
    wanted.sort((a, b) => Math.hypot(a.x + size / 2 - view.cx, a.y + size / 2 - view.cy) - Math.hypot(b.x + size / 2 - view.cx, b.y + size / 2 - view.cy));
  }

  function prune(): void {
    for (const [key, tile] of cache) {
      if (cache.size <= MAX_TILES) break;
      if (!tile.node.isConnected && !wanted.some(want => want.key === key)) { cache.delete(key); URL.revokeObjectURL(tile.url); }
    }
  }

  async function raster(tile: Tile, painting: FantasyTerrainPainting, images: Map<string, HTMLImageElement>): Promise<void> {
    const scale = TILE / tile.size, gutter = 1 / scale;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = TILE + 2;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Fantasy brushes require Canvas 2D.');
    context.imageSmoothingQuality = 'high';
    const left = tile.x - gutter, top = tile.y - gutter, right = tile.x + tile.size + gutter, bottom = tile.y + tile.size + gutter;
    // Stamps are sorted southwards. Binary search skips everything above this tile;
    // conservative maxima keep overhanging mountain silhouettes in their exact order.
    const stamps = painting.stamps; let low = 0, high = stamps.length;
    while (low < high) { const mid = (low + high) >>> 1; if (stamps[mid].y < top - maxHeight * .05) low = mid + 1; else high = mid; }
    const visible: Stamp[] = [];
    for (let i = low; i < stamps.length && stamps[i].y <= bottom + maxHeight * .95; i++) {
      const stamp = stamps[i];
      if (stamp.x + maxWidth / 2 < left || stamp.x - maxWidth / 2 > right) continue;
      const h = stampHeight(stamp, brushFrame(painting.library, stamp));
      if (stamp.x + stamp.width / 2 >= left && stamp.x - stamp.width / 2 <= right && stamp.y + h * .05 >= top && stamp.y - h * .95 <= bottom) visible.push(stamp);
    }
    paintingCanvas(context, visible, images, painting.library, { x: left, y: top, scale });
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not rasterize fantasy brushes.')), 'image/png'));
    tile.url = URL.createObjectURL(blob);
    try {
      const decoded = new Image(); decoded.src = tile.url; await decoded.decode();
      tile.node.setAttribute('x', String(tile.x)); tile.node.setAttribute('y', String(tile.y));
      tile.node.setAttribute('width', String(tile.size)); tile.node.setAttribute('height', String(tile.size));
      tile.node.setAttribute('viewBox', `1 1 ${TILE} ${TILE}`); tile.node.setAttribute('overflow', 'hidden');
      const image = document.createElementNS(SVG, 'image'); image.setAttribute('width', String(TILE + 2)); image.setAttribute('height', String(TILE + 2)); image.setAttribute('href', tile.url);
      tile.node.replaceChildren(image);
    } catch (error) { URL.revokeObjectURL(tile.url); tile.url = ''; throw error; }
  }

  async function paint(): Promise<void> {
    if (running || !scene || !layer || failed) return;
    running = true;
    const token = epoch, painting = scene;
    try {
      const images = await decodeLibrary(painting.library);
      while (token === epoch && !disposed) {
        const missing = wanted.find(tile => !cache.has(tile.key));
        if (!missing) break;
        await raster(missing, painting, images);
        if (token !== epoch || disposed) { URL.revokeObjectURL(missing.url); break; }
        cache.set(missing.key, missing);
        prune();
        // Yield between tiles so navigation remains interactive during preparation.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (token === epoch && !disposed && layer) {
        const key = wanted.map(tile => tile.key).sort().join(',');
        if (key !== current) { layer.replaceChildren(...wanted.map(tile => cache.get(tile.key)!.node)); current = key; }
        // Refresh LRU order, then evict only tiles absent from the visible scene.
        for (const tile of wanted) { const cached = cache.get(tile.key)!; cache.delete(tile.key); cache.set(tile.key, cached); }
        prune();
      }
    } catch (error) {
      if (token === epoch) {
        failed = true;
        if (layer) layer.innerHTML = painting.svg ??= paintingSvg(painting.stamps, painting.library, painting.namespace);
        release(); onError(error);
      }
    }
    finally { running = false; if (token !== epoch) schedule(); }
  }

  function clear(): void { epoch++; scene = undefined; layer?.replaceChildren(); layer = undefined; release(); }
  function dispose(): void { clear(); disposed = true; cancelAnimationFrame(scheduled); scheduled = 0; }
  return { setScene, setView, clear, dispose };
}
