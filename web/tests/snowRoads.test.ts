import { afterEach, expect, it } from 'vitest';
import { naturalMarks, roadTone, ROAD_RANKS } from '../src/render/roadStyle';
import { mapGroundSnow, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';

afterEach(() => { setMapSeason(.5, undefined, {}); setMapClimateZone(undefined); });
it('retains cool compacted tracks, shoulders and readable beds under an arctic snow mantle', () => {
  setMapClimateZone('arctic'); setMapSeason(0);
  expect(mapGroundSnow()).toBe(1);
  for (const rank of ROAD_RANKS) {
    const tone = roadTone([225, 232, 232], rank, 1, false);
    expect(tone[0]).toBeLessThan(205); expect(tone[2]).toBeGreaterThan(tone[0]);
    const marks = naturalMarks(rank, 4, 2, { look: 'natural', emphasis: 1, night: false });
    expect(marks.bed.alpha).toBeGreaterThanOrEqual(.8);
    expect(marks.shadow?.alpha).toBeGreaterThan(0); expect(marks.grain).toBe(0);
  }
});
