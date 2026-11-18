import type { World } from '../gen/types';
import type { Shape, Layout } from '../../../rust/bridge/urban';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { blockEditKey } from '../../../rust/bridge/urbanBlockEdits';
import { quarterEditKey, quarterEditSource } from '../../../rust/bridge/urbanQuarterEdits';
import { nearestContour } from './contourGeometry';
import { pointInRing } from '../gen/geo/poly';
import { polygonArea } from './urbanEditOptions';

export type ContourKind = 'quarter' | 'block' | 'parcel';
export interface ContourTarget {
  kind: ContourKind;
  town: string;
  id: string;
  index: number;
  shape: Shape;
  layout: Layout;
  name: string;
  sourceId?: string;
  part?: number;
}
export interface ContourEdit {
  target: ContourTarget;
  shape?: Shape;
  parts?: Shape[];
}
export interface ContourState {
  world: World;
  settings: V2Settings;
}
/** Keep manually inserted collinear controls even when native polygon cleanup omits them. */
export function controlledContour(actual: Shape, controls: Shape | undefined): Shape {
  if (!controls || controls.holes.length !== actual.holes.length || Math.abs(polygonArea(actual) - polygonArea(controls)) > Math.max(0.1, polygonArea(actual) * 1e-6)) return actual;
  const same = (a: Shape, b: Shape) => [a.outer, ...a.holes].every(r => r.every(p => nearestContour(b, p).distance <= 0.15));
  return same(actual, controls) && same(controls, actual) ? controls : actual;
}
export function editableContours(world: World, kind: ContourKind, settings?: V2Settings): ContourTarget[] {
  const cities = (world.debug?.v2RustCities ?? {}) as Record<string, RustTownSnapshot>,
    out: ContourTarget[] = [];
  for (const place of world.settlements ?? []) {
    const snapshot = cities[place.key],
      layout = snapshot?.layouts[0];
    if (!layout) continue;
    if (kind === 'quarter')
      layout.quarters.forEach((q, index) => {
        const source = quarterEditSource(layout, index);
        if (!source.deleted) out.push({ kind, town: place.key, id: quarterEditKey(layout, index), index, shape: q.shape, layout, name: place.name ?? place.key, sourceId: source.sourceId, part: source.part });
      });
    else if (kind === 'block')
      layout.blocks.forEach((b, index) => {
        const id = blockEditKey(layout, index);
        if (id && b.kind !== 'deleted') {
          const match = id.match(/^(block:[^/]+)\/(\d+)$/);
          out.push({ kind, town: place.key, id, index, shape: b.shape, layout, name: place.name ?? place.key, sourceId: match?.[1] ?? id, part: match ? Number(match[2]) : 0 });
        }
      });
    else
      snapshot.partitions?.[0]?.parcels.forEach((p, index) => {
        if (p.id) {
          const match = p.id.match(/^(.*)\/part-(\d+)$/);
          out.push({ kind, town: place.key, id: p.id, index, shape: p.shape, layout, name: place.name ?? place.key, sourceId: match?.[1] ?? p.id, part: match ? Number(match[2]) : 0 });
        }
      });
  }
  return out
    .filter(t => t.shape.outer.length >= 3)
    .map(t => {
      const local = settings?.urban?.local?.[t.town],
        entries = t.kind === 'quarter' ? local?.layout?.overrides?.quarters : t.kind === 'block' ? local?.parcels?.overrides?.blocks : local?.parcels?.overrides?.parcels;
      const own = entries?.[t.id] as { shape?: Shape; parts?: Shape[] } | undefined,
        source = (t.sourceId ? entries?.[t.sourceId] : undefined) as { parts?: Shape[] } | undefined;
      return { ...t, shape: controlledContour(t.shape, own?.shape ?? source?.parts?.[t.part ?? 0] ?? own?.parts?.[0]) };
    });
}
export function contourAt(targets: ContourTarget[], p: { x: number; y: number }, tolerance: number): ContourTarget | undefined {
  const boundaries = targets
    .map(target => ({ target, distance: nearestContour(target.shape, p).distance }))
    .filter(h => h.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance);
  return boundaries[0]?.target ?? targets.filter(t => pointInRing(t.shape.outer, p) && !t.shape.holes.some(h => pointInRing(h, p))).sort((a, b) => polygonArea(a.shape) - polygonArea(b.shape))[0];
}
/** Geometry edits keep the area's other settings. Native descendants inherit their retained controls. */
export function settingsForContourEdit(settings: V2Settings, edit: ContourEdit): V2Settings {
  const next = structuredClone(settings),
    { target } = edit;
  next.urban ??= { backend: settings.runtime?.backend ?? 'rust' };
  const locals = (next.urban.local ??= {}),
    local = (locals[target.town] ??= {});
  let entries: Record<string, unknown>;
  if (target.kind === 'quarter') {
    local.layout ??= {};
    local.layout.overrides ??= {};
    entries = local.layout.overrides.quarters ??= {};
  } else {
    local.parcels ??= {};
    local.parcels.overrides ??= {};
    entries = target.kind === 'block' ? (local.parcels.overrides.blocks ??= {}) : (local.parcels.overrides.parcels ??= {});
  }
  const previous = (entries[target.id] ?? {}) as Record<string, unknown>,
    patch = { ...previous };
  const sourceId = target.sourceId ?? target.id,
    source = (entries[sourceId] ?? {}) as Record<string, unknown>,
    oldParts = source.parts as Shape[] | undefined;
  if ((target.kind === 'block' || target.kind === 'quarter') && oldParts && !edit.shape && !edit.parts && target.id === sourceId) {
    entries[sourceId] = { ...source, deletedParts: [...new Set([...((source.deletedParts as number[]) ?? []), target.part ?? 0])] };
    return next;
  }
  if (oldParts && (edit.shape || edit.parts)) {
    const parts = structuredClone(oldParts),
      at = target.part ?? 0;
    parts[at] = edit.shape ?? edit.parts![0];
    if (edit.parts) parts.push(...edit.parts.slice(1));
    entries[sourceId] = { ...source, parts };
    return next;
  }
  if (!edit.shape && !edit.parts) {
    patch.deleted = target.kind === 'parcel' ? 'merge' : true;
    delete patch.shape;
    if (target.kind !== 'parcel') delete patch.parts;
  } else {
    delete patch.deleted;
    if (edit.parts) {
      patch.parts = edit.parts;
      delete patch.shape;
    } else {
      patch.shape = edit.shape;
      delete patch.parts;
    }
  }
  entries[target.id] = patch;
  return next;
}
