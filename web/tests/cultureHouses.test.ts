import { describe, expect, it } from 'vitest';
import { silhouetteBuilding, surfaceArea } from '../src/render/city3dMeshes';
import { buildingRoof, pieceTop, pieceVolumes, type MassingPiece, type VolumeDetail } from '../src/render/cityMassing';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { buildCityBuildings } from '../src/render/cityCanvas';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';

const rect = (w = 12, d = 8): Surface => [{ outer: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], holes: [] }];
const circle = (): Surface => [{ outer: Array.from({ length: 16 }, (_, k) => ({ x: 6 + 5 * Math.cos(k * Math.PI / 8), y: 6 + 5 * Math.sin(k * Math.PI / 8) })), holes: [] }];
function house(culture: string, footprint: Surface, detail: VolumeDetail, roof: MassingPiece['roof'] = 'dome', eave = 10): PlacedBuilding {
  const massing: MassingPiece[] = footprint.map(shape => ({ floors: 2, eave_m: eave, rise_m: roof === 'flat' ? 0 : 4, roof, ridges: [], cover: 'turf', wall: 'wood',
    volumes: [{ ...detail, ring: shape.outer.map(p => [p.x, p.y]), floors: 2, eave_m: eave, rise_m: roof === 'flat' ? 0 : 4, roof, ridges: [], cover: culture === 'mongol-ordu' ? 'felt' : 'turf', wall: 'wood' }] }));
  return { id: culture, parcel_id: culture, function: 'domestic', culture: { culture, pack: '', mode: 'inspired', borrowing: null }, recipe_id: 'silhouette', variant_id: '',
    ground_z_m: 0, footprint, roof_footprint: footprint, volumes: [], structural_features: [], transform: { origin: { x: 6, y: 6 }, orientation_deg: 0 },
    programme: { role: 'dwelling.house', massing } } as unknown as PlacedBuilding;
}

describe('culture house exteriors', () => {
  it.each([['elven', 'tree', 0.22], ['myconid-colony', 'mushroom', 0.3]] as const)('%s separates the narrow body from its broad crown', (culture, form, scale) => {
    const source = house(culture, circle(), { form }), b = silhouetteBuilding(source), v = b.volumes[0];
    const share = surfaceArea(v.levels[0].footprint) / surfaceArea(v.footprint);
    if (form === 'tree') { expect(share).toBeGreaterThanOrEqual(0.15 ** 2); expect(share).toBeLessThanOrEqual(0.3 ** 2); }
    else expect(share).toBeCloseTo(scale ** 2);
    expect(v.roof_mesh.faces.some(f => f.normal[2] > 0.1)).toBe(true);
    expect(v.roof_mesh.faces.every(f => /@[0-9a-f]{6}$/.test(f.material))).toBe(true);
  });

  it.each(['mongol-ordu', 'tibetan-monastery'])('%s produces finite nonempty roof and wall geometry', culture => {
    const b = silhouetteBuilding(house(culture, culture === 'mongol-ordu' ? circle() : rect(), { form: culture === 'mongol-ordu' ? 'yurt' : 'battered' }, culture === 'mongol-ordu' ? 'tent' : 'flat', culture === 'mongol-ordu' ? 1.6 : 9));
    let triangles = 0;
    eachBuildingTriangle(b, t => { triangles++; expect(t.points.flat().every(Number.isFinite)).toBe(true); });
    expect(triangles).toBeGreaterThan(20);
    if (culture === 'tibetan-monastery') expect(b.volumes[0].envelope).toBe('open');
  });

  it('keeps a barrel entirely inside its plan and closes both ends', () => {
    const footprint = rect(40, 6.5), massing: MassingPiece[] = [{ floors: 1, eave_m: 1.5, rise_m: 2.6, roof: 'barrel', ridges: [[0.05, 3.25, 39.95, 3.25]], cover: 'bark', wall: 'wood' }];
    const faces = buildingRoof(footprint, massing), pans = faces.filter(f => f.normal[2] > 0.08);
    expect(pans.reduce((a, f) => a + surfaceArea([{ outer: f.points, holes: [] }]), 0)).toBeCloseTo(260);
    for (const p of faces.flatMap(f => f.points)) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(40); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(6.5); }
    expect(faces.filter(f => Math.abs(f.normal[2]) < 0.01)).toHaveLength(16);
  });

  it('raises multi-storey tidal homes and draws the same deck and post heads in plan', () => {
    const source = house('merfolk-tidal', rect(), { stilts_m: 2.8 }, 'dome', 6), b = silhouetteBuilding(source), v = b.volumes[0];
    expect(v.z_m).toBe(2.8);
    expect(v.foundation.z_max_m).toBe(v.foundation.z_min_m);
    expect(v.roof_mesh.vertices.some(p => p.z === 0)).toBe(true);
    expect(pieceTop((source as unknown as { programme: { massing: MassingPiece[] } }).programme.massing[0])).toBeCloseTo(12.8);
    const plan = buildCityBuildings({ buildings: [source] });
    expect(plan.items[0].surface).toHaveLength(5);
    expect(surfaceArea([plan.items[0].surface[0]])).toBeGreaterThan(96);
  });

  it('retains a mage tower form with a slender cone and varied physical height', () => {
    const source = house('wizard-city', circle(), { form: 'tower' }, 'cone', 31), b = silhouetteBuilding(source);
    expect(b.volumes[0].wall_height_m).toBe(31);
    const m = (source as unknown as { programme: { massing: MassingPiece[] } }).programme.massing[0];
    expect(pieceVolumes(source.footprint[0], m)[0].detail?.form).toBe('tower');
    expect(Math.max(...b.volumes[0].roof_mesh.vertices.map(p => p.z))).toBe(35);
  });

  it('places giant doors outside the wall and scales their opening with the storey', () => {
    const b = silhouetteBuilding(house('giant-hold', rect(30, 20), {}, 'hip', 15)), mesh = b.volumes[0].roof_mesh;
    const doors = mesh.faces.filter(f => f.material === 'city3d:wall:opening@393126').map(f => f.vertices.map(i => mesh.vertices[i]));
    expect(doors.length).toBeGreaterThan(0);
    expect(doors[0].every(p => p.y < 0 || p.y > 20 || p.x < 0 || p.x > 30)).toBe(true);
    expect(Math.max(...doors[0].map(p => p.z))).toBeCloseTo(5.25);
  });
});
