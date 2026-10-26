import { describe, expect, it } from 'vitest';
import { clipToRings, partitionRegion, toRing, type FieldNet } from '../src/gen/landuse/fields';
import { intersectionS, differenceS, mpArea, unionS } from '../src/gen/geo/bool';
import { connectFieldWays } from '../src/gen/landuse/fieldAccess';
import { Rng } from '../src/gen/core/rng';
import { Noise2D } from '../src/gen/core/noise';
import type { Polygon } from '../src/gen/types';

const box = (x: number, y: number, w: number, h = w): Polygon => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
describe('rural geometry on concave holdings', () => {
  it('bridges a real verge to the road while refusing a forbidden crossing', () => {
    const net:FieldNet = {furlongs:[],ways:[[{x:10,y:20},{x:40,y:35}]],headlands:[]};
    const road = [{path:[{x:0,y:0},{x:100,y:0}],width:4}];
    expect(connectFieldWays(net,road,65,()=>false)).toBe(0);
    expect(connectFieldWays(net,road,65,()=>true)).toBe(1);
    expect(net.ways[0][0]).toEqual({x:10,y:0});
  });
  it('clips a single long segment at every hole and at the outer boundary', () => {
    const rings = [toRing(box(0, 0, 100)), toRing(box(30, 30, 20)), toRing(box(60, 30, 20))];
    const through = clipToRings([{ x: -10, y: 40 }, { x: 110, y: 40 }], rings);
    expect(through.map(line => line.map(p => Math.round(p.x)))).toEqual([[0, 30], [50, 60], [80, 100]]);
    expect(clipToRings([{ x: 10, y: 40 }, { x: 90, y: 40 }], rings)).toHaveLength(3);
  });
  it('keeps all strips within a concave field and out of internal islands, without overlap', () => {
    const outer = [{x:0,y:0},{x:480,y:0},{x:480,y:140},{x:300,y:140},{x:300,y:360},{x:0,y:360}];
    const holes = [box(95, 55, 9, 9), box(170, 200, 55, 60)];
    const rng = new Rng('geometry-regression'), net: FieldNet = { furlongs: [], ways: [], headlands: [] };
    partitionRegion(outer, holes, { dirAt: (x, y) => .2 + .6 * Math.sin(x / 140) * Math.cos(y / 160),
      slopeAt: () => .04, closeAt: () => false, noise: new Noise2D(rng.fork('noise')), rng }, net);
    const strips = net.furlongs.flatMap(f => f.strips ?? []);
    expect(strips.length).toBeGreaterThan(5);
    const source = [{outer, holes}];
    let total = 0;
    for (const strip of strips) {
      expect(mpArea(differenceS(strip, source))).toBeLessThan(.001);
      expect(mpArea(intersectionS(strip, holes.map(outer => ({outer, holes:[]}))))).toBeLessThan(.001);
      total += mpArea([{outer:strip, holes:[]}]);
    }
    expect(total - mpArea(unionS(strips.map(outer => ({outer,holes:[]}))))).toBeLessThan(.01);
    expect(total / mpArea(source)).toBeGreaterThan(.75);
  });
});
