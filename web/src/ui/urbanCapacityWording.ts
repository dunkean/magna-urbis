/** Display-only qualification of the exact historical parcel-allocation
 * warning. Original archives and every numeric string remain unchanged. */
export function urbanCapacityWarningText(value: string): string {
  const match = /^Capacité : (.*) — ([0-9]+) % des ménages logés\.$/u.exec(value);
  if (!match) return value;
  const steps = match[1].replace('les îlots réels logent moins que la prévision du tissu',
    'l’estimation parcellaire sur les îlots réels est inférieure à la prévision du tissu');
  return `Capacité parcellaire estimée après affectation (ancien rapport) : ${steps} — ${match[2]} % du besoin en ménages couvert selon le modèle. Capacité habitante non évaluée.`;
}
export const PARCEL_CAPACITY_SCOPE = 'Les valeurs parcellaires décrivent le modèle d’affectation ; elles ne prouvent pas des ménages logés.';
