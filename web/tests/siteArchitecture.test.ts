import { describe, expect, it } from 'vitest';
import type { Farmstead, World } from '../src/gen/types';
import { farmPlacedBuildings } from '../src/render/farmRoofs';
import { city3dScene } from '../src/render/city3d/scene';
import { detailedHouseFront } from '../src/render/houseFronts';
import { siteCrown } from '../src/render/siteCrown';
import { architectureUse, type SiteBuilding } from '../src/render/siteArchitecture';
import { activityScene } from '../src/v2/activitySites';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';

const ring = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 7 },
  { x: 0, y: 7 },
];
const piece = { floors: 2, eave_m: 6, rise_m: 0, roof: 'flat', cover: 'stone', wall: 'stone', ridges: [] };
function farm(culture: string, use: string) {
  const f: Farmstead = { pos: ring[0], angle: 0, yard: [], drive: [], buildings: [ring], culture, parts: [{ poly: ring, use, arch: use, roof: 'flat', massing: [piece] }] };
  return farmPlacedBuildings([f], () => 21)[0];
}
function scene(buildings: SiteBuilding[]) {
  return city3dScene({ schema_version: '1', generator_version: 'test', buildings, refusals: [], open_spaces: [] }).buildings;
}
describe('detailed architecture on the shared city and countryside scene', () => {
  it('uses the same dwelling frontage for a rural hut and distinct regional loading frames for its outbuildings', () => {
    const [home, barn, classicalBarn, loft] = scene([farm('chinese', 'hut'), farm('chinese', 'barn'), farm('roman-core', 'barn'), farm('european-organic', 'dovecote')]);
    expect(architectureUse(home)).toBe('home');
    expect(detailedHouseFront(home)?.mesh.faces.length).toBeGreaterThan(0);
    const bays = [barn, classicalBarn].map(b => detailedHouseFront(b)!.mesh);
    expect(bays[0].faces.length).not.toBe(bays[1].faces.length);
    expect(detailedHouseFront(loft)?.mesh.faces.some(f => f.material.includes('flight-hole'))).toBe(true);
  });
  it('resolves the individual body of a remote site and excludes its installation objects', () => {
    const buildings = [
      { archetype: 'wayside_shrine', look: 'aedicula', ring, massing: [piece] },
      { archetype: 'wayside_shrine', look: 'stele-tall', ring, massing: [piece] },
      { archetype: 'wayside_shrine', look: 'tomb-wall', ring, massing: [piece] },
      { archetype: 'storage', look: 'shed', ring, massing: [{ ...piece, object: true, ground_m: 21 }] },
    ];
    const site = { id: 'remote/21', template: 'wayside', culture: 'roman-core', x: 6, y: 4, ground: 21, buildings };
    const world = { debug: { v2RustRegion: { placement: { activities: [site] } } } } as unknown as World;
    const [shrine, marker, wall, rack] = city3dScene(activityScene(world)!).buildings;
    expect(detailedHouseFront(shrine)).toBeTruthy();
    expect(siteCrown(marker)?.mesh.faces.length).toBeGreaterThan(0);
    expect([wall, rack].map(architectureUse)).toEqual([undefined, undefined]);
    expect(detailedHouseFront(marker)).toBeNull();
  });
  it('fits the keep crown to its actual elevation and selects geometry only for a close detailed view', () => {
    const programme = { role: 'defence.keep', landmark: true, massing: [piece] };
    const b: SiteBuilding = { ...farm('european-organic', 'house'), sitePart: undefined, function: 'collective', programme };
    const [keep] = scene([b]);
    const crown = siteCrown(keep)!;
    const eave = crown.volume.z_m + crown.volume.wall_height_m;
    const top = (crafted: boolean, overview = false) => {
      let high = -Infinity;
      eachBuildingTriangle(
        keep,
        t => {
          for (const p of t.points) high = Math.max(high, p[2]);
        },
        overview,
        undefined,
        0,
        false,
        crafted,
      );
      return high;
    };
    expect(top(false)).toBeCloseTo(eave);
    expect(top(true)).toBeGreaterThan(eave + 0.3);
    expect(top(true, true)).toBeCloseTo(top(false, true));
    expect(detailedHouseFront(keep)).toBeTruthy();
  });
});
