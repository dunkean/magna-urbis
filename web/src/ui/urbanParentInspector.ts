/** Read only native retained parent/member data, never current UI controls. */
import type { NativeParentRead } from './urbanParentNativeRead';
import type { ParentMapSelection } from './urbanParentColdWindow';
import { projectParentRecords } from './urbanParentVisual';
import { programmeOutcomeRows } from '../render/programmeOutcome';
const text = (value: unknown) => typeof value === 'number' ? Number.isFinite(value) ? String(value) : 'inconnu' : typeof value === 'string' && value ? value : 'inconnu';
export function nativeParentHasSelection(value: NativeParentRead, selection: ParentMapSelection): boolean {
  if (selection.parent_id !== value.record.id) return false;
  if (selection.kind === 'member') return value.record.members.some(m => m.id === selection.member_id && m.key === selection.member_key);
  return projectParentRecords([{ plan: value.plan, archive: value.archive, attempt: value.record.attempt }]).contexts.some(c => c.key === selection.context_key && c.kind === selection.context_kind);
}
export function nativeParentInspectionRows(value: NativeParentRead, selection?: ParentMapSelection): [string, string][] {
  const p = value.plan, programme = p.kind === 'single' ? p.programme : p.assembly.programme;
  const members = p.kind === 'single' ? [{ key: null, plan: p.building }] : p.assembly.members;
  const rows: [string, string][] = [ ['Parent natif', value.record.id], ['Parcelle', value.record.parcelId],
    ['Résultat archivé', p.kind === 'assembly' ? `Assemblage natif de ${members.length} membres` : 'Plan natif hérité (sa grammaire peut être complexe)'],
    ['Composition demandée conservée', text(programme?.composition)], ['Programme parent', 'Conservé une fois pour le parent'],
    ['Ménages demandés du modèle', text(programme?.households)], ['Capacité résidentielle / utile réel', 'Inconnus'],
    ['Inventaire archivé', `${members.length} membres · ${members.reduce((n, m) => n + m.plan.volumes.length, 0)} volumes natifs · ${members.reduce((n, m) => n + m.plan.volumes.reduce((s, v) => s + v.levels.length, 0), 0)} niveaux listés`],
    ['Archive native SHA256', value.archive.sha256] ];
  if (value.record.attempt) rows.push(['Tentative d’assemblage native', value.record.attempt.reason]);
  const need = programme?.housing_floor_need;
  rows.push(['Modèle de jeu conservé', need ? `${need.version} · ${need.model.family} · ${need.model.profile_provenance} · ${need.model.calibration}` : 'Inconnu (aucun modèle conservé)']);
  if (need) rows.push(['Convention utile du modèle', `${need.model.effective_floor_m2_per_household} m² utiles indicatifs par ménage · facteur de richesse ${need.model.wealth_factor}`]);
  if (p.kind === 'single') rows.push(...programmeOutcomeRows(p.building.programme_outcome));
  else rows.push(['Surface brute mesurée des niveaux', p.assembly.outcome.gross_floor_m2 === null ? 'Inconnue' : `${p.assembly.outcome.gross_floor_m2} m²`],
    ['Besoin utile indicatif du modèle', p.assembly.outcome.requested_useful_m2 === null ? 'Inconnu' : `${p.assembly.outcome.requested_useful_m2} m²`],
    ['Manque utile nécessaire selon le modèle', p.assembly.outcome.useful_shortfall_lower_bound_m2 === null ? 'Inconnu' : `${p.assembly.outcome.useful_shortfall_lower_bound_m2} m² au minimum (aucun habitant non logé déduit)`],
    ['Certification fonctionnelle', p.assembly.outcome.functional_certification]);
  if (selection?.kind === 'member') {
    const member = members.find(m => m.plan.id === selection.member_id && m.key === selection.member_key);
    if (member) rows.push(['Membre sélectionné', member.plan.id], ['Source / variante du membre', `${member.plan.recipe_id} · ${member.plan.variant_id}`],
      ['Culture / pack / mode déclarés', `${member.plan.culture.culture} · ${member.plan.culture.pack} · ${member.plan.culture.mode}`]);
  } else if (selection) rows.push(['Contexte sélectionné', `${selection.context_kind} · ${selection.context_key}`]);
  return rows;
}
export function nativeParentInspectionHtml(value: NativeParentRead, selection?: ParentMapSelection): string {
  const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return `<strong>Parent architectural archivé</strong><dl class="urban-inspection">${nativeParentInspectionRows(value, selection).map(([k, v]) => `<dt>${xml(k)}</dt><dd>${xml(v)}</dd>`).join('')}</dl><small>Le déficit de surface relève du modèle de jeu. Les membres, volumes ou pièces ne sont pas des ménages certifiés. Comparaison, édition, 3D et transfert Maisons de ce format ne sont pas encore pris en charge.</small>`;
}
