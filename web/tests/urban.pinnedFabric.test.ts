import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generate } from '../src/gen/pipeline';
import { fromQuery } from '../src/gen/options';
import { polygonCentroid, type Polygon, type Vec2 } from '../src/gen/core/geom';
import { area, minNeck, pointInRing } from '../src/gen/geo/poly';
import { mpArea, tryDifference, tryIntersection } from '../src/gen/geo/bool';
import { auditUrban } from '../src/gen/urban/geometryAudit';
import { blockReach, makeStreetAt } from '../src/gen/urban/access';
import { footprintPlacementGuard } from '../src/gen/urban/edgeFinish';
import { finalizeFootprints } from '../src/gen/urban/footprintFinal';
import * as footprintFinal from '../src/gen/urban/footprintFinal';
import { streetStrips } from '../src/gen/urban/openfringe';
import { unreachableBuildings } from './accessCheck';
import { checkWorld } from './urbanCheck';
import native from './fixtures/compact-pins-v11.json';

// Both user pin lists reproduce this same native map. Keep its compact options
// rather than replacing the curved quarter boundaries with a synthetic rectangle.
const query = 'id=1zvAFj4K0oKrM0T2dSYrHg5M4uSkzM4eI0AiYabicJBmnB4sS84uyizBJFTkNTAwOVILWpTNHRIGlg0sdIeOD0YmpuoWNibKATDUrdeVBBigklRWDSUVQCZo-QxLzEMmDiVoqNBQA';

describe('the two pinned curved town regressions', () => {
  it('keeps served, disjoint whole roofs on the native town', () => {
    let producedHousingArea = 0;
    const original = footprintFinal.finalizeFootprints;
    const spy = vi.spyOn(footprintFinal, 'finalizeFootprints').mockImplementation((input) => {
      producedHousingArea = input.buildings.filter(b => ['house', 'rear', 'back'].includes(b.kind))
        .reduce((sum, b) => sum + area(b.poly), 0);
      return original(input);
    });
    let world: ReturnType<typeof generate>;
    try { world = generate(fromQuery(query)); }
    finally { spy.mockRestore(); }
    const urban = world.urban!;
    expect(urban.buildings).toHaveLength(832);
    expect(urban.parcels).toHaveLength(424);
    expect(createHash('sha256').update(JSON.stringify(urban)).digest('hex'))
      .toBe('1aa4858c2a2470a5a529662c88decce6ed4e5ab30cdb053315a42227791f88ee');
    const audit = auditUrban(world);
    expect(audit.malformed).toEqual([]);
    expect(audit.failed).toBe(0);
    expect(audit.overlaps.filter(p => p.kind === 'building' && p.thickness > 0.05)).toEqual([]);
    expect(unreachableBuildings(world).n).toBe(0);
    const partitions = checkWorld(world);
    expect(partitions.overlapsPlots).toBe(0);
    expect(partitions.bldgOutside).toBe(0);
    expect(partitions.noFrontage).toBe(0);
    expect(partitions.orphanMain).toBe(0);
    const housingArea = urban.buildings.filter(b => ['house', 'rear', 'back'].includes(b.kind))
      .reduce((sum, b) => sum + area(b.poly), 0);
    // Sparse faubourgs now retain their yard budget. The cleanup must preserve
    // the actual corrected producer's dwellings rather than its former overfill.
    expect(producedHousingArea).toBeGreaterThan(70000);
    expect(housingArea).toBeGreaterThanOrEqual(0.98 * producedHousingArea);
    const privateWays = urban.streets.filter(s => s.private);
    expect(privateWays.every(s => s.width >= 0.8 && s.kind === 'alley')).toBe(true);
    // Those five producer parcel indices have changed. Keep the exact historical
    // locations, using the archived owner rings instead of unrelated current indices.
    const pins = native.cases.filter(f => [104, 180, 576, 845, 860].includes(f.i));
    expect(pins).toHaveLength(5);
    for (const pin of pins) {
      const roofs = urban.buildings.filter(b => ['house', 'rear', 'back'].includes(b.kind)
        && pointInRing(pin.owner, polygonCentroid(b.poly)));
      expect(roofs.length, `historical site ${pin.i} still contains dwellings`).toBeGreaterThan(0);
      expect(roofs.every(b => (minNeck(b.poly)?.w ?? Infinity) >= 2), `historical site ${pin.i}`).toBe(true);
    }
  });

  it('replans the historical river-side arm as a whole served room in its western pocket', () => {
    const f = structuredClone(native.cases.find(c => c.i === 845)!);
    const streetAt = makeStreetAt(native.streets, native.places);
    const reserve = [...native.water,
      ...native.streets.flatMap(s => streetStrips(s.path, s.widths ?? s.width)),
      ...native.walls.flatMap(w => streetStrips([...w.path, w.path[0]], 5.6)),
      ...(native.lines as { path: Vec2[]; width?: number; closed?: boolean }[])
        .flatMap(l => streetStrips(l.closed ? [...l.path, l.path[0]] : l.path, l.width ?? 1))];
    const before = blockReach(f.block, f.peers.map(p => p.poly), streetAt);
    expect(before).toHaveLength(36);
    expect(before.every(Boolean)).toBe(true);
    expect(Math.max(...f.roof.map(p => p.x))).toBeGreaterThan(900);
    const buildings = [{ poly: f.roof, kind: 'back', parcel: 0 },
      ...f.occupied.map(poly => ({ poly, kind: 'landmark', parcel: 0 }))];
    const privatePassages: { path: Vec2[]; width: number; parcel: number }[] = [];
    const result = finalizeFootprints({ buildings,
      parcels: [{ poly: f.owner, front: f.front as [Vec2, Vec2], use: 'plot', block: 0 }],
      backLand: [], gardens: [f.owner], privatePassages,
      placementClear: footprintPlacementGuard(reserve, () => false),
      validateParts: (_, parts) => {
        const proposed = f.peers.flatMap(peer => peer.i === f.i ? parts : [peer.poly]);
        const required = f.peers.flatMap((peer, i) => peer.i === f.i ? parts.map(() => true) : [before[i]]);
        return blockReach(f.block, proposed, streetAt).every((served, i) => served || !required[i]);
      } });
    expect(result.invalid).not.toContain(0);
    expect(result.removed).toEqual([]);
    expect(privatePassages).toEqual([]);
    const replanned: Polygon = buildings[0].poly;
    expect(replanned.every(p => p.x < 880)).toBe(true);
    expect(area(replanned)).toBeGreaterThanOrEqual(105.5);
    expect(replanned).toHaveLength(4);
    expect(minNeck(replanned)?.w ?? Infinity).toBeGreaterThanOrEqual(2);
    const outside = tryDifference(replanned, f.owner);
    const occupied = tryIntersection(replanned, f.occupied.map(outer => ({ outer, holes: [] })));
    const physical = tryIntersection(replanned, reserve);
    expect(outside.failed || occupied.failed || physical.failed).toBe(false);
    expect(mpArea(outside.pieces) + mpArea(occupied.pieces) + mpArea(physical.pieces)).toBeLessThanOrEqual(1e-6);
    expect(blockReach(f.block, f.peers.map(peer => peer.i === f.i ? replanned : peer.poly), streetAt)).toEqual(before);
  });
});
