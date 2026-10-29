import { encodeRecipe, decodeRecipe } from './recipe';
export interface SituationPin { x: number; y: number; note: string }
export interface CitySituation {
  v: 1;
  q: string;
  view?: { cx: number; cy: number; scale: number };
  pins: SituationPin[];
  note?: string;
  created?: string;
}
/** The same MU2 recipe as the header, with optional camera and annotations. */
export async function encodeSituation(situation: CitySituation): Promise<string> {
  const params = new URLSearchParams(situation.q);
  if (situation.view) params.set('situationView', JSON.stringify(situation.view));
  if (situation.pins.length) params.set('situationPins', JSON.stringify(situation.pins));
  if (situation.note) params.set('situationNote', situation.note);
  return encodeRecipe({ stage: 'city', query: params.toString() });
}
export async function decodeSituation(text: string): Promise<CitySituation> {
  const input = text.trim();
  const recipe = decodeRecipe(input.startsWith('MU2.') ? input : /MU2\.[A-Za-z0-9_-]+/.exec(input)?.[0] ?? input);
  if (recipe.stage !== 'city' || recipe.terrain) throw new Error('Code de ville invalide.');
  const params = new URLSearchParams(recipe.query);
  const view = params.has('situationView') ? JSON.parse(params.get('situationView')!) : undefined;
  const pins = JSON.parse(params.get('situationPins') ?? '[]');
  if (view && (![view.cx, view.cy, view.scale].every(Number.isFinite) || view.scale <= 0)) throw new Error('Cadrage invalide.');
  if (!Array.isArray(pins) || !pins.every(p => p && [p.x, p.y].every(Number.isFinite) && typeof p.note === 'string')) throw new Error('Épingles invalides.');
  const note = params.get('situationNote') ?? undefined;
  for (const key of ['situationView', 'situationPins', 'situationNote']) params.delete(key);
  return { v: 1, q: params.toString(), view, pins, note };
}
