import { describe, expect, it } from 'vitest';
import { executionOverview } from '../src/v2/executionOverview';
import { defaultSettings } from '../src/v2/settings';
import type { World } from '../src/gen/types';

describe('execution overview', () => {
  it('does not claim a selected engine has already run', () => {
    const settings = defaultSettings(); settings.runtime!.backend = 'native';
    const rows = executionOverview(settings);
    expect(rows[0].configured).toContain('native service');
    expect(rows.every(row => row.actual === undefined)).toBe(true);
  });
  it('shows retained CPU fallback evidence separately from the next GPU choice', () => {
    const settings = defaultSettings(); settings.runtime!.compute = 'gpu'; settings.urban = { backend: 'native' };
    const world = { stats: { backend: 'rust-wasm-cpu', generationBackend: 'cpu', hydrologyBackend: 'vector-cpu' } } as unknown as World;
    const rows = executionOverview(settings, world, 'gpu');
    expect(rows[0]).toMatchObject({ actual: 'cpu' });
    expect(rows[0].configured).toContain('gpu');
    expect(rows[1].actual).toBe('vector-cpu');
    expect(rows[2]).toMatchObject({ configured: 'Rust · native service · CPU', actual: undefined });
    expect(rows[3].actual).toBe('gpu');
  });
});
