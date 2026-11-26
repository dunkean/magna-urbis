import { afterEach, expect, it } from 'vitest';
import { naturalMarks, roadTone, ROAD_RANKS } from '../src/render/roadStyle';
import { URBAN_SNOW, mapGroundSnow, mapLandSnow, setMapClimateZone, setMapSeason, setMapSnowRelief } from '../src/render/seasonPalette';

afterEach(() => {
  setMapSeason(0.5, undefined, {});
  setMapClimateZone(undefined);
  setMapSnowRelief(undefined);
});
it('retains cool compacted tracks, shoulders and readable beds under an arctic snow mantle', () => {
  setMapClimateZone('arctic');
  setMapSeason(0);
  expect(mapGroundSnow()).toBe(1);
  for (const rank of ROAD_RANKS) {
    const tone = roadTone([225, 232, 232], rank, 1, false);
    expect(tone[0]).toBeLessThan(205);
    expect(tone[2]).toBeGreaterThan(tone[0]);
    const marks = naturalMarks(rank, 4, 2, { look: 'natural', emphasis: 1, night: false });
    expect(marks.bed.alpha).toBeGreaterThanOrEqual(0.8);
    expect(marks.shadow?.alpha).toBeGreaterThan(0);
    expect(marks.grain).toBe(0);
  }
});
it('gives a way the snow of the land it crosses: full on level ground, ledge patches on a cliff', () => {
  setMapClimateZone('arctic');
  setMapSeason(0);
  // Level ground at 100 m: the level snow of its altitude.
  setMapSnowRelief({ data: new Float32Array(16).fill(100), n: 4, width: 400 });
  expect(mapLandSnow(200, 200)).toBe(mapGroundSnow(100));
  // A town's ground is cleared and trodden: never more snow than the land of its site.
  expect(mapLandSnow(200, 200, URBAN_SNOW)).toBeLessThanOrEqual(mapLandSnow(200, 200));
  // A face rising 200 m per 100 m: shed, but never bare, and never whiter than the level ground.
  setMapSnowRelief({ data: Float32Array.from({ length: 16 }, (_, k) => (k % 4) * 200), n: 4, width: 400 });
  const cliff = mapLandSnow(200, 200);
  expect(cliff).toBeGreaterThan(0);
  expect(cliff).toBeLessThan(0.5);
  const onCliff = roadTone([120, 110, 100], 'street', 1, false, cliff),
    onLevel = roadTone([120, 110, 100], 'street', 1, false, 1);
  expect(onCliff[0] + onCliff[1] + onCliff[2]).toBeLessThan(onLevel[0] + onLevel[1] + onLevel[2]);
});
