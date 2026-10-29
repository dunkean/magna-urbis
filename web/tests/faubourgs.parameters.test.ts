import { describe, expect, it } from 'vitest';
import { defaultLayoutConfig, normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';
import { encodeSituation, decodeSituation } from '../src/ui/citySituation';

describe('gate village strength', () => {
  it('preserves defaults and migrates the legacy flag, with explicit zero taking precedence', () => {
    expect(defaultLayoutConfig().gateVillage).toBe(0);
    expect(normalizeLayoutConfig({}).gateVillage).toBe(0);
    expect(normalizeLayoutConfig({ gateVillages: true }).gateVillage).toBe(1);
    expect(normalizeLayoutConfig({ gateVillages: true, gateVillage: 0 }).gateVillage).toBe(0);
    expect(normalizeLayoutConfig({ gateVillage: 2 }).gateVillage).toBe(1);
  });
  it.each([0, 0.5, 1])('keeps %s in share links and MU1', async gateVillage => {
    const layoutConfig = normalizeLayoutConfig({ gateVillage });
    const q = new URLSearchParams({ urban: JSON.stringify({ layoutConfig }) }).toString();
    const saved = await decodeSituation(await encodeSituation({ v: 1, q, pins: [] }));
    const urban = JSON.parse(new URLSearchParams(saved.q).get('urban')!);
    expect(normalizeLayoutConfig(urban.layoutConfig).gateVillage).toBe(gateVillage);
  });
});
