import { describe, expect, it } from 'vitest';
import type { Farmstead, Settlement, World } from '../../src/gen/types';
import { isolatedPlacesOf } from '../../src/v2/isolatedPlaces';

const farm = (x: number, y: number, drive: { x: number; y: number }[], tags: string[] = []): Farmstead => ({ pos: { x, y }, angle: 0, buildings: [], yard: [], drive, culture: 'frankish', type: 'longere', tags }) as Farmstead;
const place = (key: string, x: number, y: number, radius: number): Settlement => ({ key, index: 0, main: key === 'main', cls: 'village', population: 400, culture: 'frankish', center: { x, y }, radius }) as unknown as Settlement;
type Road = NonNullable<World['roads']>[number];
const road = (path: { x: number; y: number }[]): Road => ({ path, width: 6, kind: 'minor' }) as Road;

/** Main town, a village; a lone farm whose routed drive starts on the north-south road at x = 1500, a farm no track
 * reaches, a hamlet lane from the east-west road at y = 1800 with two farms joining it, and the main town's own farm. */
function fixture() {
  const roads = [
    road([
      { x: 1500, y: 0 },
      { x: 1500, y: 3000 },
    ]),
    road([
      { x: 0, y: 1800 },
      { x: 5000, y: 1800 },
    ]),
  ];
  const farmsteads = [
    farm(1100, 1050, [
      { x: 1100, y: 1000 },
      { x: 1100, y: 1040 },
    ]),
    farm(2000, 1500, [
      { x: 1500, y: 1300 },
      { x: 1800, y: 1450 },
      { x: 2000, y: 1490 },
    ]),
    farm(3000, 3000, [
      { x: 3000, y: 2990 },
      { x: 3000, y: 2990 },
    ]),
    farm(
      3600,
      2000,
      [
        { x: 3600, y: 1800 },
        { x: 3600, y: 2080 },
        { x: 3606, y: 2000 },
      ],
      ['hamlet'],
    ),
    farm(
      3600,
      2040,
      [
        { x: 3600, y: 2040 },
        { x: 3606, y: 2040 },
      ],
      ['hamlet'],
    ),
    farm(
      3600,
      2080,
      [
        { x: 3600, y: 2080 },
        { x: 3606, y: 2080 },
      ],
      ['hamlet'],
    ),
  ];
  const world = { settlements: [place('main', 1000, 1000, 300), place('village-0', 4000, 1000, 150)], roads, landuse: { areas: [], reserve: [], farmsteads } } as unknown as World;
  return { world, roads, farmsteads };
}

describe('isolated inhabited places', () => {
  // The reported failure: land-use farms stood on the map, with a track, but no list showed them.
  it('lists land-use farms outside every place, with identity, category, parish and access', () => {
    const { world } = fixture();
    const places = isolatedPlacesOf(world);
    expect(places.map(p => p.category)).toEqual(['hamlet', 'farmstead', 'farmstead']);
    const [hamlet, ...farms] = places;
    // The hamlet's two inner farms join its lane, which starts on the road: the whole hamlet is reached.
    expect(hamlet).toMatchObject({ farms: 3, near: 'village-0', connected: true, key: 'isolated:hamlet:3600:2000' });
    const routed = farms.find(p => p.center.x === 2000)!,
      cutOff = farms.find(p => p.center.x === 3000)!;
    expect(routed).toMatchObject({ category: 'farmstead', farms: 1, near: 'main', connected: true, culture: 'frankish', type: 'longere' });
    expect(cutOff.connected).toBe(false);
    // No duplicate of a listed place: the farm inside the main town is not listed again.
    expect(places.some(p => Math.hypot(p.center.x - 1100, p.center.y - 1050) < 1)).toBe(false);
    // Stable: unchanged inputs give the same list object.
    expect(isolatedPlacesOf(world)).toBe(places);
  });

  it('follows moved or replaced places with the same farms', () => {
    const { world } = fixture();
    const before = isolatedPlacesOf(world);
    expect(before.find(p => p.center.x === 2000)?.near).toBe('main');
    // A replaced settlements array: the village moves next to the lone farm; the farms array is the same object.
    const moved = { ...world, settlements: [place('main', 1000, 1000, 300), place('village-0', 2300, 1500, 150)] } as World;
    expect(isolatedPlacesOf(moved).find(p => p.center.x === 2000)?.near).toBe('village-0');
    // A place moved in place onto the farm: the farm becomes its own farm and leaves the list.
    world.settlements![0].center = { x: 2000, y: 1500 };
    expect(isolatedPlacesOf(world).some(p => p.center.x === 2000)).toBe(false);
  });

  it('reports a farm no longer connected when a road edit removes or moves the road its drive joined', () => {
    const { world, roads } = fixture();
    expect(isolatedPlacesOf(world).find(p => p.center.x === 2000)?.connected).toBe(true);
    // The north-south road removed (a new roads array, as an edit produces): the drive ends in the fields.
    const cut = { ...world, roads: [roads[1]] } as World;
    expect(isolatedPlacesOf(cut).find(p => p.center.x === 2000)?.connected).toBe(false);
    expect(isolatedPlacesOf(cut).find(p => p.category === 'hamlet')?.connected).toBe(true);
    // The east-west road moved in place, away from the hamlet lane: the hamlet loses its access.
    roads[1].path = [
      { x: 0, y: 1700 },
      { x: 5000, y: 1700 },
    ];
    expect(isolatedPlacesOf(world).find(p => p.category === 'hamlet')?.connected).toBe(false);
  });

  it('counts a town street as the network a drive may join', () => {
    const { world } = fixture();
    const streetWorld = {
      ...world,
      roads: [],
      urban: {
        streets: [
          {
            path: [
              { x: 1400, y: 1300 },
              { x: 1600, y: 1300 },
            ],
            width: 5,
            kind: 'street',
          },
        ],
      },
    } as unknown as World;
    expect(isolatedPlacesOf(streetWorld).find(p => p.center.x === 2000)?.connected).toBe(true);
  });

  it('counts a gate directly on a road as connected without a separate driveway', () => {
    const { world } = fixture();
    world.landuse!.farmsteads = [
      farm(1505, 1400, [
        { x: 1500, y: 1400 },
        { x: 1500, y: 1400 },
      ]),
    ];
    expect(isolatedPlacesOf(world)[0].connected).toBe(true);
  });

  it('is empty without land use', () => {
    expect(isolatedPlacesOf(undefined)).toEqual([]);
    expect(isolatedPlacesOf({ settlements: [] } as unknown as World)).toEqual([]);
  });
});
