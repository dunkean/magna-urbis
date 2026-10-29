/** Reproducible real-Canvas scale probe. Start Vite first, then:
 * npx tsx scripts/benchmark_building_lod.ts [base-url] [report-path]
 * Timings are observations, not hardware-independent test assertions. */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CompactBuildingVisual } from '../src/render/urbanBuildingLod';
import type { Point, Surface } from '../../rust/bridge/housesContract';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173';
const reportPath = resolve(process.argv[3] ?? '../web/out/work/CODEX_RENDER_BENCHMARK.json');
const fixture = JSON.parse(await readFile(new URL('../../rust/fixtures/houses/batch-reference.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({headless: true, channel: process.env.BUILDING_BENCH_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined)});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1});
  // tsx preserves function names with this helper when serializing evaluate().
  await page.addInitScript('globalThis.__name = (value) => value;');
  await page.route('**/building-lod-benchmark.html', route => route.fulfill({contentType: 'text/html', body: '<!DOCTYPE html><html><body style="margin:0;background:#f4efdf"><canvas id="canvas" width="1280" height="900"></canvas></body></html>'}));
  await page.goto(`${baseUrl}/building-lod-benchmark.html`);
  const report = await page.evaluate(async ({unit, modulePath}) => {
    const {UrbanBuildingLodRenderer} = await import(/* @vite-ignore */ modulePath) as typeof import('../src/render/urbanBuildingLod');
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const appearance = {style: 'cartographic', diagnostic: 'none'} as const;
    const translate = (surface: Surface, x: number, y: number): Surface => surface.map(p => ({
      outer: p.outer.map(p => ({x: p.x + x, y: p.y + y})), holes: p.holes.map(r => r.map(p => ({x: p.x + x, y: p.y + y}))),
    }));
    const sourceFootprint: Surface = unit.partition.occupied;
    const sourceRoof: Surface = unit.roofs.groups.flatMap((g: {domain: Surface}) => g.domain);
    const sourceLines: [Point, Point][] = unit.roofs.edges.filter((e: {kind: string}) => e.kind === 'ridge').map((e: {vertices: number[]}) => e.vertices.map(i => unit.roofs.vertices[i]));
    const materials = unit.bodies[0].levels[0].materials;
    const measurements: unknown[] = [];
    const median = (numbers: number[]): number => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
    for (const count of [1_000, 10_000, 100_000]) {
      const columns = Math.ceil(Math.sqrt(count));
      const buildings: CompactBuildingVisual[] = Array.from({length: count}, (_, i) => {
        const x = (i % columns) * 20, y = Math.floor(i / columns) * 20;
        return {id: `native-reference-${i}`, function: 'domestic', materials, footprint: translate(sourceFootprint, x, y), roof_footprint: translate(sourceRoof, x, y),
          cartographic: {height_m: 6.3, roof_system: 'RF-GABLE', ridges: sourceLines.map(([a, b]) => [{x: a.x + x, y: a.y + y}, {x: b.x + x, y: b.y + y}])}};
      });
      const start = performance.now(), renderer = new UrbanBuildingLodRenderer({buildings}, {sectorSizeM: 32});
      const indexMs = performance.now() - start;
      for (const view of ['neighborhood', 'whole-city'] as const) {
        renderer.clearCaches();
        const viewport = view === 'neighborhood' ? {minX: -1, minY: -1, maxX: 95, maxY: 95} : {minX: -1, minY: -1, maxX: columns * 20, maxY: Math.ceil(count / columns) * 20};
        const metresPerPixel = Math.max((viewport.maxX - viewport.minX) / 1280, (viewport.maxY - viewport.minY) / 900);
        const timings: number[] = [], populationTimings: number[] = [];
        let first!: ReturnType<typeof renderer.draw>, last!: ReturnType<typeof renderer.draw>;
        for (let frame = 0; frame < 120 && timings.length < 6; frame++) {
          const frameStart = performance.now();
          ctx.resetTransform(); ctx.clearRect(0, 0, 1280, 900);
          ctx.scale(1 / metresPerPixel, 1 / metresPerPixel); ctx.translate(-viewport.minX, -viewport.minY);
          last = renderer.draw(ctx, {viewport, metresPerPixel, appearance});
          ctx.resetTransform(); ctx.getImageData(0, 0, 1, 1); // Flush Canvas work, not only JS submission.
          const elapsed = performance.now() - frameStart;
          if (frame === 0) first = last;
          if (frame === 0 || last.rasterTilesPending > 0 || last.rasterTilesBuilt > 0) populationTimings.push(elapsed);
          else timings.push(elapsed);
        }
        if (last.rasterTilesPending > 0) throw new Error(`Raster cache did not converge for ${count} buildings`);
        measurements.push({count, view, indexMs, metresPerPixel, coldFrameMs: populationTimings[0], populationFrames: populationTimings.length,
          populationTotalMs: populationTimings.reduce((a, b) => a + b, 0), medianWarmFrameMs: median(timings), first, last});
      }
    }
    // Visual witness: outline / native ridge / native facet LOD, then a compact
    // courtyard with a line crossing its hole. The raster must keep that hole open.
    ctx.resetTransform(); ctx.fillStyle = '#f4efdf'; ctx.fillRect(0, 0, 1280, 900);
    ctx.fillStyle = '#393a31'; ctx.font = '20px sans-serif';
    ctx.fillText('Native architecture: silhouette / ridges / native facets; courtyard remains open', 24, 34);
    const base: CompactBuildingVisual = {
      id: 'native-reference', function: 'domestic', footprint: sourceFootprint, roof_footprint: sourceRoof, materials,
      volumes: [{z_m: 0, wall_height_m: 2.8, roof_height_m: 3.5, materials, roof_system: 'RF-GABLE', roof_mesh: unit.roofs}],
    };
    const native = new UrbanBuildingLodRenderer({buildings: [base]});
    const shape: Surface = [{outer: [{x: 0, y: 0}, {x: 12, y: 0}, {x: 12, y: 12}, {x: 0, y: 12}], holes: [[{x: 4, y: 4}, {x: 8, y: 4}, {x: 8, y: 8}, {x: 4, y: 8}]]}];
    const courtyard = new UrbanBuildingLodRenderer({buildings: [{id: 'compact-court', function: 'domestic', materials, footprint: shape, roof_footprint: shape, cartographic: {height_m: 5, ridges: [[{x: 0, y: 6}, {x: 12, y: 6}]]}}]});
    const panels = [{label: 'Silhouette (12 px)', mpp: 1, renderer: native}, {label: 'Ridges (35 px)', mpp: .3, renderer: native}, {label: 'Native facets (207 px)', mpp: .05, renderer: native}, {label: 'Compact courtyard (240 px)', mpp: .05, renderer: courtyard}];
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i], x = 25 + i * 315;
      ctx.resetTransform(); ctx.fillStyle = '#393a31'; ctx.font = '16px sans-serif'; ctx.fillText(panel.label, x, 90);
      ctx.translate(x + 20, 130); ctx.scale(1 / panel.mpp, 1 / panel.mpp);
      panel.renderer.draw(ctx, {viewport: {minX: -2, minY: -2, maxX: 15, maxY: 15}, metresPerPixel: panel.mpp, appearance, selectedId: i === 3 ? 'compact-court' : undefined});
    }
    ctx.resetTransform(); ctx.font = '16px sans-serif'; ctx.fillStyle = '#393a31';
    ctx.fillText('Raster overview · courtyard crosses tile boundaries', 24, 495);
    const tileShape: Surface = [{outer: [{x: 200, y: 200}, {x: 800, y: 200}, {x: 800, y: 800}, {x: 200, y: 800}],
      holes: [[{x: 400, y: 400}, {x: 600, y: 400}, {x: 600, y: 600}, {x: 400, y: 600}]]}];
    const tiledCourt = new UrbanBuildingLodRenderer({buildings: [{id: 'tile-court', function: 'domestic', footprint: tileShape, roof_footprint: tileShape, materials}]});
    const courtViewport = {minX: 200, minY: 200, maxX: 800, maxY: 800};
    ctx.translate(25, 530); ctx.scale(.5, .5); ctx.translate(-200, -200);
    let tileMetrics!: ReturnType<typeof tiledCourt.draw>;
    for (let i = 0; i < 8; i++) {
      tileMetrics = tiledCourt.draw(ctx, {viewport: courtViewport, metresPerPixel: 2, appearance});
      if (!tileMetrics.rasterTilesPending) break;
    }
    tileMetrics = tiledCourt.draw(ctx, {viewport: courtViewport, metresPerPixel: 2, appearance});
    ctx.resetTransform();
    const pixel = (x: number, y: number): string => [...ctx.getImageData(x, y, 1, 1).data].join(',');
    const courtPixel = pixel(175, 680), roofPixel = pixel(50, 555), seamPixels = [pixel(180, 555), pixel(181, 555), pixel(182, 555)];
    if (courtPixel !== '244,239,223,255' || roofPixel === courtPixel || new Set(seamPixels).size !== 1 || tileMetrics.preparedVertices !== 0 || tileMetrics.rasterTilesPending !== 0) throw new Error('Raster courtyard/seam validation failed');
    ctx.fillStyle = '#393a31'; ctx.font = '16px sans-serif';
    ctx.fillText('Pixel checks: transparent courtyard, continuous roof across tiles.', 365, 565);
    ctx.fillText('Warm raster: zero building queries, zero prepared vertices.', 365, 595);
    return {date: new Date().toISOString(), userAgent: navigator.userAgent, viewport: {width: 1280, height: 900, dpr: 1},
      fixture: 'rust/fixtures/houses/batch-reference.json · EUR-MED-B01 (native footprint/roof domain/ridge repeated)',
      caveat: 'Compact plan geometry repeated, not 100k detailed native meshes. Frame time includes a synchronous Canvas readback. Overview tiles populate progressively; cold/population and warm measurements are separate.',
      rasterQa: {courtPixel, roofPixel, seamPixels, warmMetrics: tileMetrics}, measurements};
  }, {unit: fixture.units[0], modulePath: `/@fs/${resolve('src/render/urbanBuildingLod.ts').replaceAll('\\', '/')}`});
  await mkdir(dirname(reportPath), {recursive: true});
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await page.screenshot({path: reportPath.replace(/\.json$/i, '.png')});
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
