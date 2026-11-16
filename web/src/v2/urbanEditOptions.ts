import servicesJson from '../../../rust/crates/core/src/urban/services.json';
import admissionJson from '../../../rust/crates/houses/data/urban-admission.json';
import { urbanRoleChoices } from './urbanRoleNames';

type Service = { role: string; function: string; area: number[]; requires?: string };
const services = servicesJson as unknown as { cultures: Record<string, string>; families: Record<string, Service[]>; cultureServices: Record<string, Service[]>; rural: Service[]; harbour: Service[] };
type Source = { modes: string[]; urban_roles?: string[]; urban_role?: string; culture_id?: string; pack_id: string; eras?: string[]; nominal_width_m?: number[]; nominal_depth_m?: number[]; sources?: { nominal_width_m: number[]; nominal_depth_m: number[]; temporal?: { eras?: string[] }; inspired_only?: boolean }[] };
const sources = [...admissionJson.functional_programmes.programmes, ...admissionJson.functional_choices.rules] as unknown as Source[];
export interface UrbanEditContext {
  culture: string; area?: number; architecture?: string; pack?: string; mode?: string; period?: string; navigableAccess?: boolean;
}
/** Declared cultural types and metric/source eligibility; final polygon/access admission remains native. */
export function compatibleBuildingTypes(context: UrbanEditContext): { value: string; label: string }[] {
  const labels = new Map(urbanRoleChoices().map(choice => [choice.value, choice.label]));
  const declared = [...(services.families[services.cultures[context.culture]] ?? []), ...(services.cultureServices[context.culture] ?? []), ...services.rural,
    ...(context.navigableAccess ? services.harbour : [])];
  const mode = context.mode === 'strict' ? 'historical_strict' : context.mode === 'fantasy' ? 'fantasy_mix' : context.mode === 'inspired' || !context.mode ? 'historical_inspired' : context.mode;
  const period = context.period;
  const compatible = new Set<string>(['dwelling']);
  for (const entry of declared) {
    if (!labels.has(entry.role) || entry.requires === 'navigable' && !context.navigableAccess) continue;
    if (!Number.isFinite(context.area) || context.area! < (entry.area[0] ?? Infinity)) continue;
    if (context.architecture === 'compact' || context.architecture === 'detailed') {
      const supported = sources.some(source => (source.urban_role === entry.role || source.urban_roles?.includes(entry.role))
        && (source.culture_id ? source.culture_id === context.culture : source.pack_id === context.pack)
        && source.modes.includes(mode)
        && (!period || period === 'any' || !source.eras?.length || source.eras.includes(period))
        && (source.sources ?? [source]).some(candidate => {
          const width = candidate.nominal_width_m?.[0], depth = candidate.nominal_depth_m?.[0];
          return width !== undefined && depth !== undefined && width > 0 && depth > 0 && width * depth <= context.area!;
        }));
      if (!supported) continue;
    }
    compatible.add(entry.role);
  }
  return [...compatible].map(value => ({ value, label: labels.get(value)! }));
}

export function polygonArea(shape: { outer: readonly { x: number; y: number }[]; holes?: readonly (readonly { x: number; y: number }[])[] }): number {
  const area = (ring: readonly { x: number; y: number }[]) => Math.abs(ring.reduce((sum, p, i) => { const next = ring[(i + 1) % ring.length]; return sum + p.x * next.y - next.x * p.y; }, 0)) / 2;
  return Math.max(0, area(shape.outer) - (shape.holes ?? []).reduce((sum, hole) => sum + area(hole), 0));
}
