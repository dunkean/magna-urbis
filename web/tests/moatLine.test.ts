import { describe, expect, it } from 'vitest';
import type { MoatRun } from '../../rust/bridge/urban';
import { MoatLineIndex, reachFill, reachStations, reachStrip, runArc, runEndTaper, runFrame, wettedSpan } from '../src/render/moatLine';
import { moatFormOf } from '../src/render/moatModel';
import { moatRevetment } from '../src/render/city3dMoat';
import { UrbanGroundCuts } from '../src/ui/urbanGroundCuts';
import { mapSeasonState, setMapClimateZone, setMapSeason } from '../src/render/seasonPalette';

const straight = (n: number, yIn: number, yOut: number): MoatRun => {
  const xs = Array.from({ length: n }, (_, i) => 10 * i);
  return { inner: xs.map(x => ({ x, y: yIn })), outer: xs.map(x => ({ x, y: yOut })), rim: xs.map(() => 10), bed: xs.map(() => 7), ends: ['work', 'work'], reaches: [{ from: 0, to: n - 1, supply: 'dry' }] };
};
/** A ring of 36 stations (every 10 degrees) between radii 100 and 110 round the origin. */
const ring = (): MoatRun => {
  const at = (r: number, k: number) => ({ x: r * Math.cos((k * Math.PI) / 18), y: r * Math.sin((k * Math.PI) / 18) }),
    ks = Array.from({ length: 36 }, (_, k) => k);
  return { closed: true, inner: ks.map(k => at(100, k)), outer: ks.map(k => at(110, k)), rim: ks.map(() => 10), bed: ks.map(() => 7), ends: ['closed', 'closed'], reaches: [{ from: 0, to: 35, supply: 'dry' }] };
};
const polar = (r: number, deg: number) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) });

describe('moat line', () => {
  it('locates a point in the quads of a straight run', () => {
    const index = new MoatLineIndex([{ runs: [straight(41, 100, 110)] }]);
    const at = index.locate(105, 102.5)!;
    expect([at.circuit, at.run, at.k]).toEqual([0, 0, 10]);
    expect(at.t).toBeCloseTo(0.5, 9);
    expect(at.u).toBeCloseTo(0.25, 9);
    expect(index.locate(105, 95)).toBeUndefined();
    expect(index.locate(105, 111)).toBeUndefined();
    expect(index.locate(-1, 105)).toBeUndefined();
  });

  it('locates a point in the quads of a curved closed run, the joint of the ring included', () => {
    const index = new MoatLineIndex([{ runs: [ring()] }]),
      c = Math.cos(Math.PI / 36),
      middle = (105 - 100 * c) / (10 * c);
    const at = index.locate(polar(105, 15).x, polar(105, 15).y)!;
    expect(at.k).toBe(1);
    expect(at.t).toBeCloseTo(0.5, 6);
    expect(at.u).toBeCloseTo(middle, 6);
    const joint = index.locate(polar(105, 355).x, polar(105, 355).y)!;
    expect(joint.k).toBe(35);
    expect(joint.t).toBeCloseTo(0.5, 6);
    expect(index.locate(polar(99, 15).x, polar(99, 15).y)).toBeUndefined();
  });

  it('draws the strip of a reach, and wraps a reach round a closed run', () => {
    const strip = reachStrip(straight(5, 100, 110), { from: 1, to: 3, supply: 'dry' });
    expect(strip.outer).toHaveLength(6);
    expect(strip.outer.reduce((s, p, i, r) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2).toBeCloseTo(200, 6);
    expect(reachStations(ring(), { from: 34, to: 1, supply: 'dry' })).toEqual([34, 35, 0, 1]);
    expect(reachStations(straight(5, 100, 110), { from: 3, to: 1, supply: 'dry' })).toEqual([]);
  });

  it('finds the wetted width of a station under a water surface', () => {
    const run = straight(5, 100, 120),
      form = moatFormOf('earth'),
      frame = runFrame(run, () => 10, 3)!;
    const [u0, u1] = wettedSpan(form, frame, run, 2, 8.5)!;
    // The earth scarp (3.6 m run) is half dug 1.8 m in from each lip of the 20 m ditch.
    expect(u0).toBeCloseTo(0.09, 1);
    expect(u1).toBeCloseTo(1 - u0, 9);
    expect(wettedSpan(form, frame, run, 2, 6.5)).toBeUndefined();
  });

  it('tapers the terrain cut and the revetment facing of a sloping end by one function', () => {
    const run: MoatRun = { ...straight(11, 100, 110), ends: ['slope', 'work'] },
      form = moatFormOf('revetted'),
      frame = runFrame(run, () => 10, form.depthM)!,
      arc = runArc(run),
      cuts = new UrbanGroundCuts([{ moat: { form: 'revetted', runs: [run] } }], () => 10),
      depth = (x: number): number => 10 - cuts.lower(x, 105, 10),
      full = depth(60);
    expect(full).toBeGreaterThan(1);
    for (const x of [5, 10, 14]) expect(depth(x) / full).toBeCloseTo(runEndTaper(run, arc, x, 10), 6);
    expect(runEndTaper(run, arc, 0, 10)).toBe(0);
    expect(runEndTaper(run, arc, 60, 10)).toBe(1);
    const faces: { points: { x: number; y: number; z: number }[]; material: string }[] = [];
    moatRevetment(run, frame, form, [], (points, material) => faces.push({ points, material }), 'facing', 'coping');
    const at = (material: string, x: number): number[] => faces.filter(f => f.material === material).flatMap(f => f.points.filter(p => Math.abs(p.x - x) < 1e-6).map(p => p.z));
    // The coping lies flush with the bank; the full facing reaches 0.6 m under the bed, a tapered one the share of its cut.
    expect(Math.max(...faces.filter(f => f.material === 'coping').flatMap(f => f.points.map(p => p.z)))).toBeLessThanOrEqual(10.05);
    const top = Math.max(...at('facing', 60)),
      sunk = top - Math.min(...at('facing', 60));
    expect(Math.min(...at('facing', 60))).toBeCloseTo(frame.bed[6] - 0.6, 6);
    expect((top - Math.min(...at('facing', 10))) / sunk).toBeCloseTo(runEndTaper(run, arc, 10, 10), 6);
    expect(Math.min(...at('facing', 0))).toBeCloseTo(top, 6);
  });

  it('gives every reach of a fed chain one fill, while dry reaches vary', () => {
    const previous = mapSeasonState(),
      form = moatFormOf('earth');
    try {
      setMapSeason(0.2, 'mediterranean');
      const reaches = Array.from({ length: 6 }, (_, i) => i);
      expect(new Set(reaches.map(i => reachFill({ from: i, to: i + 1, supply: 'fed', level: 5 }, i, form))).size).toBe(1);
      expect(new Set(reaches.map(i => reachFill({ from: i, to: i + 1, supply: 'dry' }, i, form))).size).toBeGreaterThan(1);
    } finally {
      setMapSeason(previous.season, previous.zone);
      if (!previous.zone) setMapClimateZone(undefined);
    }
  });
});
