/** The town's look (src/render/city/look.ts) is the one description both town renderers draw from: for the same block,
 * parcel, street and building, at every level of detail, the Canvas town (drawCity) paints the look's operations and
 * the GPU town's tables (cityGlStyle, live town) hold their flat equivalent. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Layout, Partition } from '../../rust/bridge/urban';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { buildCityBuildings, buildCityScene, drawCity, type CityBuildings, type CityDrawOptions, type CityLod, type CityPalette } from '../src/render/cityCanvas';
import { cityGlPlanMesh } from '../src/render/cityGl';
import { DEFAULT_LAYERS, buildingColors, planColors, streetColors, type CityGlLiveLook } from '../src/render/cityGlStyle';
import {
  CITY_LOD_LIMITS,
  FAR_TOWN_FADE,
  PARCHMENT_HATCH,
  TURF_LOOK,
  turfCover,
  turfFarTone,
  turfRoof,
  blockOps,
  buildingBody,
  buildingsShown,
  farTownAlpha,
  flatFill,
  footprintOps,
  outlineOf,
  parcelOps,
  parcelsShown,
  planFrame,
  rgb,
  roofFrame,
  roofPanPaint,
  selectCityLod,
  streetBase,
  streetFrame,
  streetLook,
  streetMinPx,
  streetShown,
  townRestGaps,
  wallLook,
  RIM_DEVICE_MPP,
  type RestState,
} from '../src/render/city/look';
import { mockCanvas } from '../scripts/fakeworld';
import { city3dScene } from '../src/render/city3dMeshes';
import { colourDistance } from '../src/render/roofContrast';
import { BUILDING_STRIDE, buildingBatches } from '../src/render/world/buildingsMesh';

const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const layout = {
  key: 'k',
  quarters: [{ shape: { outer: ring(1000, 1000, 100, 100), holes: [] }, phase: 0 }],
  blocks: [
    { shape: { outer: ring(1000, 1000, 100, 100), holes: [] }, kind: 'urban', quarter: 0, axis: { x: 1, y: 0 } },
    { shape: { outer: ring(1100, 1000, 40, 40), holes: [] }, kind: 'place', quarter: 0, axis: { x: 1, y: 0 } },
  ],
  streets: [
    {
      path: [
        { x: 990, y: 990 },
        { x: 1110, y: 990 },
      ],
      widths: [6],
      rank: 0,
      role: 'main',
    },
    {
      path: [
        { x: 1000, y: 1050 },
        { x: 1100, y: 1050 },
      ],
      widths: [3],
      rank: 3,
      role: 'lane',
    },
  ],
  enclosures: [],
  phases: [],
} as unknown as Layout;
const partition = {
  key: 'k',
  parcels: [
    { id: 'p-plot', shape: { outer: ring(1000, 1000, 50, 50), holes: [] }, use: 'plot', block: 0, axis: { x: 1, y: 0 } },
    { id: 'p-garden', shape: { outer: ring(1050, 1000, 50, 50), holes: [] }, use: 'garden', block: 0, axis: { x: 1, y: 0 } },
  ],
} as unknown as Partition;
const scene = buildCityScene([layout], [partition]);
const batch = { buildings: [{ id: 'b1', parcel_id: 'p-plot', function: 'domestic', footprint: [{ outer: ring(1002, 1002, 12, 8), holes: [] }], roof_footprint: [] }], refusals: [], open_spaces: [] } as unknown as PlacementBatch;
const plain = buildCityBuildings(batch, scene);
/** The same building with two hand-made roof pans (a lit and a shaded one). */
const roofed: CityBuildings = {
  ...plain,
  roofs: {
    shapes: [
      { outer: ring(1002, 1002, 12, 4), holes: [] },
      { outer: ring(1002, 1006, 12, 4), holes: [] },
    ],
    owner: Uint32Array.from([0, 0]),
    light: Float32Array.from([0.2, -0.2]),
    cover: ['tile', 'tile'],
    wall: ['stone', 'stone'],
    tone: Float32Array.from([0.5, 0.5]),
    dir: Float32Array.from([0, Math.PI]),
    shadows: [[]],
  },
};
const LODS: readonly CityLod[] = ['far', 'mid', 'near', 'close'];
const live: CityGlLiveLook = { roadLook: 'ink', emphasis: 1, lineWidth: 0.6 };
const hex = (v: number): string => '#' + v.toString(16).padStart(6, '0');
/** A table entry as [colour, alpha byte]. */
const entry = (table: Uint8Array, i: number): [string, number] => [hex((table[i * 4] << 16) | (table[i * 4 + 1] << 8) | table[i * 4 + 2]), table[i * 4 + 3]];
const flat = (color: string, alpha = 1): [string, number] => [hex(rgb(color)), Math.round(alpha * 255)];

