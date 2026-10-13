/** Shared workshop protocol and temporary adaptation into the existing editor view. */
import type { Layout, LayoutConfig, ParcelConfig, Partition, Shape } from '../../../rust/bridge/urban';
import { normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { BenchLayout, BenchOptions, BenchParcels } from '../gen/urban/testbench';
import { benchMorph } from '../gen/urban/testbenchConfig';
import { Streets, LAB_OPEN } from '../gen/urban/streets';
import { detectPlotFrame } from '../gen/urban/plotAxes';
import type { MorphologyParams, Zone } from '../gen/urban/morphology';
import type { StreetRole } from '../gen/types';

export const WORKSHOP_CHANNEL = 'magna-urban-workshop';
export interface WorkshopCatalogue {
  cultures: Record<string, { label: string; recipes: { id: string; label: string; zone: Zone; preset: string }[]; nucleus?: { kind: string; builder?: string; compound?: boolean } }>;
  presets: Record<string, { label: string; params: MorphologyParams }>;
}
export interface WorkshopState {
  layoutConfig: LayoutConfig; parcelConfig: ParcelConfig; quarterSeed: string; parcelSeed: string;
  layouts?: Layout[]; partitions?: Partition[];
}
export interface WorkshopContext { source: 'fixture' | 'map'; siteCulture?: string; layoutConfig?: LayoutConfig; parcelConfig?: ParcelConfig; radius?: number }
export interface WorkshopRequest {
  channel: typeof WORKSHOP_CHANNEL; type: 'generate'; id: number; kind: 'quarters' | 'parcels';
  options: BenchOptions; seed: string; context: WorkshopContext; layouts?: Layout[];
}
export interface WorkshopResult {
  layouts: Layout[]; partitions?: Partition[]; water: Shape[]; contours: { x: number; y: number }[][]; shapeNames?: string[];
  layoutConfig?: LayoutConfig; parcelConfig?: ParcelConfig;
}
export function workshopOptions(config: LayoutConfig | ParcelConfig, previous: BenchOptions): BenchOptions {
  return { ...previous, culture: config.culture && config.culture !== 'site' ? config.culture : previous.culture,
    recipe: config.recipe, zone: (config.zone === 'auto' ? 'core' : config.zone) as Zone, density: config.density,
    ...('count' in config ? { count: config.count, radius: config.radius || previous.radius, rings: config.rings === 2 ? 2 : 1,
      placement: config.placement, monument: config.monument } as Partial<BenchOptions> : {}),
    stages: { ...previous.stages, ['count' in config ? 'streets' : 'plots']: { preset: config.preset, params: config.params } } };
}
export function normalizeWorkshopContext(context: WorkshopContext): WorkshopContext {
  return { ...context, layoutConfig: normalizeLayoutConfig(context.layoutConfig, true), parcelConfig: normalizeParcelConfig(context.parcelConfig) };
}
export function workshopConfig(options: BenchOptions, context: WorkshopContext, kind: 'quarters'): LayoutConfig;
export function workshopConfig(options: BenchOptions, context: WorkshopContext, kind: 'parcels'): ParcelConfig;
export function workshopConfig(options: BenchOptions, context: WorkshopContext, kind: 'quarters' | 'parcels'): LayoutConfig | ParcelConfig {
  context = normalizeWorkshopContext(context);
  const stage = options.stages?.[kind === 'quarters' ? 'streets' : 'plots'];
  const retained = kind === 'quarters' ? context.layoutConfig : context.parcelConfig;
  const config = { ...retained, culture: context.source === 'map' && retained?.culture === 'site' && options.culture === context.siteCulture ? 'site' : options.culture, recipe: options.recipe ?? 'core', zone: retained?.zone === 'auto' ? 'auto' : options.zone,
    density: options.density, preset: stage?.preset ?? 'culture', params: stage?.params ?? {},
    ...(kind === 'quarters' ? { composition: context.source === 'fixture' ? 'district' : context.layoutConfig?.composition ?? 'settlement', count: options.count, rings: options.rings ?? 1, radius: context.source === 'map' && context.layoutConfig?.radius === 0 && options.radius === context.radius ? 0 : options.radius,
      placement: options.placement === 'lateral' ? 'rectangle' : options.placement ?? 'center', monument: options.monument } : {}) };
  return kind === 'quarters' ? normalizeLayoutConfig(config) : normalizeParcelConfig(config);
}
export function workshopView(result: WorkshopResult, options: BenchOptions, nativeMorph?: MorphologyParams): { layout: BenchLayout; partition: BenchParcels } {
  const morph = nativeMorph ?? benchMorph(options, 'streets'), streets = new Streets();
  let quarterOffset = 0, blockOffset = 0;
  const quarters: BenchLayout['quarters'] = [], blocks: BenchLayout['blocks'] = [], parcels: BenchParcels['parcels'] = [];
  for (const layout of result.layouts) {
    for (const s of layout.streets) streets.connected.add(streets.add(s.path, s.widths, s.rank, s.role as StreetRole, 0));
    for (const q of layout.quarters) quarters.push({ lp: { pts: q.shape.outer, lab: q.shape.outer.map(() => LAB_OPEN) },
      phase: q.phase, zone: (q.zone ?? options.zone) as Zone, age: 1, kind: 'quarter', morph });
    for (const b of layout.blocks) blocks.push({ poly: b.shape.outer, quarter: quarterOffset + b.quarter,
      phase: b.phase ?? layout.quarters[b.quarter]?.phase ?? 0, zone: (b.zone ?? options.zone) as Zone, age: 1, kind: (b.kind === 'common' ? 'place' : b.kind) as BenchLayout['blocks'][number]['kind'], plotFrame: { ...detectPlotFrame(b.shape.outer), u: b.axis, v: { x: -b.axis.y, y: b.axis.x } } });
    for (const p of result.partitions?.find(p => p.key === layout.key)?.parcels ?? []) parcels.push({ poly: p.shape.outer,
      use: p.use, block: blockOffset + p.block, front: p.front ?? undefined });
    quarterOffset += layout.quarters.length; blockOffset += layout.blocks.length;
  }
  return { layout: { options, streets, quarters, blocks, morph, water: result.water, contours: result.contours, shapeNames: result.shapeNames },
    partition: { parcels, plots: [], compounds: [] } };
}

export function createWorkshopClient() {
  let nextId = 0;
  let catalogueReady: ((catalogue: WorkshopCatalogue) => void) | undefined;
  const pending = new Map<number, { resolve(result: WorkshopResult): void; reject(error: Error): void }>();
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== (location.protocol === 'file:' ? 'null' : location.origin) || event.data?.channel !== WORKSHOP_CHANNEL) return;
    if (event.data.type === 'catalogue') { catalogueReady?.(event.data.catalogue); return; }
    if (event.data.type !== 'result') return;
    const item = pending.get(event.data.id); if (!item) return;
    pending.delete(event.data.id);
    if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.result);
  });
  return {
    catalogue(): Promise<WorkshopCatalogue> {
      return new Promise(resolve => { catalogueReady = resolve; window.parent.postMessage({ channel: WORKSHOP_CHANNEL, type: 'catalogue' }, location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin); });
    },
    generate(request: Omit<WorkshopRequest, 'channel' | 'type' | 'id'>): Promise<WorkshopResult> {
      const id = ++nextId;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); window.parent.postMessage({ ...request, channel: WORKSHOP_CHANNEL, type: 'generate', id }, location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin); });
    },
    state(caseState: string, state: WorkshopState, source: WorkshopContext['source']): void { window.parent.postMessage({ channel: WORKSHOP_CHANNEL, type: 'state', caseState, state, source }, location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin); },
  };
}

