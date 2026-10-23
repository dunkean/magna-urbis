import { createTiltedStrataScenario, geologyFromScenario, validateGeologyScenario, type TiltedStrataScenario } from '../geologyScenario';
import type { SurfaceCompileInput } from '../model';

export const SURFACE_GEOLOGY_QUERY_KEYS = ['surface_geology', 'surface_geology_descriptor'] as const;
export interface SurfaceGeologyOptions { geologyScenario?: TiltedStrataScenario; signal?: AbortSignal; memoryBudgetBytes?: number; frameTranslationX?: number; frameTranslationZ?: number }
const parameters = (query: string | URLSearchParams) => typeof query === 'string' ? new URLSearchParams(query) : query;

/** No inferred geology. The named demonstration has one fixed world anchor;
 * never derive it from a crop, current tile, camera or local height statistics. */
export function surfaceGeologyScenario(query: string | URLSearchParams, override?: TiltedStrataScenario): TiltedStrataScenario | undefined {
  if (override !== undefined) { validateGeologyScenario(override); return structuredClone(override); }
  const params = parameters(query), selection = params.get('surface_geology'), descriptor = params.get('surface_geology_descriptor');
  if (!selection) {
    if (descriptor !== null) throw new Error('surface_geology_descriptor requires explicit surface_geology=tilted-strata-v1');
    return undefined;
  }
  if (selection !== 'tilted-strata-v1') throw new Error(`Unsupported explicit surface geology scenario: ${selection}`);
  if (descriptor === null) return createTiltedStrataScenario();
  if (!descriptor.length || descriptor.length > 65536) throw new Error('Invalid explicit geology descriptor size (1..65536 characters)');
  let scenario: unknown;
  try { scenario = JSON.parse(descriptor); } catch { throw new Error('Invalid surface_geology_descriptor JSON'); }
  validateGeologyScenario(scenario);
  return structuredClone(scenario);
}

/** Assign the physical source/crop coordinates first. A common frame translation
 * shifts both terrain coordinates and this descriptor anchor, never physical contacts. Keeps supplied
 * observed geology when no demonstration was explicitly requested. */
export function applySurfaceGeology<T extends SurfaceCompileInput>(input: T, query: string | URLSearchParams, options: SurfaceGeologyOptions = {}): T {
  let scenario = surfaceGeologyScenario(query, options.geologyScenario);
  const dx=options.frameTranslationX ?? 0, dz=options.frameTranslationZ ?? 0;
  if (![dx,dz].every(Number.isFinite)) throw new Error('Invalid geology coordinate-frame translation');
  if (scenario && (dx || dz)) scenario={...scenario,originX:scenario.originX+dx,originZ:scenario.originZ+dz};
  return scenario ? { ...input, geology: geologyFromScenario(input.terrain, scenario, options) } : input;
}

/** Preserve an exact descriptor in shared recipes; source objects are untouched. */
export function withSurfaceGeologyQuery(query: string, scenario: TiltedStrataScenario): string {
  validateGeologyScenario(scenario);
  const params = new URLSearchParams(query);
  params.set('surface_geology', scenario.id);
  params.set('surface_geology_descriptor', JSON.stringify(scenario));
  return params.toString();
}
export function copySurfaceGeologyQuery(target: URLSearchParams, source: string | URLSearchParams): void {
  const params = parameters(source);
  for (const key of SURFACE_GEOLOGY_QUERY_KEYS) {
    if (params.has(key)) target.set(key, params.get(key)!); else target.delete(key);
  }
}
