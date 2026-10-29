import { describe, it, expect } from 'vitest';
import { defaultLayoutConfig, normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';
import { encodeSituation, decodeSituation } from '../src/ui/citySituation';
import { cityWallSvg } from '../src/render/cityWalls';
import type { Enclosure, Shape } from '../../rust/bridge/urban';

const keys = ['oldEnclosureCitadel', 'medievalWalls', 'riverControl', 'dryDitches', 'gateVillages'] as const;
describe('Reddit wall options', () => {
  it('defaults old situations to the unchanged disabled path', () => {
    for (const key of keys) {
      expect(defaultLayoutConfig()[key]).toBe(false);
      expect(normalizeLayoutConfig({}, true)[key]).toBe(false);
    }
  });
  it('keeps all five native options in the share query and MU1 situation', async () => {
    const layoutConfig = normalizeLayoutConfig(Object.fromEntries(keys.map(k => [k, true])));
    const q = new URLSearchParams({ urban: JSON.stringify({ layoutConfig }) }).toString();
    const code = await encodeSituation({ v: 1, q, pins: [] });
    const saved = await decodeSituation(code);
    const urban = JSON.parse(new URLSearchParams(saved.q).get('urban')!);
    for (const key of keys) expect(normalizeLayoutConfig(urban.layoutConfig)[key]).toBe(true);
  });
  it('maps saved wall toggles to independent parameters and respects explicit zero', () => {
    const old = normalizeLayoutConfig({ medievalWalls: true, riverControl: true, dryDitches: true });
    expect([old.wallStiffness, old.wallTerrain, old.wallTowerSpacing, old.riverControlMode]).toEqual([1, 1, 30, 'bank-walls-chain']);
    const changed = normalizeLayoutConfig({ ...old, wallStiffness: 0, wallTerrain: 0.5, wallTowerSpacing: 90, ditchWetness: 0, riverControlMode: 'none' });
    expect([changed.wallStiffness, changed.wallTerrain, changed.wallTowerSpacing, changed.ditchWetness, changed.riverControlMode]).toEqual([0, 0.5, 90, 0, 'none']);
  });
  it('preserves numeric parameters and port/river enums in MU1 codes', async () => {
    const layoutConfig = normalizeLayoutConfig({ wallStiffness: 0, wallTerrain: 0.5, wallTowerSpacing: 80, ditchWetness: 1, riverControlMode: 'bank-walls', portEnclosure: 'separate' });
    const q = new URLSearchParams({ urban: JSON.stringify({ layoutConfig }) }).toString();
    const saved = await decodeSituation(await encodeSituation({ v: 1, q, pins: [] }));
    const actual = normalizeLayoutConfig(JSON.parse(new URLSearchParams(saved.q).get('urban')!).layoutConfig);
    for (const key of ['wallStiffness', 'wallTerrain', 'wallTowerSpacing', 'ditchWetness', 'riverControlMode', 'portEnclosure'] as const) expect(actual[key]).toEqual(layoutConfig[key]);
  });
  it('paints river towers like curtain towers and keeps a chain distinct from earthworks', () => {
    const rect = (x: number, y: number, w: number, h: number): Shape => ({ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] });
    const base: Enclosure = { path: [...rect(0, 0, 100, 100).outer, { x: 0, y: 0 }], kind: 'wall', style: 'flanked', material: 'stone', gates: [], curtain_width_m: 3, height_m: 8 };
    const footprint = rect(150, 20, 8, 8), anchor = { x: 154, y: 24 };
    const tower: Enclosure = { ...base, towers_detail: [{ anchor, center: anchor, shape: 'square', radius_m: 4, angle: 0, height_m: 12, kind: 'flank', footprint }] };
    const river: Enclosure = { ...base, outworks: [{ kind: 'facing-tower', shape: footprint, height_m: 12 }] };
    expect(cityWallSvg(river, 'parchment')).toEqual(cityWallSvg(tower, 'parchment'));
    const shape = rect(300, 20, 100, 1.2);
    const painted = (kind: string) => cityWallSvg({ ...base, outworks: [{ kind, shape, height_m: 0.3 }] }, 'parchment')!.find(p => p.d.includes('300'))!.fill;
    expect(painted('river-chain')).not.toBe(painted('outer-wall'));
  });
});
