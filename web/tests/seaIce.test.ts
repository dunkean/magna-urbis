import { describe, expect, it } from 'vitest';
import { RENDER_V2_GLSL } from '../../rust/bridge/terrainRenderV2';
import { calendarSeason, seasonCalendarUniforms, seasonWeights, SEASON_CALENDAR_FIELDS, ZONE_SEASONS } from '../../rust/bridge/terrainRenderV2Zones';
import { compositionFields, writeCompositionField } from '../src/ui/compositionControls';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject } from '../src/v2/project';
import { resolveAppearance } from '../src/render/appearanceRecipe';

// Execute the scalar GLSL decisions themselves, rather than a second copy of the ice law.
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const sstep = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
function iceLaw(coast: number) {
  const names = ['v2WinterSeaIce', 'v2WinterPackLimit', 'v2ShoreIceProgress', 'v2SeaIceProgress', 'v2SeaIceGate', 'v2ShoreIceDrop', 'v2ShoreIceMean'];
  const functions = names
    .map(name => {
      const match = RENDER_V2_GLSL.match(new RegExp(`(?:float|vec2) ${name}\\(([^)]*)\\)\\{([^{}]*)\\}`));
      if (!match) throw new Error(`Missing scalar ice decision: ${name}`);
      return `function ${name}(${match[1].replace(/float /g, '')}){${match[2].replace(/\bfloat\b/g, 'let')}}`;
    })
    .join('\n');
  return new Function('sstep', 'clamp', 'mix', 'max', 'min', 'exp', 'vec2', 'v2WinterCover', 'v2WinterClimate', `${functions};return {${names.join(',')}};`)(
    sstep,
    clamp,
    (a: number, b: number, t: number) => a + (b - a) * t,
    Math.max,
    Math.min,
    Math.exp,
    (x: number, y: number) => [x, y],
    (v: number) => v,
    () => coast,
  ) as { v2WinterSeaIce(c: number): [number, number]; v2SeaIceProgress(c: number, loose: number, depth: number): number; v2SeaIceGate(c: number): number; v2ShoreIceMean(c: number, t: number): number };
}
function cover(c: number, coast: number, depth: number): number {
  const law = iceLaw(coast),
    [concentration, loose] = law.v2WinterSeaIce(c);
  return law.v2SeaIceGate(concentration) * law.v2ShoreIceMean(concentration, clamp(law.v2SeaIceProgress(concentration, loose, depth), 0, 1));
}

describe('satellite sea ice', () => {
  it('keeps the calendar concentration when coastal snow melts', () => {
    for (const coast of [0, 0.5, 1])
      for (const c of [0.02, 0.2, 0.4, 0.62, 0.82, 1]) {
        expect(iceLaw(coast).v2WinterSeaIce(c)[0]).toBe(c);
      }
  });

  it('retains summer pack offshore and in shallow bays, with mostly open thawed shores', () => {
    const c = ZONE_SEASONS.arctic.seaIce[2],
      offshore = cover(c, 0, 500);
    expect(offshore).toBeGreaterThan(0.1);
    expect(offshore).toBeLessThan(0.85);
    expect(cover(c, 0, 0)).toBeLessThan(0.2);
    expect(cover(c, 0, 5)).toBeGreaterThan(offshore);
    expect(cover(0.2, 0, 500)).toBeGreaterThan(0);
  });

  it('preserves winter ice up to the shore and orders intermediate seasons', () => {
    const [winter, spring, summer, autumn] = ZONE_SEASONS.arctic.seaIce;
    expect(cover(winter, 1, 0)).toBe(1);
    expect(cover(winter, 1, 500)).toBeGreaterThan(0.95);
    for (const c of [spring, autumn]) {
      expect(cover(c, 1, 500)).toBeGreaterThan(cover(summer, 0, 500));
      expect(cover(c, 1, 500)).toBeLessThan(cover(winter, 1, 500));
    }
  });

  it('responds monotonically to the concentration, including zero and full cover', () => {
    for (const coast of [0, 0.5, 1])
      for (const depth of [0, 2, 8, 50, 500]) {
        let previous = 0;
        for (let step = 0; step <= 100; step++) {
          const current = cover(step / 100, coast, depth);
          expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = current;
        }
        expect(cover(0, coast, depth)).toBe(0);
        expect(cover(1, coast, depth)).toBeGreaterThan(0.95);
      }
  });

  it('uses the same progress and gate for resolved floes and the distant mean', () => {
    expect(RENDER_V2_GLSL.match(/v2SeaIceProgress\(seaIce.x,seaIce.y,depth\)/g)).toHaveLength(2);
    expect(RENDER_V2_GLSL).toContain('gate=v2SeaIceGate(c)');
  });
});

describe('sea ice display calendar', () => {
  it('maps the four season centres and applies zone defaults or explicit overrides', () => {
    for (let index = 0; index < 4; index++) expect(seasonWeights(index / 4)).toEqual([0, 1, 2, 3].map(i => Number(i === index)));
    expect(seasonCalendarUniforms('arctic').ice).toEqual(ZONE_SEASONS.arctic.seaIce);
    expect(calendarSeason('arctic', { seaIceSummer: 0.2 }).seaIce[2]).toBe(0.2);
  });

  it('retains all bilingual controls in recipes and invalidates water and ground appearance', () => {
    const settings = defaultSettings(),
      composition = settings.appearance!.composition!;
    const resolved = resolveAppearance(settings.appearance, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
    const fields = SEASON_CALENDAR_FIELDS.filter(field => field.key.startsWith('seaIce'));
    expect(fields).toHaveLength(4);
    for (const field of fields) {
      expect(field.en).toMatch(/^Sea ice/);
      expect(field.fr).toMatch(/^Banquise/);
      expect(compositionFields[`composition.effects.calendar.${field.key}`].optional).toBe(true);
    }
    settings.appearance!.composition = writeCompositionField(composition, 'effects.calendar.seaIceSummer', 0.2);
    const restored = parseProject(serializeProject(settings)).settings;
    expect(restored.appearance!.composition!.effects.calendar!.seaIceSummer).toBe(0.2);
    const changed = resolveAppearance(restored.appearance, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
    expect(changed.keys.water).not.toBe(resolved.keys.water);
    expect(changed.keys.terrainLook).not.toBe(resolved.keys.terrainLook);
  });
});
