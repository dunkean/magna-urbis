import { CLIMATE_ZONE_VALUES } from '../../rust/bridge/terrainClimate';
import { describe, expect, it } from 'vitest';
import { pieceRoof, roofLight, type MassingPiece } from '../src/render/cityMassing';
import { roofPlaneLight } from '../src/render/roofPlaneLight';
import { treeDwelling } from '../src/render/cityTrees';
import { city3dLotEnclosures, silhouetteBuilding } from '../src/render/city3dMeshes';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { UrbanBuildingPass, type Batch } from '../src/ui/urbanBuilding3d';
import { yardMeshTint, yardStyle } from '../src/render/yardStyle';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const square = (size: number) => ({ outer: [{ x: -size, y: -size }, { x: size, y: -size }, { x: size, y: size }, { x: -size, y: size }], holes: [] as { x: number; y: number }[][] });
const flat = (height: number): MassingPiece => ({ floors: 1, eave_m: height, rise_m: 0, roof: 'flat', ridges: [], cover: 'stone', wall: 'stone', openings: 'none' });

describe('building look regression', () => {
  it('distinguishes every hip plane, including after rotating the building', () => {
    const m: MassingPiece = { ...flat(6), roof: 'pyramid', rise_m: 6 };
    for (const angle of [0, .23, .61]) {
      const shape = square(6);
      shape.outer = shape.outer.map(p => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) }));
      const shades = pieceRoof(shape, m, 0).map(f => roofLight(f.normal)).sort((a, b) => a - b);
      expect(shades).toHaveLength(4);
      expect(shades[3] - shades[0]).toBeGreaterThan(.85);
      for (let i = 1; i < shades.length; i++) expect(shades[i] - shades[i - 1]).toBeGreaterThan(.025);
    }
    expect(roofPlaneLight([0, 0, 1])).toBe(1);
  });

  it('varies crown colours independently of the top lobe, with deterministic seeds', () => {
    const trees = Array.from({ length: 80 }, (_, i) => treeDwelling(square(5).outer, 12, 5, `crown-${i}`));
    const brightestTop = trees.filter(t => t.crowns.at(-1)!.tone === Math.max(...t.crowns.map(c => c.tone))).length;
    expect(brightestTop).toBeGreaterThan(0);
    expect(brightestTop).toBeLessThan(25);
    expect(treeDwelling(square(5).outer, 12, 5, 'crown-3')).toEqual(trees[3]);
  });

  it('keeps nested terrace elevations and open courts in the 3D mesh', () => {
    const footprint = [square(12), square(8), square(4)];
    footprint[0].holes = [footprint[1].outer.slice().reverse()];
    footprint[1].holes = [footprint[2].outer.slice().reverse()];
    const source = { id: 'pyramid', parcel_id: 'p', recipe_id: 'silhouette', ground_z_m: 10, footprint, roof_footprint: footprint,
      culture: { culture: 'maya' }, function: 'collective', volumes: [], programme: { role: 'worship.pyramid-precinct', landmark: true, massing: [flat(3), flat(6), flat(9)] } } as unknown as PlacedBuilding;
    const b = silhouetteBuilding(source);
    for (const overview of [false, true]) {
      const levels = new Set<number>();
      eachBuildingTriangle(b, face => { if (face.surface === 'roof') face.points.forEach(p => levels.add(p[2])); }, overview);
      expect([...levels].sort((a, b) => a - b)).toEqual([13, 16, 19]);
    }
    expect(b.volumes.map(v => v.wall_height_m)).toEqual([3, 6, 9]);
    // A planning record's zero reference must not sink a pyramid into the hill.
    const slope = silhouetteBuilding({ ...source, ground_z_m: 0 }, x => 20 + x / 2);
    expect(slope.ground_z_m).toBe(26);
    expect(slope.volumes.map(v => v.z_m + v.wall_height_m)).toEqual([29, 32, 35]);
    expect(slope.volumes[0].foundation.z_min_m).toBeCloseTo(13.7);
  });

  it('keeps yard copings matte through near and ribbon LODs, with no winter roof overlay', () => {
    class Capture extends UrbanBuildingPass {
      values: Float32Array[] = [];
      constructor() { super(undefined); }
      protected upload(_batch: Batch, values: Float32Array): void { this.values.push(values); }
      protected releaseBatch(): void {}
      prepareAll(level: number): void { for (const s of this.sectors) (this as unknown as { prepare(s: unknown, overview: boolean, f: undefined, yard: number): void }).prepare(s, level > 0, undefined, level); }
    }
    const boundaries = [{ path: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }], material: 'wall', culture: 'ottoman', side: 'front' }] as unknown as Parameters<typeof city3dLotEnclosures>[0];
    for (const level of [0, 1, 2]) {
      const pass = new Capture();
      pass.setScene({ buildings: city3dLotEnclosures(boundaries, () => 20) }, { style: 'cartographic', diagnostic: 'none', textured: true, roofSnow: { climateZone: 'arctic', season: 0, climate: CLIMATE_ZONE_VALUES.arctic } });
      pass.prepareAll(level);
      expect(pass.values.length).toBeGreaterThan(0);
      for (const values of pass.values) for (let i = 0; i < values.length; i += 10) expect(values[i + 8]).toBe(-1);
      pass.dispose();
    }
    expect(yardMeshTint(yardStyle('wall', 'ottoman').color)).toBe(yardStyle('wall', 'ottoman').color.slice(1));
  });
});
