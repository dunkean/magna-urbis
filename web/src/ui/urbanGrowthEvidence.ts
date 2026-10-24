/** Read-only evidence from the returned/imported growth phase. Neither current
 * culture controls nor mix rules are inputs; no historical period is inferred. */
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function growthPhaseCultureHtml(phase?: { culture?: unknown } | null): string {
  const culture = phase?.culture;
  const known = typeof culture === 'string' && culture.length > 0;
  return `<small data-phase-culture${known ? ` data-culture="${xml(culture)}"` : ''}>Profil urbain enregistré : ${known ? xml(culture) : 'inconnu · non renseigné dans cette phase'}</small>`;
}
/** Ordinal retained key, not an architectural source era or a date. */
export function growthStepLabel(epoch: number): string { return `Étape ${epoch + 1}`; }
