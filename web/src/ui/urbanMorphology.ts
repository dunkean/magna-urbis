import type { Layout } from '../../../rust/bridge/urban';
import type { LayoutConfig, SettlementKind } from '../../../rust/bridge/urbanConfig';
import { DEMOGRAPHIC_CLASSES, demographicLabel } from '../../../rust/bridge/settlementDemography';
const floor = (id: string): number => DEMOGRAPHIC_CLASSES.find(c => c.id === id)!.minimum;
/** Village class band: the only band where the village preferences choose the grammar. */
const VILLAGE = [floor('village'), floor('town')] as const;
const fmt = (n: number): string => n.toLocaleString('fr-FR');
const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const MORPHOLOGY_LABELS: Record<SettlementKind, string> = {
  single: 'Bâtiment isolé', ruin: 'Ruine', farmstead: 'Ferme isolée', camp: 'Campement', hamlet: 'Hameau le long d’un chemin',
  'street-village': 'Village-rue', 'nucleated-village': 'Village groupé', 'market-town': 'Bourg de marché',
  'walled-town': 'Ville close', city: 'Cité à quartiers', metropolis: 'Métropole à plusieurs centres',
};
const aliases = { auto: 'Automatique · classe démographique, culture et accès', nucleated: `Préférence de village groupé · classe Village (${fmt(VILLAGE[0])}–${fmt(VILLAGE[1] - 1)} hab.)`, ribbon: `Préférence de village-rue · classe Village (${fmt(VILLAGE[0])}–${fmt(VILLAGE[1] - 1)} hab.)` };
export const MORPHOLOGY_HINT = 'La grammaire automatique suit la classe démographique : Ferme → ferme isolée, Hameau → hameau, Village → village-rue ou groupé, Bourg → bourg, ville close ou cité selon culture et site, Ville → cité à quartiers, Métropole et Mégapole → métropole multicentre. Les boutons de population sont des raccourcis, pas des seuils. Une forme imposée prend priorité, y compris sur une intention isolée.';
export function morphologyOptions(current?: string): string {
  const entries = [...Object.entries(aliases), ...Object.entries(MORPHOLOGY_LABELS).map(([id, label]) => [id, `Imposer · ${label}`])];
  if (current && !entries.some(([id]) => id === current)) entries.push([current, `Valeur importée inconnue · ${current} (à corriger)`]);
  return entries.map(([id, label]) => `<option value="${escape(id)}">${escape(label)}</option>`).join('');
}
export function morphologyRequestLabel(value?: string): string {
  if (value === undefined) return 'Non conservée dans cet import';
  if (Object.hasOwn(aliases, value)) return (aliases as Record<string,string>)[value];
  if (Object.hasOwn(MORPHOLOGY_LABELS, value)) return (MORPHOLOGY_LABELS as Record<string,string>)[value];
  return `Valeur inconnue · ${value}`;
}
/** Evidence comes solely from the returned/imported plan. Never use current
 * selection, draft population or default config to reconstruct old evidence. */
export function morphologyEvidenceRows(layout: Pick<Layout, 'config' | 'programme' | 'archetype'>): [string, string][] {
  const p = layout.programme?.population;
  const population = typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : undefined;
  const config = layout.config;
  const legacy = config?.footprint?.mechanism === 'legacy';
  const kind = layout.archetype;
  const known = !!config && config.scope === 'settlement' && !legacy && kind && Object.hasOwn(MORPHOLOGY_LABELS, kind);
  const rows: [string,string][] = [
    ['Population du programme affiché', population === undefined ? 'Inconnue · programme natif absent' : `${population.toLocaleString('fr-FR')} hab.`],
    ['Classe démographique', population === undefined ? 'Inconnue' : demographicLabel(population)],
    ['Grammaire demandée dans ce plan', config ? morphologyRequestLabel(config.settlementForm) : 'Non conservée dans cet import'],
    ['Grammaire retournée', legacy ? `Ancienne composition · ${kind || 'non tracée'} (pas une preuve de grammaire native)` : known ? MORPHOLOGY_LABELS[kind as SettlementKind] : `Non reconnue ou non tracée${kind ? ` · ${kind}` : ''}`],
  ];
  if (config?.scope === 'district') rows.push(['Périmètre', 'Secteur isolé du banc · pas une agglomération complète']);
  if (config && Object.hasOwn(MORPHOLOGY_LABELS, config.settlementForm)) rows.push(['Compatibilité de la forme', 'Forçage explicite · compatibilité culturelle/historique non évaluée']);
  if (config && !['auto', 'nucleated', 'ribbon'].includes(config.settlementForm) && (config.programme?.intent ?? 'settlement') !== 'settlement') rows.push(['Priorité', 'Grammaire imposée prioritaire ; vérifier l’intention isolée conservée au programme']);
  if (config && (config.settlementForm === 'nucleated' || config.settlementForm === 'ribbon') && population !== undefined && (population < VILLAGE[0] || population >= VILLAGE[1])) rows.push(['Préférence de village', `Hors classe Village (${fmt(VILLAGE[0])}–${fmt(VILLAGE[1] - 1)} hab.) · préférence conservée mais non imposée`]);
  return rows;
}
export function morphologyEvidenceHtml(layouts?: readonly Pick<Layout, 'key' | 'config' | 'programme' | 'archetype'>[]): string {
  if (!layouts?.length) return '<small>Générez ou importez un plan pour lire sa classe et sa grammaire réellement appliquées.</small>';
  return layouts.map(l => `<article data-native-morphology="${escape(l.key)}"><strong>Population et grammaire du plan${layouts.length > 1 ? ` · ${escape(l.key)}` : ''}</strong><dl>${morphologyEvidenceRows(l).map(([label,value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl><small>La population du programme est une demande de planification ; elle ne mesure pas les habitants réellement logés.</small></article>`).join('');
}
/** Defaults only when explicitly requested by Reset; imports keep their ids. */
export function resetMorphology(config: LayoutConfig): LayoutConfig { return { ...config, settlementForm: 'auto' }; }
