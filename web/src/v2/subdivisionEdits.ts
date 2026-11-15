import type { V2Settings } from './contracts';
import { rerollSeed } from '../../../rust/bridge/generationSeed';

export interface SubdivisionChildren { parcels: readonly string[]; requests: readonly string[] }
/** Explicit propagation discards lower overrides so every child inherits this scope. */
export function resetSubdivisionChildren(settings: V2Settings, key: string, kind: 'quarter' | 'parcel', children: SubdivisionChildren): void {
  const scope = settings.urban?.local?.[key];
  if (kind === 'quarter') for (const id of children.parcels) {
    if (scope?.parcels?.overrides?.parcels) delete scope.parcels.overrides.parcels[id];
  }
  for (const id of children.requests) if (settings.urban?.buildings) {
    delete settings.urban.buildings[`${key}/${id}`];
    delete settings.urban.buildings[id];
  }
}
/** Explicit child seeds reroll too; recipes, materials and style pins stay intact. */
export function rerollSubdivisionBuildings(settings: V2Settings, key: string, children: SubdivisionChildren): void {
  settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' };
  const edits = settings.urban.buildings ??= {};
  for (const id of children.requests) {
    const own = edits[`${key}/${id}`] ?? edits[id] ?? {};
    edits[`${key}/${id}`] = { ...own, seed: rerollSeed(String(own.seed ?? `${settings.options.seed}/${id}`), ['house']) };
  }
}
