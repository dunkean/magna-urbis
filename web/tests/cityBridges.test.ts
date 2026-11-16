import { describe, expect, it, vi } from 'vitest';
import type { Layout, Street } from '../../rust/bridge/urban';
import type { RoadOutput } from '../../rust/bridge/settlements';
import { outsideUrbanStreets } from '../../rust/bridge/urbanNetwork';
import { bridgeRoadOwnership, bridgeWaterHeight, cityBridgeStreets, cityRegionalNetwork, snapCrossingToWater, snapRoadCrossings, urbanReplacesCrossing } from '../src/render/cityBridges';
import { buildCityScene, drawCity } from '../src/render/cityCanvas';
import { buildFillMeshSync, buildStreetStrokes, META, packPlan, STROKE_STRIDE } from '../src/render/cityGlBuild';
import { DEFAULT_LAYERS, planColors } from '../src/render/cityGlStyle';
import { city3dBridges, city3dWalls } from '../src/render/city3dMeshes';
import { wallDetail } from '../src/render/cityWalls';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';

const street = (path: [number, number][], width = 3, role = 'bridge'): Street => ({ path: path.map(([x, y]) => ({ x, y })), widths: path.map(() => width), rank: 4, role });
const layout = (streets: Street[]): Layout => ({ key: 'river', center: { x: 50, y: 0 }, culture: 'bastide', streets, quarters: [], blocks: [], enclosures: [], warnings: [] }) as unknown as Layout;

