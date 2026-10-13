import manifest from './assets/fantasy/families/runtime/manifest.json';
import { createBrushLibrary, FAMILY_NAMES, type Atlas, type BrushFamily, type FantasyStyle } from '../../../rust/bridge/fantasyPainting';
// Assets belong to the page; workers receive terrain, never an embedded sprite library.
const urls = import.meta.glob('./assets/fantasy/families/runtime/*.webp', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;
const families = {} as Record<BrushFamily, Atlas>;
for (const family of FAMILY_NAMES) {
  const meta = manifest[family];
  const url = urls[`./assets/fantasy/families/runtime/${meta.file}`];
  if (!url) throw new Error(`Fantasy brush sheet missing: ${family}`);
  families[family] = { ...meta, rects: meta.rects as [number, number, number, number][], url };
}
export const fantasyLibraries = Object.fromEntries((['fantasy-ink', 'fantasy-color'] as FantasyStyle[]).map(style => [style, createBrushLibrary(style, families)])) as Record<FantasyStyle, ReturnType<typeof createBrushLibrary>>;
