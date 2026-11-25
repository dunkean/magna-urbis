import { describe, expect, it } from 'vitest';
import activities from '../../rust/crates/core/src/urban/activities.json';
import catalogue from '../../rust/crates/core/src/urban/catalogue.json';
import services from '../../rust/crates/core/src/urban/services.json';
import type { ActivitySite } from '../../rust/bridge/settlements';
import type { World } from '../src/gen/types';
import { activityScene, activitySitesOf, retainsActivityMassing } from '../src/v2/activitySites';
import { city3dScene } from '../src/render/city3d/scene';
import { ruralSiteDetails } from '../src/render/ruralSiteDetail';
import { ruralTrade } from '../src/render/ruralTrades';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { includeCraftedMassing } from '../src/render/craftedMassingBounds';

const ring = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];
const mass = { floors: 1, eave_m: 4, rise_m: 1.2, roof: 'hip', cover: 'tile', wall: 'brick', ridges: [] };
const building = (archetype: string, look: string, installation = false) => ({ archetype, look, ring, massing: [installation ? { ...mass, ground_m: 21, object: true } : mass] });
function site(buildings: ActivitySite['buildings'], culture = 'european-organic') {
  const world = { debug: { v2RustRegion: { placement: { activities: [{ id: 'place', culture, ground: 21, buildings, x: 1, y: 2 }] } } } } as unknown as World;
  return city3dScene(activityScene(world)!).buildings;
}
describe('working buildings in detailed architecture', () => {
  it('renders fittings for every building archetype and the farm and isolated-service catalogues', () => {
    const all = activities.archetypes.filter(a => a.kind === 'building');
    const extra = [...Object.keys(catalogue.farmstead.buildings), ...Object.keys(services.isolated).filter(id => id !== 'activity')];
    const records = [...all.map(a => building(a.id, a.look!)), ...extra.map(a => building(a, a))];
    for (const culture of ['roman-core', 'japanese-jokamachi']) {
      const scene = site(records, culture);
      expect(scene.length).toBe(records.length);
      const missing = records.filter((r, i) => {
        const works = ruralSiteDetails(scene[i]);
        return !ruralTrade(r.archetype) || !works?.size || ![...works.values()].every(w => w.mesh.faces.length > 0 && w.mesh.vertices.every(p => Number.isFinite(p.x + p.y + p.z)));
      });
      expect(missing.map(r => r.archetype)).toEqual([]);
    }
  });
  it('builds every raised yard installation, including open machinery in place of its solid proxy', () => {
    const labels = [...new Set(activities.archetypes.flatMap(a => a.objects?.map(o => o.part) ?? []))];
    const objects = site(labels.map(l => building('yard', l, true)));
    for (const [i, b] of objects.entries()) {
      const works = ruralSiteDetails(b);
      expect(works?.size, labels[i]).toBe(1);
      const w = [...works!.values()][0];
      expect(w.mesh.faces.length, labels[i]).toBeGreaterThan(0);
      if (['headframe', 'mill-wheel', 'quarry-crane'].includes(labels[i])) {
        expect(w.replace).toBe(true);
        const surfaces = (crafted: boolean, overview: boolean) => {
          const used = new Set<string>();
          eachBuildingTriangle(
            b,
            t => {
              if (t.material) used.add(t.material);
            },
            overview,
            undefined,
            0,
            false,
            crafted,
          );
          return used;
        };
        expect([...surfaces(true, false)].some(m => m.startsWith('city3d:detail:'))).toBe(true);
        expect(surfaces(true, true)).toEqual(surfaces(false, true));
        const bounds: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        includeCraftedMassing(b, bounds);
        expect(w.mesh.vertices.every(p => p.x >= bounds[0] && p.z <= bounds[5])).toBe(true);
      }
    }
  });
  it('keeps the métier of each footprint when the city bench groups a whole works in one parcel', () => {
    const [base] = site([building('potter_workshop', 'hall')]);
    const other = ring.map(p => ({ ...p, x: p.x + 24 }));
    const lot = {
      ...base,
      sitePart: undefined,
      recipe_id: 'silhouette',
      volumes: [],
      footprint: [
        { outer: ring, holes: [] },
        { outer: other, holes: [] },
      ],
      programme: { activity: { archetypes: ['pottery_kiln_house', 'mine_winch_house'], forms: ['shop-body', 'headframe'] }, massing: [mass, mass] },
    };
    const result = city3dScene({ schema_version: '1', generator_version: 'test', buildings: [lot], refusals: [], open_spaces: [] }).buildings[0];
    const works = [...ruralSiteDetails(result)!.values()];
    expect(works.map(w => w.volume.ruralPiece)).toEqual([0, 1]);
    expect(works[0].mesh.faces.some(f => f.material.includes('fired-clay'))).toBe(true);
    expect(works[1].mesh.faces.some(f => f.material.includes('rope'))).toBe(true);
  });
  it('replaces all the tiers of a quarry crane once, with its jib at working height', () => {
    const [base] = site([building('yard', 'quarry-crane', true)]);
    const v = base.volumes[0];
    const upper = { ...v, id: v.id + '/upper', z_m: v.z_m + v.wall_height_m, wall_height_m: 4 };
    const works = ruralSiteDetails({ ...base, volumes: [v, upper] })!;
    expect(works.get(v)).toBe(works.get(upper));
    expect(Math.max(...works.get(v)!.mesh.vertices.map(p => p.z))).toBeGreaterThan(upper.z_m + 2);
  });
  it('displays authored buildings immediately when reopening a world with an older native-plan cache', () => {
    const world = { debug: { v2RustRegion: { placement: { activities: [{ id: 'mill', culture: 'chinese', ground: 21, buildings: [building('water_gristmill', 'water_mill')] }] } } } } as unknown as World;
    const sites = activitySitesOf(world);
    world.debug!.v2ActivityPlans = { sites, key: 'old', scene: { buildings: [] } };
    expect(activityScene(world)?.buildings.map(b => b.variant_id)).toEqual(['water_mill']);
  });
  it('keeps authored mill equipment, composite bodies, installations and ruin pieces through native planning', () => {
    const b = building('wind_gristmill', 'shed');
    expect(retainsActivityMassing({ ...b, massing: [{ ...mass, volumes: [{ features: [{ kind: 'sails' }] }] }] })).toBe(true);
    for (const form of ['mill-wheel', 'mill-buck', 'wind_mill', 'headframe', 'ruin-corner', 'shaft-furnace', 'stilt', 'domed']) expect(retainsActivityMassing({ ...b, look: form })).toBe(true);
    expect(retainsActivityMassing(building('tool_shed', 'shed'))).toBe(false);
    const [ruin] = ruralSiteDetails(site([building('potter_workshop', 'ruin-corner')])[0])!.values();
    expect(ruin.replace).toBe(false);
    expect(ruin.mesh.faces.length).toBeGreaterThan(0);
    expect(ruin.mesh.faces.some(f => f.material.includes('fired-clay'))).toBe(false);
  });
});
