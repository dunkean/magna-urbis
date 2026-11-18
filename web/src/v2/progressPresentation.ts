import type { V2Progress } from './contracts';
import { registerMessages } from './i18n';

registerMessages({ 'Generating settlements…': { en: 'Generating settlements…', fr: 'Génération des lieux…' } });

/** The heading describes the whole run; the settlement and its current phase belong below it. */
export function progressPresentation(progress: V2Progress): { title: string; details: string[] } {
  const detail = progress.detail ?? (progress.cache === 'memory' ? 'Memory cache reused' : progress.cache === 'disk' ? 'Terrain restored from disk' : 'Computing in a worker');
  return progress.settlement ? { title: 'Generating settlements…', details: [progress.label, detail] } : { title: progress.label, details: [detail] };
}
