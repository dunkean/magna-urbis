import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { city3dSurfaceSamplers } from '../src/render/city3dHeight';
import { city3dBridges, silhouetteBuilding } from '../src/render/city3dMeshes';
import { UrbanBuildingGround } from '../src/ui/urbanBuildingGround';

const raster = () => ({ width: 40, n: 4, height: new Float32Array(16).fill(24),
  water: Uint8Array.from({ length: 16 }, (_, i) => i % 4 === 1 ? 3 : 0) });

describe('shared 3D terrain and structure heights', () => {
  it('seats town massing and both bridge abutments on the drawn surface instead of planning cells', () => {
    const { heightAt, waterAt } = city3dSurfaceSamplers(raster(), x => 3 + x * .01);
    const footprint = [{ outer: [{ x: 24, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 16 }, { x: 24, y: 16 }], holes: [] }];
    const building = silhouetteBuilding({ id: 'town', recipe_id: 'silhouette', ground_z_m: 24, footprint,
      roof_footprint: footprint, volumes: [], culture: { culture: 'european-organic' } } as unknown as PlacedBuilding, heightAt);
    expect(building.ground_z_m).toBeCloseTo(3.3);
    expect(building.volumes.every(v => v.foundation.z_min_m <= 3.24)).toBe(true);
    const [bridge] = city3dBridges([{ path: [{ x: 0, y: 15 }, { x: 40, y: 15 }], widths: [4, 4], role: 'bridge' }], heightAt, waterAt);
    const deck = bridge.volumes.filter(v => v.id.endsWith(':deck')).flatMap(v => v.roof_mesh.vertices);
    const ends = [Math.min(...deck.map(p => p.x)), Math.max(...deck.map(p => p.x))];
    const constrained = new UrbanBuildingGround({ buildings: [bridge] });
    for (const x of ends) {
      const top = Math.max(...deck.filter(p => p.x === x).map(p => p.z));
      for (const exaggeration of [1, 2, 5]) expect((top - heightAt(x, 15)) * exaggeration).toBeCloseTo(.12 * exaggeration);
      expect(constrained.constrain(x, 15, heightAt(x, 15))).toBe(heightAt(x, 15));
    }
    expect(Math.max(...deck.map(p => p.z))).toBeLessThan(5);
    expect(Number.isNaN(waterAt(5, 15))).toBe(true);
    expect(waterAt(15, 15)).toBeCloseTo(3.15);
  });

  it('uses flat terrain unchanged and follows a replaced or refined surface without caching heights', () => {
    let height: number | undefined = 24;
    const sampler = city3dSurfaceSamplers(raster(), () => height);
    expect(sampler.heightAt(15, 15)).toBe(24);
    height = 4;
    expect(sampler.heightAt(15, 15)).toBe(4);
    expect(sampler.waterAt(15, 15)).toBe(4);
    height = undefined;
    expect(sampler.heightAt(15, 15)).toBeCloseTo(24);
  });

  it('keeps bridge decks at road level at both ends, cambered over the water and never lifted by a clearance', () => {
    const top = (ground: (x: number) => number) => {
      const [bridge] = city3dBridges([{ path: [{ x: 0, y: 0 }, { x: 60, y: 0 }], widths: [6, 6], role: 'bridge' }], x => ground(x), x => x >= 1 && x <= 59 ? ground(x) : NaN);
      const deck = bridge.volumes.filter(v => v.id.endsWith(':deck')).flatMap(v => v.roof_mesh.vertices);
      return (x: number) => Math.max(...deck.filter(p => Math.abs(p.x - x) < 1e-6).map(p => p.z));
    };
    // Low banks: ends on the road, the camber clears the water surface (≥ 1.5 m) mid-span.
    const low = top(x => x >= 1 && x <= 59 ? 9.8 : 10);
    expect(low(0)).toBeCloseTo(10.12); expect(low(60)).toBeCloseTo(10.12);
    expect(low(30)).toBeGreaterThanOrEqual(9.8 + 1.5 - 1e-6); expect(low(30)).toBeLessThan(11.5);
    // A deep channel: the deck stays on the line between its roads, no rise above it.
    const deep = top(x => x >= 1 && x <= 59 ? 2 : x < 30 ? 20 : 14);
    expect(deep(0)).toBeCloseTo(20.12); expect(deep(60)).toBeCloseTo(14.12);
    expect(deep(30)).toBeLessThan(17.12 + 1);
  });
});
