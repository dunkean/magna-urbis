import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { silhouetteBuilding } from '../src/render/city3dMeshes';
import type { MassingPiece, MassingRoof } from '../src/render/cityMassing';
import { houseWallStyle } from '../src/render/houseWallArt';
import { houseRoofStyle, roofFaceForm } from '../src/render/houseRoofArt';
import { HOUSE_TILE_LAYERS, houseSurfaceLayer } from '../src/render/houseSurfaceTexture';
import { BUILDING_STRIDE, buildingBatches } from '../src/render/world/buildingsMesh';

/** Pass a Rust-format massing volume through the same mesh and packed-vertex path as the bench. */
function roofDrawings(cover: string, roof: MassingRoof, role: string): Set<number> {
  const culture = 'dravidian-temple',
    rise_m = roof === 'flat' ? 0 : 9;
  const outer = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 8 },
    { x: 0, y: 8 },
  ];
  const piece: MassingPiece = { floors: 1, eave_m: 4, rise_m, roof, ridges: [], cover, wall: 'stone' };
  piece.volumes = [{ ...piece, ring: outer.map(({ x, y }) => [x, y]) }];
  const footprint = [{ outer, holes: [] }];
  const source = {
    id: 'vernacular-test',
    parcel_id: 'test',
    function: 'domestic',
    culture: { culture, pack: '', mode: 'inspired', borrowing: null },
    recipe_id: 'silhouette',
    variant_id: '',
    ground_z_m: 0,
    footprint,
    roof_footprint: footprint,
    volumes: [],
    structural_features: [],
    transform: { origin: { x: 6, y: 4 }, orientation_deg: 0 },
    programme: { role, massing: [piece] },
  } as unknown as PlacedBuilding;
  const layers = new Set<number>();
  for (const { data } of buildingBatches([silhouetteBuilding(source)], [0, 0], { appearance: { style: 'cartographic', diagnostic: 'none', roof: 'crafted' }, materials: [], snowAltitudes: new Map() }, false)) {
    for (let i = 0; i < data.length; i += BUILDING_STRIDE) {
      if (data[i + 4] <= 0) continue;
      const payload = Math.round((Math.hypot(data[i + 3], data[i + 4], data[i + 5]) - 1) * 32);
      const layer = Math.floor(payload / 1024);
      if (layer > 0) layers.add(((layer - 1) % HOUSE_TILE_LAYERS) + 1);
    }
  }
  return layers;
}

describe('detailed roof finishes in South Asian settlements', () => {
  it.each(['indian-temple', 'dravidian-temple', 'rajput-fort', 'south-asian-metropolis'])('retains the actual terrace covering in %s', culture => {
    expect(houseRoofStyle(culture, 'MAT-TILE-CLAY', 'terrace', 'lime')).toBe('terrace-clay');
    expect(houseRoofStyle(culture, 'MAT-STONE-ASHLAR', 'terrace', 'slab')).toBe(culture === 'rajput-fort' ? 'sandstone-flags' : 'stone-flags');
    expect(houseRoofStyle(culture, 'MAT-PLASTER-LIME', 'terrace', 'lime')).toBe('lime-terrace');
    expect(houseRoofStyle(culture, 'MAT-MUD-PLASTER', 'terrace', 'earth')).toBe('earth');
    expect(houseRoofStyle(culture, 'MAT-SLATE', 'pitch', 'slab')).toBe('slate');
    expect(houseRoofStyle(culture, 'glass', 'terrace')).toBe('glazing');
    expect(houseRoofStyle(culture, 'thatch', 'pitch')).toBe('thatch');
    expect(houseRoofStyle(culture, 'tile', 'pitch')).toBe(culture === 'south-asian-metropolis' ? 'pressed-clay' : 'country-clay');
  });

  it('keeps a level crown, an inclined porch, and a steep masonry shrine distinct', () => {
    const role = 'worship.temple.major';
    expect(roofFaceForm([0, 0, 3], role)).toBe('terrace');
    expect(roofFaceForm([0.4, 0, 1], role)).toBe('pitch');
    expect(roofFaceForm([3, 0, 1], role)).toBe('tower');
    expect(roofFaceForm([3, 0, 1], 'worship.shrine')).toBe('tower');
    expect(roofFaceForm([3, 0, 1], 'dwelling.house')).toBe('pitch');
    expect(houseRoofStyle('dravidian-temple', 'stone', 'tower')).toBe('dressed-courses');
    expect(houseRoofStyle('dravidian-temple', 'MAT-BURNT-BRICK', 'tower', 'slab')).toBe('brick-courses');
    expect(houseRoofStyle('dravidian-temple', 'tile', 'tower')).toBe('country-clay');
    expect(houseSurfaceLayer('roof', 'indian-temple', 'unrecognised-cover', 'pitch')).toBe(0);
  });

  it('uses coursed or dressed regional masonry on stone walls and retains lime on plaster', () => {
    expect(houseWallStyle('dravidian-temple', 'stone')).toBe('coursedStone');
    expect(houseWallStyle('rajput-fort', 'stone')).toBe('sandstone');
    expect(houseWallStyle('dravidian-temple', 'plaster')).toBe('lime');
  });

  it('carries the covering and worship role through actual generated roof triangles', () => {
    const culture = 'dravidian-temple';
    const tile = houseSurfaceLayer('roof', culture, 'tile', 'terrace'),
      stone = houseSurfaceLayer('roof', culture, 'stone', 'terrace'),
      lime = houseSurfaceLayer('roof', culture, 'plaster', 'terrace');
    expect(new Set([tile, stone, lime]).size).toBe(3);
    expect(roofDrawings('tile', 'flat', 'dwelling.house')).toContain(tile);
    expect(roofDrawings('plaster', 'flat', 'dwelling.house')).toContain(lime);
    expect(roofDrawings('stone', 'flat', 'worship.temple.major')).toContain(stone);
    expect(roofDrawings('stone', 'pyramid', 'worship.temple.major')).toContain(houseSurfaceLayer('roof', culture, 'stone', 'tower'));
    expect(roofDrawings('stone', 'pyramid', 'dwelling.house')).toContain(houseSurfaceLayer('roof', culture, 'stone', 'pitch'));
  });
});
