import { describe, expect, it } from 'vitest';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { buildCityBuildings } from '../src/render/cityCanvas';
import { buildFillMeshSync, meshFeatureAt, packBuildings } from '../src/render/cityGlBuild';
import { ruinFootprint } from '../src/render/cityRuins';
import { pieceRoof, type MassingPiece } from '../src/render/cityMassing';

const rect = (x: number, y: number, w: number, h: number) => ({
  outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [],
});
const piece = (cover: string): MassingPiece => ({ floors: 1, eave_m: 1.2, rise_m: 0, roof: 'flat', ridges: [], cover, wall: 'stone' });

describe('cartographic ruin pieces', () => {
  it('keeps the broken wall gaps and excludes the roofed part of a partially decayed building', () => {
    const footprint = [rect(0, 0, 3, .6), rect(4, 0, 3, .6), rect(0, 5, 7, 6)];
    const programme = { massing: [piece('ruin'), piece('ruin'), piece('tile')] };
    const before = JSON.stringify({ footprint, programme });
    const batch = { buildings: [{ id: 'decayed', parcel_id: 'p', function: 'domestic', footprint, roof_footprint: footprint, programme }] } as unknown as PlacementBatch;
    const buildings = buildCityBuildings(batch), mesh = buildFillMeshSync(packBuildings(buildings, { x: 0, y: 0 }));
    expect(buildings.items[0].ruins).toEqual(footprint.slice(0, 2));
    expect(meshFeatureAt(mesh, 'ruins', { x: 1, y: .3 })).toBe(0);
    expect(meshFeatureAt(mesh, 'ruins', { x: 3.5, y: .3 })).toBeUndefined();
    expect(meshFeatureAt(mesh, 'ruins', { x: 3, y: 8 })).toBeUndefined();
    expect(meshFeatureAt(mesh, 'buildingFootprints', { x: 3, y: 8 })).toBe(0);
    expect(JSON.stringify({ footprint, programme })).toBe(before);
    // Relief remains the actual wall top, at its native height and thickness.
    expect(pieceRoof(footprint[0], programme.massing[0], 0)[0].points.every(p => p.z === 1.2)).toBe(true);
  });

  it('uses volume material overrides and never marks an intact subvolume as rubble', () => {
    const footprint = [rect(0, 0, 10, 10)], roofed = rect(0, 0, 4, 10), stub = rect(8, 0, 2, .6);
    const programme = { massing: [{ ...piece('tile'), volumes: [
      { ...piece('tile'), ring: roofed.outer.map(p => [p.x, p.y]) },
      { ...piece('ruin'), ring: stub.outer.map(p => [p.x, p.y]) },
    ] }] };
    expect(ruinFootprint(footprint, programme)).toEqual([stub]);
    expect(ruinFootprint(footprint, { massing: [piece('tile')] })).toEqual([]);
    expect(ruinFootprint(footprint, undefined)).toEqual([]);
  });
});
