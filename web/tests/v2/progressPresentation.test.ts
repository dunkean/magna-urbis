import { describe, expect, it } from 'vitest';
import type { V2Progress } from '../../src/v2/contracts';
import { progressPresentation } from '../../src/v2/progressPresentation';
import { translate } from '../../src/v2/i18n';

describe('generation progress card', () => {
  it('keeps a global heading as settlements and their local counters advance', () => {
    const events: V2Progress[] = [
      { stage: 'town', label: 'Valmont: plan, streets, parcels and buildings…', completed: 0, total: 3, settlement: { index: 1, total: 3, name: 'Valmont' } },
      { stage: 'urban-buildings', label: 'Rust · maisons 1/120…', completed: 1, total: 120, settlement: { index: 1, total: 3, name: 'Valmont' } },
      { stage: 'urban-layout', label: 'Rust · urban composition…', completed: 0, total: 5, settlement: { index: 2, total: 3, name: 'Rivebois' } },
      { stage: 'urban-buildings', label: 'Rust · maisons 10/30…', completed: 10, total: 30, settlement: { index: 3, total: 3, name: 'Les Prés' } },
    ];
    for (const event of events) {
      const presentation = progressPresentation(event);
      expect(presentation.title).toBe('Generating settlements…');
      expect(presentation.details[0]).toBe(event.label);
    }
    expect(translate(progressPresentation(events[0]).title, 'fr')).toBe('Génération des lieux…');
    expect(progressPresentation(events[2]).details.join(' · ')).not.toContain('Valmont');
  });

  it('keeps terrain phases and their measured download details in their original positions', () => {
    const progress: V2Progress = { stage: 'runtime-download', label: 'Downloading terrain runtime…', completed: 512, total: 1024, detail: '512 / 1024 bytes' };
    expect(progressPresentation(progress)).toEqual({ title: progress.label, details: [progress.detail] });
  });

  it('retains cache information and returns to a global finalization phase after the last settlement', () => {
    const settlement = { index: 3, total: 3, name: 'Les Prés' };
    expect(progressPresentation({ stage: 'urban-layout', label: 'Rust · plan urbain réutilisé', completed: 1, total: 5, settlement, cache: 'memory' }).details).toEqual(['Rust · plan urbain réutilisé', 'Memory cache reused']);
    expect(progressPresentation({ stage: 'complete', label: 'Settlements generated', completed: 1, total: 1 })).toEqual({ title: 'Settlements generated', details: ['Computing in a worker'] });
  });
});
