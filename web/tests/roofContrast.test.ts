import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildingTint } from '../src/render/buildingPalette';
import { MIN_ROOF_CONTRAST, colourDistance, roofAgainstGround, type Rgb01 } from '../src/render/roofContrast';

const DIR = 'out/fix-v7/round11/render11/', DEBUG = readFileSync('out/fix-v7/hang/debug.mjs', 'utf8');
const zoneBlock = DEBUG.slice(DEBUG.indexOf('const ZONES = {'), DEBUG.indexOf('};', DEBUG.indexOf('const ZONES = {')));
const ZONE_OF: Record<string, string> = {};
for (const m of zoneBlock.matchAll(/^\s*(\w+): '([^']+)'/gm)) for (const c of m[2].split(' ')) ZONE_OF[c] = m[1];
const grounds: Record<string, { sat: number[]; plain: number[] }> = JSON.parse(readFileSync(`${DIR}zones.json`, 'utf8'));
const cultures: string[] = JSON.parse(readFileSync('out/planches-styles-v7/cultures.json', 'utf8'));
const tones = Array.from({ length: 16 }, (_, i) => i / 15);
const roofs = (culture: string): Rgb01[] => tones.map(t => buildingTint(culture, 'plaster', 'tile', t).roof);
const minDist = (rs: Rgb01[], g: number[]): number => Math.min(...rs.map(r => colourDistance(r, g.map(v => v / 255))));

describe('roof against ground contrast', () => {
  it('lifts every culture roof to the minimum contrast on its zone ground and writes the table', () => {
    const rows: string[] = ['| culture | zone | sat before | sat after | plain before | plain after |', '|---|---|---|---|---|---|'];
    for (const c of cultures) {
      const z = ZONE_OF[c]; expect(z, c).toBeTruthy();
      const g = grounds[z], before = roofs(c), after = before.map(r => roofAgainstGround(r, g.sat.map(v => v / 255)));
      const afterPlain = before.map(r => roofAgainstGround(r, g.plain.map(v => v / 255)));
      rows.push(`| ${c} | ${z} | ${minDist(before, g.sat).toFixed(3)} | ${minDist(after, g.sat).toFixed(3)} | ${minDist(before, g.plain).toFixed(3)} | ${minDist(afterPlain, g.plain).toFixed(3)} |`);
      expect(minDist(after, g.sat), c).toBeGreaterThanOrEqual(MIN_ROOF_CONTRAST - 1e-3);
      expect(minDist(afterPlain, g.plain), c).toBeGreaterThanOrEqual(MIN_ROOF_CONTRAST - 1e-3);
    }
    writeFileSync(`${DIR}contrast-table.md`, rows.join('\n') + '\n');
  });
  it('leaves a roof that already reads untouched', () => {
    const roof: Rgb01 = [0.1, 0.1, 0.1];
    expect(roofAgainstGround(roof, [0.9, 0.9, 0.9])).toBe(roof);
  });
});
