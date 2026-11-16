import type { Layout, Shape } from './urban';
import type { ParcelConfig } from './urbanConfig';

const identities = new WeakMap<Shape, Map<string, string>>();
/** Editor identity belongs to the retained geometry, never its movable array position. */
export function blockEditId(layout: Pick<Layout, 'key'>, shape: Shape): string {
  let keys = identities.get(shape); if (!keys) identities.set(shape, keys = new Map());
  const cached = keys.get(layout.key); if (cached) return cached;
  const canonical = (ring: Shape['outer']) => {
    const points = ring.map(p => `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`);
    if (points.length > 1 && points[0] === points.at(-1)) points.pop();
    if (!points.length) return '';
    const first = [...points].sort()[0], candidates: string[] = [];
    for (let i = 0; i < points.length; i++) if (points[i] === first) {
      candidates.push([...points.slice(i), ...points.slice(0, i)].join(';'));
      candidates.push(Array.from({length:points.length},(_,j)=>points[(i + points.length - j)%points.length]).join(';'));
    }
    return candidates.sort()[0];
  };
  let hash = 0xcbf29ce484222325n;
  const value = JSON.stringify([layout.key, canonical(shape.outer), shape.holes.map(canonical).sort()]);
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const id = `block:${hash.toString(16).padStart(16,'0')}`; keys.set(layout.key, id); return id;
}
/** The native contract uses indices only within one request. Resolve saved IDs after laying out the town. */
export function runtimeBlockEdits(config: ParcelConfig, layouts: readonly Layout[]): ParcelConfig {
  if (!config.overrides?.blocks || !Object.keys(config.overrides.blocks).length) return config;
  const layout = layouts[0];
  const blocks = Object.fromEntries((layout?.blocks ?? []).flatMap((block,index) => {
    const edit = config.overrides!.blocks![blockEditId(layout, block.shape)];
    return edit ? [[String(index), edit]] : [];
  }));
  return { ...config, overrides: { ...config.overrides, blocks } };
}
