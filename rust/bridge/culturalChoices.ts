/** Cultural defaults for the shared city controls. Keep automatic request values intact:
 * these describe the selected recipe, while generation may specialize individual zones. */
import catalogue from '../crates/core/src/urban/catalogue.json';

interface Culture {
  plan?: Record<string, string>;
  recipes?: { id: string; zone: string; preset: string }[];
  ring?: { enclosure?: Record<string, string> } | null;
  village?: { form?: string; enclosure?: Record<string, string> };
  hamlet?: { form?: string; enclosure?: Record<string, string> };
  phaseCount?: [number, number][];
  growth?: Culture & { minPop: number };
}
export interface CulturalChoiceContext {
  population?: number;
  phases?: number;
  zone?: string;
  recipe?: string;
  preset?: string;
  params?: Record<string, unknown>;
}
export function culturalChoice(culture: string, field: string, context: CulturalChoiceContext = {}): string | undefined {
  const source = (catalogue.cultures as unknown as Record<string, Culture>)[culture];
  if (!source) return undefined;
  const population = context.population ?? 2500,
    grown = !!source.growth && population >= source.growth.minPop;
  const data = grown ? source.growth! : source,
    plan = { ...data.plan };
  const phases = population < 1200 ? 1 : context.phases || (data.ring ? ([...(data.phaseCount ?? [])].reverse().find(([threshold]) => population >= threshold)?.[1] ?? 1) : 1);
  const zone = context.zone;
  let recipe = context.recipe && context.recipe !== 'auto' ? context.recipe : zone ? (source.recipes?.find(r => r.zone === zone)?.id ?? 'core') : 'core';
  const presets = catalogue.presets as unknown as Record<string, { params: Record<string, unknown> }>;
  if (grown && presets[`${culture}/grown-${recipe}`]) recipe = `grown-${recipe}`;
  const preset = context.preset && context.preset !== 'culture' ? context.preset : `${culture}/${recipe}`;
  const params = { ...presets[preset]?.params, ...context.params };
  if (population >= 1200 && phases > 1 && data.ring) {
    const enclosure = data.ring.enclosure;
    plan.fortification = enclosure?.wall ?? plan.fortification;
    plan.orientation = enclosure?.orientation ?? plan.orientation;
    const ring = presets[`${culture}/${grown ? 'grown-ring' : 'ring'}`];
    if (plan.pattern === 'grid' && ring?.params.streetOp === 'organic') plan.pattern = 'organic';
  } else if (population < 1200) {
    const form = population < 200 ? data.hamlet : data.village;
    plan.fortification = form?.enclosure?.wall ?? plan.fortification;
    plan.orientation = form?.enclosure?.orientation ?? plan.orientation;
    if (form?.form === 'ring') plan.pattern = 'radial';
    if (form?.form === 'terraces') plan.pattern = 'terraces';
    if (form?.form === 'grove') plan.pattern = 'dispersed';
  }
  if (field === 'preset') return preset;
  if (field === 'tissue') return zone ? String(params.streetOp ?? plan.pattern ?? 'organic') : (plan.pattern ?? 'organic');
  if (field === 'fortification') return plan.fortification === 'auto' ? (population >= 1000 ? 'wall' : 'none') : (plan.fortification ?? 'none');
  if (field === 'axisAlignment') return plan.orientation ?? 'road';
  if (field === 'operator') return params.plotOp === 'burgage' ? 'strips' : typeof params.plotOp === 'string' ? params.plotOp : undefined;
  return undefined;
}
