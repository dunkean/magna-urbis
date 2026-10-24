/** Selection-only description of explicit retained bodies/levels. No geometry,
 * catalogue defaults, source archive, procedural draw or current wishes. */
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export interface RetainedBodyMember { readonly role: string | null; readonly levels: number | null }
export function retainedBodyInventory(value: unknown): readonly RetainedBodyMember[] | null {
  if (!object(value) || value.simplification !== 'architectural_plan' && value.simplification !== 'recipe_volumes'
    || !Array.isArray(value.volumes) || !value.volumes.length) return null;
  const members: RetainedBodyMember[] = [];
  for (const volume of value.volumes) {
    if (!object(volume)) return null;
    const levels = volume.levels;
    const known = Array.isArray(levels) && levels.length > 0 && levels.every((level, i) => object(level)
      && level.index === i && typeof level.z_m === 'number' && Number.isFinite(level.z_m)
      && typeof level.height_m === 'number' && Number.isFinite(level.height_m) && level.height_m > 0);
    members.push(Object.freeze({ role: typeof volume.role === 'string' && volume.role ? volume.role : null,
      levels: known ? levels.length : null }));
  }
  return Object.freeze(members);
}
export function retainedBodyInventoryRows(value: unknown): [string, string][] {
  const bodies = retainedBodyInventory(value), roles = new Map<string, number>();
  for (const body of bodies ?? []) { const role = body.role ?? 'rôle non renseigné'; roles.set(role, (roles.get(role) ?? 0) + 1); }
  return [
    ['Composition demandée (plan conservé)', 'Inconnue (préférence non archivée dans le bilan natif)'],
    ['Grammaire native résolue (plan conservé)', 'Inconnue (non exposée dans le bilan natif)'],
    ['Inventaire des corps retenus', bodies ? `${bodies.length} corps · rôles structurels : ${[...roles].map(([role, n]) => `${role} ×${n}`).join(', ')}` : 'Inconnu (inventaire absent ou non reconnu)'],
    ['Niveaux enregistrés par corps', bodies ? bodies.map((body, i) => `corps ${i + 1} : ${body.levels ?? '?'} niveau(x)`).join(' · ') : 'Inconnus'],
    ['Portée de l’inventaire des corps', 'Membres enregistrés ; aucun ménage, usage intérieur ni type Single/Compound déduit'],
  ];
}
