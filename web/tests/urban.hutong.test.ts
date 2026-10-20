import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Rng } from '../src/gen/core/rng';
import { dist } from '../src/gen/core/geom';
import { area, pointInRing, distToRing, distToSeg } from '../src/gen/geo/poly';
import { differenceS, mpArea, tryDifference } from '../src/gen/geo/bool';
import { ribbon } from '../src/gen/geo/offset';
import { MORPHOLOGIES } from '../src/gen/urban/morphology';
import '../src/gen/urban/cultures';
import { Streets, LAB_WALL } from '../src/gen/urban/streets';
import type { Piece } from '../src/gen/urban/blocks';
import { culDeSacTree } from '../src/gen/urban/culdesac';
import { plotFrontOnStreet, refreshPlotFrame } from '../src/gen/urban/plots';
import type { Plot } from '../src/gen/urban/plots';
import { buildOn } from '../src/gen/urban/bops';
import { blockReach, carvePassage, makeStreetAt } from '../src/gen/urban/access';
import { makeOptions } from '../src/gen/options';
import { generate } from '../src/gen/pipeline';
import { checkWorld } from './urbanCheck';

function ward() {
  const streets = new Streets();
  const id = streets.add([{ x: 0, y: 0 }, { x: 180, y: 0 }], 8, 2, 'street', 0);
  streets.connected.add(id);
  const pc: Piece = { lp: { pts: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 160 }, { x: 0, y: 160 }],
    lab: [id, LAB_WALL, LAB_WALL, LAB_WALL] }, phase: 0, zone: 'core', age: 1, quarter: 0, kind: 'block', level: 2,
    morph: MORPHOLOGIES['chinese'] };
  return { streets, pc };
}

