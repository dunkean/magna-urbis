import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORTIFICATION_STYLES, defaultLayoutConfig, normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';

describe('fortification style configuration', () => {
  it('keeps old links on the native cultural default without changing their enclosure kind', () => {
    expect(defaultLayoutConfig().fortificationStyle).toBe('auto');
    for (const fortification of ['culture', 'none', 'wall', 'palisade'] as const) {
      const saved = { fortification, count: 5, params: { fieldTwist: 0.4 } };
      const restored = normalizeLayoutConfig(saved, true);
      expect(restored).toMatchObject({ ...saved, fortificationStyle: 'auto' });
      expect(saved).not.toHaveProperty('fortificationStyle');
    }
  });

  it('preserves every explicit style through the existing URL JSON round trip', () => {
    for (const fortificationStyle of FORTIFICATION_STYLES) {
      const config = { ...defaultLayoutConfig(), fortificationStyle };
      const params = new URLSearchParams({ urban: JSON.stringify({ layoutConfig: config }) });
      const saved = JSON.parse(new URLSearchParams(params.toString()).get('urban')!);
      expect(normalizeLayoutConfig(saved.layoutConfig, true)).toEqual(config);
    }
  });

  it('exposes exactly the native styles, with auto as the only additional choice', () => {
    const source = readFileSync(new URL('../../rust/crates/core/src/urban/fortification.rs', import.meta.url), 'utf8');
    const styles = source.match(/const STYLES:[^=]+=[\s\S]*?\[([\s\S]*?)\];/)?.[1];
    expect(styles).toBeDefined();
    const native = [...styles!.matchAll(/"([a-z-]+)"/g)].map(match => match[1]);
    expect(FORTIFICATION_STYLES).toEqual(['auto', ...native]);
  });
});