/** Native physical geometry, kept separate from the legacy diagnostic view. */
export function workshopStreetSvg(layouts: Layout[]): string {
  let svg = '<g data-native-streets fill="none" stroke-linejoin="round">';
  const line = (a: { x: number; y: number }, b: { x: number; y: number }): string => `M${a.x},${a.y}L${b.x},${b.y}`;
  for (const street of layouts.flatMap(l => l.streets)) {
    let next = 1.25, marks = '';
    for (let i = 1; i < street.path.length; i++) {
      const a = street.path[i - 1], b = street.path[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const width = ((street.widths[i - 1] ?? 3) + (street.widths[i] ?? street.widths[i - 1] ?? 3)) / 2;
      const stairs = street.role === 'stairs', crossing = ['bridge', 'ford', 'causeway'].includes(street.role);
      svg += `<path data-street-role="${street.role}" d="${line(a, b)}" stroke="${crossing ? '#e3c28b' : '#fff'}" stroke-width="${stairs ? Math.min(2, width) : width}"/>`;
      if (stairs && length > 0.001) {
        const half = Math.min(2, width) * 0.48;
        for (; next < length; next += 2.5) { const x = a.x + dx * next / length, y = a.y + dy * next / length; marks += line({ x: x - dy * half / length, y: y + dx * half / length }, { x: x + dy * half / length, y: y - dx * half / length }); }
        next -= length;
      }
    }
    if (marks) svg += `<path data-street-role="steps" d="${marks}" stroke="#705d45" stroke-width=".3"/>`;
  }
  return svg + '</g>';
}
export function workshopEnclosureSvg(layouts: Layout[]): string {
  let svg = '<g data-native-enclosures fill="none">';
  for (const wall of layouts.flatMap(l => l.enclosures ?? [])) {
    if (wall.path.length < 2) continue;
    const points = [...wall.path, wall.path[0]]; let d = '';
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 0.001) continue;
      const gaps = wall.gates.flatMap(g => {
        const at = ((g.x - a.x) * dx + (g.y - a.y) * dy) / length, across = Math.abs((g.x - a.x) * dy - (g.y - a.y) * dx) / length;
        if (across > 6 || at < -6 || at > length + 6) return [];
        const half = Math.sqrt(36 - across * across); return [[Math.max(0, at - half), Math.min(length, at + half)]];
      }).sort((a, b) => a[0] - b[0]);
      const line = (from: number, to: number): string => `M${a.x + dx * from / length},${a.y + dy * from / length}L${a.x + dx * to / length},${a.y + dy * to / length}`;
      let start = 0; for (const [from, to] of gaps) { if (from > start) d += line(start, from); start = Math.max(start, to); }
      if (start < length) d += line(start, length);
    }
    const palisade = wall.kind === 'palisade';
    svg += `<path data-enclosure="${wall.kind}" d="${d}" stroke="${palisade ? '#72533a' : '#544d43'}" stroke-width="${palisade ? 2 : 3.5}"${palisade ? ' stroke-dasharray="1.3 .5"' : ''}/>`;
    if (!palisade) svg += `<path d="${d}" stroke="#b6a793" stroke-width="1.7"/>`;
  }
  return svg + '</g>';
}