describe('Chinese hutong access', () => {
  it('serves deep ward interiors with connected cardinal lanes', () => {
    const { streets, pc } = ward();
    expect(culDeSacTree([pc], streets, new Rng('hutong'))).toBeGreaterThan(2);
    for (const s of streets.list.slice(1)) {
      expect(streets.connected.has(s.id)).toBe(true);
      const streetEntry = [{ x: -5, y: -5 }, { x: 185, y: -5 }, { x: 185, y: 0 }, { x: -5, y: 0 }];
      expect(mpArea(differenceS(ribbon(s.path, s.widths), pc.lp.pts, streetEntry))).toBeLessThan(0.05);
      for (let i = 1; i < s.path.length; i++) {
        const a = s.path[i - 1], b = s.path[i];
        expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(1e-6);
        for (let j = 0; j <= 20; j++) {
          const p = { x: a.x + (b.x - a.x) * j / 20, y: a.y + (b.y - a.y) * j / 20 };
          if (p.y >= 0) expect(pointInRing(pc.lp.pts, p) || distToRing(pc.lp.pts, p) < 0.01).toBe(true);
          else expect(p.y).toBeGreaterThanOrEqual(-4);
        }
      }
      expect(streets.list.slice(0, s.id).some((p) => p.path.some((a, i) => i > 0 &&
        // A parent crossing may lie along a segment rather than at its endpoints.
        distToSeg(s.path[0], p.path[i - 1], a) < 4))).toBe(true);
    }
  });

  it('is deterministic and does not consume the organic derb random stream', () => {
    const a = ward(), b = ward(), ra = new Rng('same'), rb = new Rng('same');
    culDeSacTree([a.pc], a.streets, ra); culDeSacTree([b.pc], b.streets, rb);
    expect(a.streets.list).toEqual(b.streets.list);
    expect(ra.next()).toBe(new Rng('same').next());
    expect(rb.next()).toBe(new Rng('same').next());
  });

  it('enters short frontage away from corners and serves back land beside a diagonal bank', () => {
    const { streets, pc } = ward();
    pc.lp = { pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 180, y: 90 }, { x: 180, y: 160 }, { x: 0, y: 160 }],
      lab: [0, LAB_WALL, LAB_WALL, LAB_WALL, LAB_WALL] };
    streets.list[0].path[1] = { x: 40, y: 0 };
    expect(culDeSacTree([pc], streets, new Rng('clipped'))).toBeGreaterThan(0);
    const entry = [{ x: -5, y: -5 }, { x: 45, y: -5 }, { x: 45, y: 0 }, { x: -5, y: 0 }];
    for (const s of streets.list.slice(1)) expect(mpArea(differenceS(ribbon(s.path, s.widths), pc.lp.pts, entry))).toBeLessThan(0.05);
    expect(streets.list.slice(1).some((s) => s.path.some((p) => p.y > 100))).toBe(true);
  });

  it('keeps reserved compounds intact', () => {
    const { streets, pc } = ward(); pc.compound = 'yamen';
    expect(culDeSacTree([pc], streets, new Rng('reserved'))).toBe(0);
    expect(streets.list).toHaveLength(1);
  });

  it('enters an oblique street normally before turning into the cardinal ward', () => {
    const { streets, pc } = ward(), k = Math.SQRT1_2;
    const rotate = (p: { x: number; y: number }) => ({ x: (p.x - p.y) * k, y: (p.x + p.y) * k });
    pc.lp.pts = pc.lp.pts.map(rotate);
    streets.list[0].path = streets.list[0].path.map(rotate);
    expect(culDeSacTree([pc], streets, new Rng('oblique'))).toBeGreaterThan(1);
    const entry = [{ x: -5, y: -5 }, { x: 185, y: -5 }, { x: 185, y: 0 }, { x: -5, y: 0 }].map(rotate);
    for (const s of streets.list.slice(1)) expect(mpArea(differenceS(ribbon(s.path, s.widths), pc.lp.pts, entry))).toBeLessThan(0.05);
    for (const s of streets.list.slice(1)) for (const p of s.path.slice(1)) {
      expect(pointInRing(pc.lp.pts, p) || distToRing(pc.lp.pts, p) < 0.01).toBe(true);
    }
  });

  it('rebuilds the wide radial frame behind a nearer hutong before constructing its siheyuan', () => {
    const streets = new Streets();
    const radial = streets.add([{ x: 7, y: -30 }, { x: 7, y: 30 }], 14, 0, 'radial', 0);
    streets.add([{ x: 1.42, y: 5.614 }, { x: 7.02, y: 5.614 }], 3, 4, 'close', 0);
    const front: Plot['front'] = [{ x: 0, y: -8.122 }, { x: 0, y: 8.122 }], nrm = { x: -1, y: 0 };
    const plot: Plot = { poly: [...front, { x: -40, y: 8.122 }, { x: -40, y: -8.122 }],
      front: [{ x: 1, y: -8.122 }, { x: 1, y: 8.122 }], nrm,
      sideA: { p: { x: 1, y: -8.122 }, d: nrm }, sideB: { p: { x: 1, y: 8.122 }, d: nrm },
      sideFronts: [], rank: 0, depth: 40, wide: false, run: 0, order: 0, block: 0, zone: 'core' };
    const boundary = structuredClone(plot.poly), near = streets.nearest({ x: 0, y: 0 }, 14)!;
    expect(near.s, 'the misleading narrow lane is closer than the radial centreline').toBe(1);
    expect(near.d).toBeLessThan(7);
    expect(near.d - near.hw, 'the narrow ribbon does not touch the actual frontage').toBeGreaterThan(4);
    expect(plotFrontOnStreet(streets, ...front)).toBe(true);
    refreshPlotFrame(plot, (a, b) => plotFrontOnStreet(streets, a, b));
    expect(plot.front).toEqual(front); expect(plot.poly).toEqual(boundary);
    expect(plot.sideA).toEqual({ p: front[0], d: nrm });
    expect(plot.sideB).toEqual({ p: front[1], d: nrm });
    expect(plot.depth).toBe(40);
    const built = buildOn(plot, 0.55, MORPHOLOGIES.chinese, new Rng('radial-hutong'));
    expect(built.length).toBeGreaterThanOrEqual(6);
    expect(built.some((b) => b.arch === 'siheyuan-main-hall')).toBe(true);
    for (const b of built) {
      const outside = tryDifference(b.poly, plot.poly);
      expect(outside.failed).toBe(false); expect(mpArea(outside.pieces)).toBeLessThanOrEqual(1e-6);
    }
    // Construction precedes the pipeline's access pass. Its normal side passage
    // keeps a served gate, main hall and ranges in this controlled narrow compound.
    const served = carvePassage(plot, built, 'A', 1.6);
    expect(served).toHaveLength(5);
    expect(served.some((b) => b.arch === 'siheyuan-main-hall')).toBe(true);
    const streetAt = makeStreetAt(streets.list.map((s) => ({ path: s.path, width: s.widths[0] })), []);
    expect(blockReach(plot.poly, served.map((b) => b.poly), streetAt)).toEqual(served.map(() => true));
    streets.demote(radial);
    expect(plotFrontOnStreet(streets, ...front), 'the lane alone cannot provide this frontage').toBe(false);
  });

  it('shrinks giant under-served p4uefz lots while preserving urban geometry', () => {
    const w = generate(makeOptions({ seed: 'p4uefz', size: 'city', culture: 'chinese', moat: 'no', settlements: 'none' }));
    const u = w.urban!, plots = u.parcels.filter((p) => p.use === 'plot');
    // Corrected road, hutong and courtyard foundation, with all physical guards below.
    expect(createHash('sha256').update(JSON.stringify(u)).digest('hex'))
      .toBe('1456e1da46a7f6bc0c29a3861f2ee8729354b22f6206ba66de211b929bd249fe');
    // Before hutongs the largest residential plot was 40,274 m² with only 20 m of frontage.
    expect(Math.max(...plots.map((p) => area(p.poly)))).toBeLessThan(20000);
    expect(u.streets.filter((s) => s.role === 'close').length).toBeGreaterThan(10);
    const r = checkWorld(w), msg = r.details.slice(0, 8).join('\n');
    expect(r.blockAreaErr, msg).toBeLessThanOrEqual(0.005);
    expect(r.blockOutside, msg).toBeLessThan(1);
    expect(r.overlapsBlocks, msg).toBe(0);
    expect(r.overlapsPlots, msg).toBe(0);
    expect(r.overlapsBuildings, msg).toBeLessThanOrEqual(Math.ceil(r.buildings * 0.0005));
    expect(r.noFrontage, msg).toBe(0);
    expect(r.bldgOutside, msg).toBe(0);
    expect(r.orphanMain, msg).toBe(0);
    expect(plots.every((p) => !p.front || dist(p.front[0], p.front[1]) >= 3)).toBe(true);
    // This current radial lot retains its frontage and houses. The historical
    // nearer-hutong trap now has the controlled frame/construction fixture above.
    const served = plots.find((p) => p.block === 33 && p.poly.some((q) =>
      Math.abs(q.x - 1958.334) < 0.001 && Math.abs(q.y - 2683.667) < 0.001))!;
    expect(served).toBeDefined();
    expect(served.front).toBeDefined();
    expect(dist(served.front![0], served.front![1])).toBeGreaterThan(16);
    const radial = u.streets[7];
    expect(radial.role).toBe('radial');
    for (let i = 0; i <= 8; i++) {
      const [a, b] = served.front!;
      const q = { x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8 };
      expect(distToSeg(q, radial.path[0], radial.path[1])).toBeCloseTo(radial.widths![0] / 2, 2);
    }
    const halls = u.buildings.filter((b) => b.parcel === u.parcels.indexOf(served));
    // Hutong subdivision makes this a shallow 423 m² native owner. It keeps
    // one complete served hall and its yard; the full six-range compound is
    // protected independently by the controlled deep-lot fixture above.
    expect(area(served.poly)).toBeCloseTo(423.0253049125895, 3);
    expect(halls).toHaveLength(1);
    expect(halls[0].arch).toBe('siheyuan-hall');
    expect(area(halls[0].poly)).toBeGreaterThan(200);
    expect(area(halls[0].poly) / area(served.poly)).toBeLessThan(0.6);
  }, 120000);
});
