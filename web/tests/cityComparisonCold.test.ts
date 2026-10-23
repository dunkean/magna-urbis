import { expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { createCityComparison, type ComparisonSources } from '../src/ui/cityComparison';

it('compares cold accepted cartography with its original sites without loading a native scene', () => {
  const projection = projectNativeBuildingChunk(fixture.chunks[0].delta as unknown as PlacementBatch), requests: unknown[] = [];
  let current: ComparisonSources = { layouts: [], partitions: [], scene: projection, requests };
  const silhouette = vi.fn((): PlacementBatch => ({ schema_version: '1', generator_version: 'silhouette', buildings: [], refusals: [], open_spaces: [] }));
  const comparison = createCityComparison({ current: () => current, silhouette, repaint: vi.fn() });
  const initial = comparison.api.begin(); expect(silhouette).toHaveBeenCalledWith(requests);
  for (const architecture of ['compact', 'silhouette'] as const) for (const renderView of ['parcels', 'buildings'] as const) {
    expect(comparison.api.show({ architecture, renderView }).identity).toEqual(initial.identity);
    comparison.painted(false, { blocks: 0, parcels: 0, streets: 0, buildings: projection.buildings.length });
  }
  expect(comparison.api.snapshot().frameSerial).toBe(4);
  expect('resolved' in projection.buildings[0]).toBe(false);
  current = { ...current, scene: { ...projection } };
  expect(() => comparison.api.snapshot()).toThrow('comparaison annulée');
});
