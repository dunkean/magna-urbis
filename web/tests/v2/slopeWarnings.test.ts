import { expect, it } from 'vitest';
import { translateRuntimeMessage } from '../../src/v2/runtimeMessages';
it('shows the bounded slope housing shortfall in French', () => {
  const source="Slope town housing shortfall: usable terraces and the culture's maximum density cannot accommodate all requested households.";
  expect(translateRuntimeMessage(source,'en')).toBe(source);
  expect(translateRuntimeMessage(source,'fr')).toBe('Déficit de logements en pente : les terrasses utilisables et la densité maximale de la culture ne permettent pas de loger tous les ménages demandés.');
});