class Path {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  arc(): void {}
  rect(): void {}
  addPath(): void {}
}
beforeAll(() => {
  vi.stubGlobal('Path2D', Path);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
/** What the Canvas town fills for a frame: every (style, alpha) of its fill calls. */
function canvasFills(palette: CityPalette, lod: CityLod, buildings?: CityBuildings): Set<string> {
  const { canvas, log } = mockCanvas(400, 400),
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const options: CityDrawOptions = {
    viewport: { minX: 900, minY: 900, maxX: 1300, maxY: 1300 },
    mpp: 1,
    dpr: 1,
    lod,
    view: 'buildings',
    palette,
    width: 0.6,
    layers: DEFAULT_LAYERS,
    buildings,
    buildingsVisible: !!buildings,
    appearance: { style: 'cartographic', diagnostic: 'none' },
    labels: false,
    roadLook: 'ink',
    groundBlend: false,
  };
  drawCity(ctx, scene, options);
  return new Set(log.fills.map(f => `${String(f.style)}@${f.alpha}`));
}

describe('town look: one description for both renderers', () => {
  it('folds the plan operations of a block, a parcel and the footprint into the GPU tables at every level of detail', () => {
    const mesh = cityGlPlanMesh(scene);
    for (const palette of ['parchment', 'growth', 'atlas', 'ink'] as const)
      for (const lod of LODS) {
        const state = { view: 'buildings' as const, lod, palette, layers: DEFAULT_LAYERS, buildingsVisible: true, diagnostic: 'none', blended: false, live };
        const plan = planFrame({ view: 'buildings', lod, palette, layers: DEFAULT_LAYERS, width: 0.6, groundBlend: false, roadLook: 'ink' }),
          tables = planColors(scene, mesh, state);
        const check = (feature: number, ops: ReturnType<typeof footprintOps> | undefined, shown: boolean): void => {
          const fill = shown && ops ? flatFill(ops) : undefined,
            edge = shown && ops ? outlineOf(ops) : undefined,
            hatch = shown && ops && palette === 'parchment' ? ops.find(op => op.hatch) : undefined;
          expect(entry(tables.fill, feature), `${palette} ${lod} fill`).toEqual(fill ? [hex((Math.round(fill.r) << 16) | (Math.round(fill.g) << 8) | Math.round(fill.b)), Math.round(fill.alpha * 255)] : [expect.any(String), 0]);
          expect(entry(tables.line, feature)[1], `${palette} ${lod} line`).toBe(edge ? Math.round((edge.alpha ?? 1) * 255) : 0);
          if (edge) expect(entry(tables.line, feature)[0]).toBe(hex(rgb(edge.stroke!)));
          expect(tables.hatch ? tables.hatch[feature * 4 + 3] : 0, `${palette} ${lod} hatch`).toBe(hatch ? Math.round((hatch.alpha ?? 1) * 255) : 0);
        };
        check(mesh.layers.footprint.features[0], footprintOps(plan, scene.footprint[0]), lod === 'far');
        scene.blocks.forEach((b, i) => check(mesh.layers.blocks.features[0] + i, blockOps(plan, b, undefined), lod !== 'far'));
        scene.parcels.forEach((p, i) => check(mesh.layers.parcels.features[0] + i, parcelOps(plan, p, undefined), lod !== 'far' && parcelsShown(plan)));
      }
    expect(PARCHMENT_HATCH).toMatchObject({ periodPx: 7, widthPx: 0.8, alpha: 0.42 });
  });

  it('paints the same plan fills on Canvas as the look gives the GPU tables', () => {
    for (const palette of ['growth', 'atlas'] as const)
      for (const lod of LODS) {
        const fills = canvasFills(palette, lod),
          plan = planFrame({ view: 'buildings', lod, palette, layers: DEFAULT_LAYERS, width: 0.6, groundBlend: false, roadLook: 'ink' });
        const all = lod === 'far' ? [footprintOps(plan, scene.footprint[0])] : [...scene.blocks.map(b => blockOps(plan, b, undefined) ?? []), ...(parcelsShown(plan) ? scene.parcels.map(p => parcelOps(plan, p, undefined) ?? []) : [])];
        for (const ops of all) for (const op of ops) if (op.fill) expect(fills.has(`${op.fill}@${op.alpha ?? 1}`), `${palette} ${lod} ${op.fill}`).toBe(true);
      }
  });

  it('gives both renderers the same street bed, casing, shown ranks and minimum widths', () => {
    for (const palette of ['parchment', 'growth'] as const) {
      const tables = streetColors(scene, palette, false, undefined, live);
      scene.streets.forEach((s, i) => {
        // The GPU street tables are built once, at one pixel per metre, without the surface.
        const base = streetBase(streetLook(streetFrame({ lod: 'near', palette, mpp: 1, layers: { roadSurface: false }, roadLook: 'ink', roadEmphasis: 1, groundBlend: false }), s));
        expect(entry(tables.inner, i)).toEqual(flat(base.fill!.paint as string, base.fill!.alpha));
        expect(entry(tables.outer, i)).toEqual(flat(base.casing!.paint as string, base.casing!.alpha));
      });
    }
    // The Canvas town fills the street surfaces (near, close) with the same bed and casing.
    for (const lod of ['near', 'close'] as const) {
      const fills = canvasFills('growth', lod),
        frame = streetFrame({ lod, palette: 'growth', mpp: 1, layers: DEFAULT_LAYERS, roadLook: 'ink', roadEmphasis: 1, groundBlend: false });
      for (const s of scene.streets) {
        const surface = streetLook(frame, s).surface!;
        expect(fills.has(`${surface.fill.paint as string}@${surface.fill.alpha}`)).toBe(true);
        expect(fills.has(`${surface.casing!.paint as string}@${surface.casing!.alpha}`)).toBe(true);
      }
    }
    const [main, lane] = scene.streets;
    expect(LODS.map(lod => streetShown(main, lod))).toEqual([true, true, true, true]);
    expect(LODS.map(lod => streetShown(lane, lod))).toEqual([false, false, true, true]);
    expect([0, 1, 2, 3, 4].map(rank => streetMinPx('street', rank))).toEqual([3, 2.4, 1.7, 1.2, 0.9]);
    expect(wallLook('stone', 'parchment', 'far', 4).thick).toBeCloseTo(1.6 * 4);
  });

  it('gives both renderers the same building body and roof pans', () => {
    for (const palette of ['parchment', 'growth', 'terrain'] as const) {
      const state = { view: 'buildings' as const, lod: 'near' as const, palette, layers: DEFAULT_LAYERS, buildingsVisible: true, diagnostic: 'none', live };
      const tables = buildingColors(roofed, state),
        item = roofed.items[0],
        body = buildingBody({ view: 'buildings', palette, footprint: false, diagnostic: 'none' }, item, true);
      expect(entry(tables.fill, 0)).toEqual(flat(body.fill));
      expect(entry(tables.line, 0)).toEqual(flat(body.stroke));
      const f = roofFrame({ palette, mpp: 1, dpr: 1, diagnostic: 'none' }),
        fills = palette === 'terrain' ? undefined : canvasFills(palette === 'parchment' ? 'growth' : palette, 'near', roofed);
      for (const k of [0, 1]) {
        const pan = roofPanPaint(f, item, roofed.roofs!, k, 0);
        expect(entry(tables.fill, 1 + k)).toEqual(flat(pan.color));
        expect(entry(tables.line, 1 + k)).toEqual(flat(f.edge.color, f.edge.alpha));
        if (fills && palette === 'growth') expect(fills.has(`${pan.color}@1`)).toBe(true);
      }
      if (fills && palette === 'growth') expect(fills.has(`${body.fill}@1`)).toBe(true);
    }
    // Pans and shadows hide outside the buildings view, as the Canvas town draws none there.
    const roles = buildingColors(roofed, { view: 'roles', lod: 'near', palette: 'growth', layers: DEFAULT_LAYERS, buildingsVisible: true, diagnostic: 'none', live });
    expect(roles.fill[1 * 4 + 3]).toBe(0);
  });

  it('keeps the levels of detail, the far fade and the rest coverage in one place', () => {
    expect(CITY_LOD_LIMITS).toEqual([0.55, 2.2, 9]);
    expect([0.4, 1.2, 4, 16].map(mpp => selectCityLod(mpp))).toEqual(['close', 'near', 'mid', 'far']);
    expect(selectCityLod(2.4, 'near')).toBe('near'); // hysteresis
    expect(farTownAlpha(FAR_TOWN_FADE[0])).toBe(0);
    expect(farTownAlpha(FAR_TOWN_FADE[1])).toBe(1);
    // On satellite grounds the scale, not the level, decides whether the buildings show under the far raster.
    const shown = { view: 'buildings' as const, footprint: false, diagnostic: 'none', buildingsVisible: true, farTown: true };
    expect(buildingsShown({ ...shown, lod: 'near', mpp: 2.4 })).toBe(false);
    expect(buildingsShown({ ...shown, lod: 'mid', mpp: 2.0 })).toBe(true);
    const content = { waterways: false, streetRoles: new Set<string>(), enclosures: false, canopy: false, sites: false, housePlans: false, millMarks: false, reserves: false };
    const rest: RestState = {
      palette: 'parchment',
      view: 'buildings',
      lod: 'mid',
      mpp: 4,
      dpr: 1,
      streets: 'ink',
      streetsShown: true,
      blend: false,
      textured: false,
      emphasis: 1,
      snow: 0,
      lineWidthPx: 0.6,
      buildings: false,
      farRaster: false,
      canopyClearing: false,
      urbanLanduse: false,
      diagnostics: false,
      overPass: false,
      content,
    };
    expect(townRestGaps(rest)).toEqual([]);
    // Strict: anything the Canvas town paints differently keeps its repaint.
    expect(townRestGaps({ ...rest, content: { ...content, waterways: true } })).toContain('canals at full strength over the town');
    expect(townRestGaps({ ...rest, dpr: 2 })).toContain('outlines wider than a device pixel');
    expect(townRestGaps({ ...rest, urbanLanduse: true })).toContain('urban land-use tint');
    // Natural ground: the roof grain marks are drawn; the road paint and the snow mantle's marks are not.
    const natural = { ...rest, palette: 'terrain' as const, streets: 'natural' as const, lod: 'near' as const, mpp: 1.2, buildings: true };
    expect(townRestGaps(natural)).toEqual(['ground-textured road paint, wear, grain, cobbles, kerbs and sidewalks', 'street surface junctions and ends']);
    expect(townRestGaps({ ...natural, snow: 0.5 })).toContain('uneven snow marks');
  });
});

describe('roofs in volume', () => {
  it('paints the tilted view’s roof faces with the colours of the top view’s pans', () => {
    const footprint = [{ outer: ring(2000, 2000, 12, 6), holes: [] }],
      massing = [{ floors: 2, eave_m: 6, rise_m: 3, roof: 'hip', ridges: [[2003, 2003, 2009, 2003]], cover: 'slate', wall: 'brick', tone: 0.37 }];
    const source = {
      buildings: [{ id: 'h1', parcel_id: 'h1', function: 'domestic', recipe_id: 'silhouette', variant_id: 'silhouette', culture: { culture: 'x' }, ground_z_m: 0, footprint, roof_footprint: footprint, programme: { role: 'dwelling.house', massing } }],
      refusals: [],
      open_spaces: [],
    } as unknown as PlacementBatch;
    const town = buildCityBuildings(source, undefined),
      item = town.items[0],
      roofs = town.roofs!,
      volumes = city3dScene(source);
    for (const palette of ['terrain', 'parchment'] as const) {
      const frame = roofFrame({ palette, mpp: 2 * RIM_DEVICE_MPP, dpr: 1, diagnostic: 'none' }),
        paint = { appearance: { style: 'cartographic' as const, diagnostic: 'none' as const }, materials: volumes.materials ?? [], snowAltitudes: { get: () => undefined }, look: { frame, item: (id: string) => (id === item.id ? item : undefined) } };
      const painted = new Set<string>();
      for (const batch of buildingBatches(volumes.buildings, [2000, 2000], paint, false))
        for (let i = 0; i < batch.data.length; i += BUILDING_STRIDE) {
          // Faces painted by the town look carry a grain gain on the normal's length (code >= 64).
          if (Math.round((Math.hypot(batch.data[i + 3], batch.data[i + 4], batch.data[i + 5]) - 1) * 32) >= 64) painted.add(hex((Math.round(batch.data[i + 6] * 255) << 16) | (Math.round(batch.data[i + 7] * 255) << 8) | Math.round(batch.data[i + 8] * 255)));
        }
      const pans = new Set<string>();
      for (let k = 0; k < roofs.shapes.length; k++) if (!roofs.patch?.[k]) pans.add(hex(rgb(roofPanPaint(frame, item, roofs, k, 0).color)));
      expect(painted.size).toBeGreaterThan(1);
      expect([...painted].sort()).toEqual([...pans].sort());
    }
  });
});

describe('turf roofs', () => {
  it('stand apart from a meadow: mown and wider contrast close, an earth bank far', () => {
    const grass = [84 / 255, 118 / 255, 54 / 255],
      turf = [0.45, 0.5, 0.3] as [number, number, number];
    expect(colourDistance(turfRoof(turf, grass), grass)).toBeGreaterThanOrEqual(TURF_LOOK.contrast - 0.005);
    expect(turfCover('turf', 'earth') && !turfCover('turf', 'wood') && !turfCover('thatch', 'earth')).toBe(true);
    const far = turfFarTone([90, 110, 60]);
    expect(far[0] - far[1]).toBeGreaterThan(90 - 110);
    expect(far[0] + far[1] + far[2]).toBeLessThan(260);
  });
});
