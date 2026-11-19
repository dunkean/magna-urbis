/** Small preview thumbnails only; independent of projects, browser models and engine caches. */
const KEY = 'magna-urbis-city-previews-v1',
  LIMIT = 6,
  MAX_IMAGE = 256000;
const build = `${import.meta.env.VITE_BUILD_COMMIT ?? 'dev'}:${import.meta.env.VITE_BUILD_DATE ?? 'dev'}`;
interface Thumbnail {
  source: string;
  width: number;
  height: number;
  image: string;
}
interface Cache {
  build: string;
  thumbnails: Thumbnail[];
}
function read(): Thumbnail[] {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved || saved.length > 2000000) return [];
    const cache = JSON.parse(saved) as Cache;
    return cache.build === build && Array.isArray(cache.thumbnails) ? cache.thumbnails.slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}
export function cachedCityPreview(source: string, width: number, height: number): string | undefined {
  const item = read().find(item => item.source === source && item.width === width && item.height === height);
  return typeof item?.image === 'string' && item.image.length <= MAX_IMAGE && item.image.startsWith('data:image/png;base64,') ? item.image : undefined;
}
export function cacheCityPreview(source: string, width: number, height: number, canvas: HTMLCanvasElement): void {
  try {
    const image = canvas.toDataURL('image/png');
    if (image.length > MAX_IMAGE || source.length > 65536 || width <= 0 || height <= 0) return;
    const thumbnails = [{ source, width, height, image }, ...read().filter(item => item.source !== source || item.width !== width || item.height !== height)].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify({ build, thumbnails }));
  } catch {
    /* Third-party storage, private browsing or a full quota must not block a city. */
  }
}