describe('bridge visibility and ownership', () => {
  it('keeps narrow minor bridges in the Canvas and GPU plan at every LOD', () => {
    class Path { moveTo() {} lineTo() {} closePath() {} addPath() {} }
    vi.stubGlobal('Path2D', Path);
    try {
      const scene = buildCityScene([layout([street([[0, 0], [100, 0]], 1.5), street([[0, 20], [100, 20]], 3), street([[0, 40], [100, 40]], 8)])]);
      const strokes = buildStreetStrokes(scene, { x: 0, y: 0 }), metadata = new Uint32Array(strokes.data), mesh = buildFillMeshSync(packPlan(scene));
      expect(strokes.count).toBe(3);
      for (let i = 0; i < 3; i++) expect(metadata[i * STROKE_STRIDE + 8] & META.crossing).toBe(META.crossing);
      for (const lod of ['far', 'mid', 'near', 'close'] as const) {
        const ctx = new Proxy({ stroke: vi.fn() }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined }) as unknown as CanvasRenderingContext2D;
        const stats = drawCity(ctx, scene, { viewport: { minX: -10, minY: -10, maxX: 110, maxY: 50 }, mpp: 1, dpr: 1, lod, palette: 'parchment', view: 'buildings', width: 1,
          layers: { ...DEFAULT_LAYERS, blocks: false, domains: false, enclosures: false, centers: false }, buildingsVisible: false, appearance: { style: 'cartographic', diagnostic: 'none' } });
        expect(stats.streets).toBe(3); expect(ctx.stroke).toHaveBeenCalled();
        const colors = planColors(scene, mesh, { lod, palette: 'parchment', view: 'buildings', layers: DEFAULT_LAYERS, buildingsVisible: false, diagnostic: 'none' });
        expect(colors.draws.streets).toBe(true); expect(colors.draws.streetCasing).toBe(true);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('retires the old oblique regional deck in both displays while retaining other channels', () => {
    const canonical = street([[0, 0], [100, 0]], 6), old = street([[0, -30], [100, 30]], 6), far = street([[500, -30], [600, 30]], 6);
    const city = layout([canonical]);
    expect(cityBridgeStreets([city], [old, canonical, far])).toEqual([canonical, far]);
    const roads = { segments: [{ width: 6, crossings: [{ kind: 'bridge', path: old.path }] }] } as unknown as RoadOutput;
    const masks = bridgeRoadOwnership([city], roads);
    expect(outsideUrbanStreets([old], masks)).toEqual([]);
    expect(city.streets).toEqual([canonical]);
    expect(urbanReplacesCrossing(street([[14, 0], [20, 0]]), [layout([street([[0, 0], [6, 0]])])])).toBe(false);
    const moved = layout([street([[30, 100], [130, 100]], 6), street([[0, -30], [30, 100]], 6, 'approach'), street([[100, 30], [130, 100]], 6, 'approach')]);
    expect(urbanReplacesCrossing(old, [moved])).toBe(true);
  });

  it('builds an elevated deck, two parapets and piers in one bridge batch', () => {
    const bridges = city3dBridges([street([[0, 0], [80, 0]], 6)], () => 0, () => 10);
    expect(bridges).toHaveLength(1);
    const b = bridges[0], deck = b.volumes.find(v => v.id.endsWith(':deck'))!;
    expect(deck.z_m + deck.wall_height_m).toBeGreaterThan(10);
    const rails = b.volumes.filter(v => v.id.includes(':parapet:'));
    expect(rails).toHaveLength(2); expect(b.volumes.some(v => v.id.includes(':pier:'))).toBe(true);
    expect(rails.every(v => Math.abs(v.z_m-deck.z_m-0.9) < 0.01 && Math.abs(v.z_m+v.wall_height_m-deck.z_m-deck.wall_height_m-1.05) < 0.01)).toBe(true);
    let triangles = 0, top = -Infinity;
    eachBuildingTriangle(b, t => { triangles++; top = Math.max(top, ...t.points.map(p => p[2])); });
    expect(triangles).toBeGreaterThan(30); expect(top).toBeGreaterThan(deck.z_m + deck.wall_height_m + 1);
    const raised = city3dBridges([street([[0, 0], [80, 0]], 6, 'causeway')], x => x >= 79 ? 8 : 0);
    expect(raised[0].volumes.some(v => v.id.includes(':pier:'))).toBe(true);
  });

  it('keeps a dry hillside approach from raising the river deck', () => {
    const bridges = city3dBridges([street([[-200, 0], [0, 0], [40, 0], [200, 0]], 6)],
      x => Math.max(0, -x / 2), x => x >= 0 && x <= 40 ? 0 : NaN);
    expect(bridges).toHaveLength(1);
    const deck = bridges[0].volumes.find(v => v.id.endsWith(':deck'))!;
    expect(deck.z_m + deck.wall_height_m).toBeLessThan(4);
    expect(bridges[0].footprint.flatMap(s => s.outer).every(p => p.x >= -2.1 && p.x <= 42.1)).toBe(true);
  });

  it('reads water levels without mixing in dry cliff heights', () => {
    const water = new Uint8Array(25), waterLevel = new Float32Array(25).fill(80);
    for (let y = 0; y < 5; y++) { water[y*5+2] = 3; waterLevel[y*5+2] = 2; }
    const level = bridgeWaterHeight({n:5,width:50,water,waterLevel}, x => x >= 20 && x <= 30);
    expect(level(20.01,25)).toBe(2);
    expect(Number.isNaN(level(19.99,25))).toBe(true);
  });

  it('joins unequal banks independently and keeps the deck and parapets continuous', () => {
    const bridges = city3dBridges([street([[0,0],[80,0]],6)], x => x >= 79 ? 8 : 0, () => 0);
    const deck = bridges[0].volumes.find(v => v.id.endsWith(':deck'))!;
    const vertices = deck.roof_mesh.vertices;
    const topAt = (x: number) => Math.max(...vertices.filter(p => Math.abs(p.x-x)<1e-6).map(p=>p.z));
    expect(topAt(0)).toBeCloseTo(0.12);
    expect(topAt(80)).toBeCloseTo(8.12);
    expect(topAt(40)).toBeCloseTo(5.12);
    for (const v of bridges[0].volumes.filter(v=>v.id.includes(':parapet:'))) {
      const top = (x: number) => Math.max(...v.roof_mesh.vertices.filter(p=>Math.abs(p.x-x)<1e-6).map(p=>p.z));
      expect(top(0)-topAt(0)).toBeCloseTo(1.05);
      expect(top(80)-topAt(80)).toBeCloseTo(1.05);
    }
    expect(city3dBridges([street([[-200,0],[200,0]],6)],()=>0,()=>NaN)).toEqual([]);
  });

  it('retires a regional deck only when its road was rejected by the town', () => {
    const old = street([[0,0],[100,0]]), far = street([[1000,0],[1100,0]]), city = layout([]);
    // Next to the town but on land the regional road still crosses: kept.
    city.quarters = [{phase:0,shape:{outer:[{x:0,y:10},{x:100,y:10},{x:100,y:100},{x:0,y:100}],holes:[]}}];
    expect(cityBridgeStreets([city],[old,far])).toEqual([old,far]);
    // Both banks in town land where no town street reaches it: an orphan deck.
    city.quarters = [{phase:0,shape:{outer:[{x:-500,y:-500},{x:500,y:-500},{x:500,y:500},{x:-500,y:500}],holes:[]}}];
    expect(cityBridgeStreets([city],[old,far])).toEqual([far]);
    // The town's streets meet both banks: the road still uses the deck.
    const served = layout([street([[-60,0],[-2,0]],5,'street'), street([[102,0],[160,0]],5,'street')]);
    served.quarters = city.quarters;
    expect(cityBridgeStreets([served],[old,far])).toEqual([...served.streets,old,far]);
  });

  it('shows the 2D regional roads and decks a town owns exactly as the 3D does', () => {
    // A town whose perpendicular deck replaced the diagonal regional crossing (same case as the 3D test above).
    const canonical = street([[0, 0], [100, 0]], 6), city = layout([canonical]);
    city.quarters = [{ phase: 0, shape: { outer: [{ x: -40, y: -60 }, { x: 140, y: -60 }, { x: 140, y: 60 }, { x: -40, y: 60 }], holes: [] } }] as never;
    const road = { path: [{ x: -300, y: -90 }, { x: 0, y: -30 }, { x: 100, y: 30 }, { x: 400, y: 90 }], width: 6, kind: 'major' };
    const regional = { a: { x: 0, y: -30 }, b: { x: 100, y: 30 }, width: 6 }, far = { a: { x: 500, y: 0 }, b: { x: 540, y: 0 }, width: 6 };
    const roads = [road], bridges = [regional, far], shown = cityRegionalNetwork(roads, bridges, [city]);
    // The deck the town replaced is gone from 2D, as from cityBridgeStreets in 3D; the far deck stays.
    expect(shown.bridges).toEqual([far]);
    expect(cityBridgeStreets([city], [street([[0, -30], [100, 30]], 6), street([[500, 0], [540, 0]], 6)]).filter(s => s !== canonical).map(s => s.path[0].x)).toEqual([500]);
    // The diagonal road stops at the town's ownership: no 2D segment runs through the town to the old deck.
    expect(shown.roads!.length).toBeGreaterThan(0);
    expect(shown.roads!.every(r => r.kind === 'major' && r.width === 6 && r.path.every(p => p.x <= -40 + 1e-6 || p.x >= 140 - 1e-6))).toBe(true);
    // Same inputs, same arrays: the scene cache sees no change.
    expect(cityRegionalNetwork(roads, bridges, [city])).toBe(shown);
  });

  it('opens a marine wall at the shore and keeps a river water gate as one span', () => {
    const enclosure = { path: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100},{x:0,y:0}],
      kind:'wall',style:'curtain',material:'stone',height_m:7,curtain_width_m:3,
      gates:[{x:20,y:0},{x:80,y:0}],gatehouses:[{gate:0,kind:'shore',passage:[{x:20,y:0},{x:80,y:0}],passage_width_m:60,height_m:7,masses:[],shape:{outer:[],holes:[]}}] } as Parameters<typeof wallDetail>[0];
    expect(wallDetail(enclosure)!.pieces.every(p => !p.water)).toBe(true);
    expect(city3dWalls([enclosure], () => 0).some(b => b.id.includes(':gate:'))).toBe(false);
    const river = { ...enclosure, gatehouses: enclosure.gatehouses!.map(g => ({ ...g, kind:'water' })) };
    expect(wallDetail(river)!.pieces.filter(p => p.water)).toHaveLength(1);
    expect(city3dWalls([river], () => 0).filter(b => b.variant_id.endsWith(':water'))).toHaveLength(1);
  });
});

describe('regional crossings snapped onto the drawn water', () => {
  // A 30 m river drawn along x = 500: banks at 485 and 515.
  const road = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 1000, y: 0 }];
  const river = (x: number): number => Math.abs(x - 500) - 15;
  const ends = (path: { x: number }[]): number[] => [path[0].x, path[path.length - 1].x];

  it('lengthens and recentres a short, offset raster span within a bounded probe budget', () => {
    let probes = 0;
    const snapped = snapCrossingToWater(road, { kind: 'bridge', path: [{ x: 470, y: 0 }, { x: 505, y: 0 }] }, x => { probes++; return river(x); }, 60)!;
    const [a, b] = ends(snapped.path);
    expect(a).toBeCloseTo(483, 0); expect(b).toBeCloseTo(517, 0);
    expect(snapped.kind).toBe('bridge');
    expect(probes).toBeLessThanOrEqual(40);
  });

  it('trims a span longer than the drawn water and keeps its direction', () => {
    const snapped = snapCrossingToWater(road, { kind: 'bridge', path: [{ x: 560, y: 0 }, { x: 420, y: 0 }] }, river, 60)!;
    const [a, b] = ends(snapped.path);
    expect(a).toBeCloseTo(517, 0); expect(b).toBeCloseTo(483, 0);
  });

  it('moves a span routed wholly beside a narrow drawn stream onto it', () => {
    const snapped = snapCrossingToWater(road, { kind: 'bridge', path: [{ x: 516, y: 0 }, { x: 524, y: 0 }] }, river, 40)!;
    const [a, b] = ends(snapped.path);
    expect(a).toBeCloseTo(483, 0); expect(b).toBeCloseTo(517, 0);
  });

  it('keeps the routed span when no drawn water lies near it', () => {
    const crossing = { kind: 'ford', path: [{ x: 100, y: 0 }, { x: 140, y: 0 }] };
    expect(snapCrossingToWater(road, crossing, river, 60)).toBe(crossing);
  });

  it('drops a bridge whose road crosses no drawn water, and never claims water further along the road', () => {
    expect(snapCrossingToWater(road, { kind: 'bridge', path: [{ x: 100, y: 0 }, { x: 140, y: 0 }] }, river, 60)).toBeUndefined();
    // Drawn water 25 m past the routed end, within the old reach: the road does not cross it at this span.
    expect(snapCrossingToWater(road, { kind: 'bridge', path: [{ x: 440, y: 0 }, { x: 460, y: 0 }] }, river, 60)).toBeUndefined();
    const dry = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
    expect(snapRoadCrossings([{ path: dry, crossings: [{ kind: 'bridge', path: [{ x: 100, y: 0 }, { x: 140, y: 0 }] }] }], river, 60)[0].crossings).toEqual([]);
  });

  it('decks drawn river water the router emitted no crossing for (a road slipping between raster cells)', () => {
    // Raw Rust segment without any crossing, or with its only bridge misplaced on dry ground: one deck over the water.
    for (const crossings of [[], [{ kind: 'bridge', path: [{ x: 100, y: 0 }, { x: 140, y: 0 }] }]]) {
      const [s] = snapRoadCrossings([{ path: road, class: 'main', crossings }], river, 60);
      expect(s.crossings).toHaveLength(1);
      expect(s.crossings[0].kind).toBe('bridge');
      const [a, b] = ends(s.crossings[0].path);
      expect(a).toBeCloseTo(483, 0); expect(b).toBeCloseTo(517, 0);
    }
    // A covered crossing is never doubled; a narrow stream under a track is a ford; a bank graze or a lake edge is no crossing.
    const routed = [{ kind: 'bridge', path: [{ x: 470, y: 0 }, { x: 505, y: 0 }] }];
    expect(snapRoadCrossings([{ path: road, crossings: routed }], river, 60)[0].crossings).toHaveLength(1);
    const stream = (x: number): number => Math.abs(x - 500) - 1.5;
    expect(snapRoadCrossings([{ path: road, class: 'track', crossings: [] as { kind?: string; path: { x: number; y: number }[] }[] }], stream, 60)[0].crossings.map(c => c.kind)).toEqual(['ford']);
    expect(snapRoadCrossings([{ path: road, crossings: [] }], x => Math.max(-0.3, Math.abs(x - 500) - 15), 60)[0].crossings).toEqual([]);
    expect(snapRoadCrossings([{ path: road, crossings: [] }], x => Math.abs(x - 500) <= 15 ? 0 : 64, 60)[0].crossings).toEqual([]);
  });

  it('keeps the deck on its own leg of a hairpin, along the road direction', () => {
    // East along y = 0, a U-turn, then west along y = 12 across the river.
    const hairpin = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 12 }, { x: 0, y: 12 }];
    const snapped = snapCrossingToWater(hairpin, { kind: 'bridge', path: [{ x: 520, y: 6.8 }, { x: 490, y: 5.5 }] }, river, 60)!; // routed ends between the legs
    expect(snapped.path.every(p => p.y === 12)).toBe(true);
    const [a, b] = ends(snapped.path);
    expect(a).toBeCloseTo(517, 0); expect(b).toBeCloseTo(483, 0);
  });

  it('extends a short span to a bank beyond the window instead of ending in the water', () => {
    const wide = (x: number): number => Math.abs(x - 500) - 60; // banks at 440 and 560
    const snapped = snapCrossingToWater(road, { kind: 'bridge', path: [{ x: 490, y: 0 }, { x: 510, y: 0 }] }, wide, 30)!;
    const [a, b] = ends(snapped.path);
    expect(a).toBeCloseTo(438, 0); expect(b).toBeCloseTo(562, 0);
  });
});
