import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { RoofBuilder } from '../src/render/city3d/roofGeometry';
import { baseVolume } from '../src/render/city3d/volume';
import { presetComposition } from '../src/render/composition';
import { DEFAULT_ROOF_MODE } from '../src/render/roofMode';
import * as bounds from '../src/render/craftedMassingBounds';
import * as frontage from '../src/render/houseFronts';
import * as surfaces from '../src/render/houseSurfaceTexture';
import * as charts from '../src/render/houseSurfaceUv';
import { UrbanBuildingPass } from '../src/ui/urbanBuilding3d';
import type { UrbanBuildingAppearance } from '../src/render/urbanBuildingStyle';

function dwelling(): PlacedBuilding {
  const footprint = [
    {
      outer: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 5 },
        { x: 0, y: 5 },
      ],
      holes: [],
    },
  ];
  const slots = { coating: 'city3d:wall:wood', cladding: 'city3d:cover:shingle', base: 'stone', frame: 'wood', roof_frame: 'wood', infill: 'wood' };
  const r = new RoofBuilder();
  r.face(
    footprint[0].outer.map(p => ({ ...p, z: 3 })),
    slots.cladding,
  );
  const v = baseVolume('v', footprint, 0, 3, 0, slots, r.mesh(), 'flat', { footprint, z_min_m: 0, z_max_m: 0 });
  return {
    id: 'cottage',
    function: 'domestic',
    culture: { culture: 'dwarven', pack: '', mode: 'fantasy_mix', borrowing: null },
    footprint,
    roof_footprint: footprint,
    volumes: [v],
    structural_features: [],
    ground_z_m: 0,
    entrance: { x: 3, y: 0 },
    transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 },
    parcel_id: 'lot',
    recipe_id: 'house',
    variant_id: 'main',
    courtyards: [],
    circulation: [],
    access_id: 'door',
    useful_area_m2: 30,
    domestic_units: 1,
    simplification: 'recipe_volumes',
    diagnostics: [],
    resolved: null,
  };
}

// Exercise the common 3D pass used by WebGL and WebGPU, substituting only the device calls.
class DeviceProbe extends UrbanBuildingPass {
  prepareAtlas = vi.fn(() => true);
  released = vi.fn();
  protected override releaseHouseAtlas() { this.released(); }
  protected override prepareHouseAtlas() {
    return this.prepareAtlas();
  }
  protected override upload() {}
  protected override releaseBatch() {}
  protected override render() {}
}

afterEach(() => vi.restoreAllMocks());

describe('opt-in detailed house architecture', () => {
  it('uses standard roof geometry in the shared V2 and bench defaults', () => {
    expect(DEFAULT_ROOF_MODE).toBe('v2');
    expect(presetComposition('parchment').buildings.roof).toBe('v2');
    expect(presetComposition('satellite').buildings.roof).toBe('v2');
  });

  it('only prepares facades, UVs and textures when the rendered style can show them, including clicks after a style switch', () => {
    const front = vi.spyOn(frontage, 'detailedHouseFront'),
      massing = vi.spyOn(bounds, 'includeCraftedMassing');
    const uv = vi.spyOn(charts, 'houseSurfaceMapper'),
      layer = vi.spyOn(surfaces, 'houseSurfaceLayer');
    const pass = new DeviceProbe(undefined);
    const frame = { matrix: new Float32Array([0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 1]), focal: 100, cameraX: 3, cameraY: 2, targetHeight: 1.5, distance: 8, exaggeration: 1 };
    const scene = { buildings: [dwelling()] };
    const normal = { style: 'cartographic', diagnostic: 'none' } as const;
    const modes: UrbanBuildingAppearance[] = [
      normal,
      { ...normal, roof: DEFAULT_ROOF_MODE },
      { ...normal, roof: 'crafted' },
      { ...normal, roof: 'crafted', diagnostic: 'uses' },
      { ...normal, roof: 'crafted', style: 'silhouette' },
      { ...normal, roof: 'v1' },
      { ...normal, roof: 'flat' },
      { ...normal, roof: 'minimal' },
    ];
    let wasDetailed = false;
    for (const appearance of modes) {
      vi.clearAllMocks();
      pass.setScene(scene, appearance);
      const active = appearance.roof === 'crafted' && appearance.diagnostic === 'none' && appearance.style === 'cartographic';
      expect(pass.released).toHaveBeenCalledTimes(wasDetailed && !active ? 1 : 0);
      wasDetailed = active;
      pass.draw(frame);
      expect(pass.lastDraw.triangles).toBeGreaterThan(0);
      expect(pass.pick([3, 2, 9], [0, 0, -1]).id).toBe('cottage');
      for (const work of [front, massing, uv, layer, pass.prepareAtlas]) {
        expect(work.mock.calls.length > 0).toBe(appearance.roof === 'crafted' && appearance.diagnostic === 'none' && appearance.style === 'cartographic');
      }
    }
  });
});
