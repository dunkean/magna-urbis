/** Small native compact-plan visual witness. Owns an ephemeral native process.
 * From web/: npx tsx scripts/native_building_gallery.ts [native-exe] [Vite-base-url] [output-dir]
 * No detailed realization, city generation or performance stress test. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { BuildingStyleEntry, BuildingStyleIndex } from '../../rust/bridge/buildingStyles';
import type { PlacementBatch, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { HouseConfig, HouseOverrides, Surface } from '../../rust/bridge/housesContract';

const executable = resolve(process.argv[2] ?? '../rust/target/debug/magna-urbis-local.exe');
const vite = process.argv[3] ?? 'http://127.0.0.1:5173';
const output = resolve(process.argv[4] ?? '../web/out/work/native-building-gallery');
await mkdir(output, {recursive: true});
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const address = socket.address(); assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const child = spawn(executable, ['--port', String(port)], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
let log = '';
const ready = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Native startup timeout: ${log}`)), 30_000);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {clearTimeout(timer); reject(new Error(`Native exited ${code}: ${log}`));});
  child.stdout.on('data', bytes => {log += String(bytes); if (log.includes('"ready":true')) {clearTimeout(timer); resolve();}});
  child.stderr.on('data', bytes => {log += String(bytes);});
});
async function post<T>(path: string, input: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input)});
  const result = await response.json();
  assert(response.ok && result.ok, `${path}: ${JSON.stringify(result.error ?? result)}`);
  return result.data as T;
}
const rectangle = (width: number, depth: number): Surface => [{outer: [{x: 0, y: 0}, {x: width, y: 0}, {x: width, y: depth}, {x: 0, y: depth}], holes: []}];
function bounds(surface: Surface): {minX: number; minY: number; maxX: number; maxY: number} {
  const points = surface.flatMap(p => p.outer);
  return {minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y))};
}
function area(surface: Surface): number {
  const ring = (r: Surface[number]['outer']) => Math.abs(r.reduce((sum, a, i) => {const b = r[(i + 1) % r.length]; return sum + a.x * b.y - a.y * b.x;}, 0)) / 2;
  return surface.reduce((sum, p) => sum + ring(p.outer) - p.holes.reduce((sum, h) => sum + ring(h), 0), 0);
}
function signature(building: PlacedBuilding): string {
  const box = bounds(building.footprint);
  return JSON.stringify([area(building.footprint), box.maxX - box.minX, box.maxY - box.minY,
    ...building.volumes.map(v => area(v.footprint)).sort((a, b) => a - b)].map(n => Math.round(n * 1e5)));
}
interface Case {
  family: string; label: string; space: 'roomy' | 'narrow'; width: number; depth: number;
  style?: BuildingStyleEntry; scene?: PlacementBatch; unavailable?: string;
  attempts?: {width: number; depth: number; accepted: boolean; refusal?: string}[];
}
type GalleryRequest = Omit<PlacementRequest, 'config'> & {config: Omit<Partial<HouseConfig>, 'overrides'> & {overrides: Partial<HouseOverrides>}};
function request(style: BuildingStyleEntry, width: number, depth: number, space: string): GalleryRequest {
  const surface = rectangle(width, depth);
  return {id: `${style.id}/${space}`, parcel_id: `${style.id}/${space}/parcel`, seed: `native-gallery:${style.id}`,
    cadastral: surface, buildable: surface, reserves: [], roof_domain: surface,
    accesses: [{id: 'frontage', segment: [{x: 0, y: depth}, {x: width, y: depth}], kind: 'public', width_m: 2}],
    party_boundaries: [], neighbors: [], function: 'domestic',
    culture: {culture: 'european-organic', pack: style.pack_id, mode: 'historical_inspired', borrowing: null},
    terrain: {origin: {x: 0, y: 0}, ground_z_m: 10, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1},
    parcel_fit: true, config: {recipe: style.recipe_id, variation: 0, overrides: {variant: style.variant_id}},
  };
}

try {
  await ready;
  const index = await post<BuildingStyleIndex>('/houses/style-index', {});
  const selections = [
    {family: 'rectangle', label: 'Maison rectangulaire', id: 'EUR-MED-B01::default'},
    {family: 'L', label: 'Famille L', id: ''},
    {family: 'U', label: 'Cour ouverte en U', id: 'EUR-MED-B06::default'},
    {family: 'courtyard', label: 'Cour fermée', id: 'EUR-MED-B06::quadrangle'},
    {family: 'tower', label: 'Maison et tour', id: 'EUR-MED-B07::default'},
  ];
  const cases: Case[] = [];
  for (const selection of selections) {
    const style = selection.id ? index.entries.find(e => e.id === selection.id) : index.entries.find(e => e.footprint_family === 'FP-L');
    if (!style) {
      assert(selection.family === 'L', `Missing native source bundle ${selection.id}`);
      for (const space of ['roomy', 'narrow'] as const) cases.push({...selection, space, width: 0, depth: 0,
        unavailable: 'Aucun bundle du catalogue ne déclare FP-L. Pas de forme ni attribution inventée.'});
      continue;
    }
    const width = Math.max(32, style.constraints.nominal_width_m[1] * 1.8 + 8);
    const depth = Math.max(38, style.constraints.nominal_depth_m[1] * 1.8 + 8);
    const spacious = await post<PlacementBatch>('/houses/plans', {schema_version: '1', requests: [request(style, width, depth, 'roomy')]});
    assert.equal(spacious.buildings.length, 1, `${style.id} roomy: ${JSON.stringify(spacious.refusals)}`);
    cases.push({...selection, style, space: 'roomy', width, depth, scene: spacious});
    const original = spacious.buildings[0], extent = bounds(original.roof_footprint);
    const originalWidth = extent.maxX - extent.minX, originalDepth = extent.maxY - extent.minY;
    const attempts: NonNullable<Case['attempts']> = [];
    let narrow: PlacementBatch | undefined, narrowWidth = 0, narrowDepth = 0;
    for (const factor of [.82, .92, .98]) {
      narrowWidth = Math.round(originalWidth * factor * 100) / 100;
      narrowDepth = Math.round(Math.max(originalDepth * 1.1 + 2, style.constraints.nominal_depth_m[0] + 3) * 100) / 100;
      narrow = await post<PlacementBatch>('/houses/plans', {schema_version: '1', requests: [request(style, narrowWidth, narrowDepth, 'narrow')]});
      attempts.push({width: narrowWidth, depth: narrowDepth, accepted: !!narrow.buildings.length, refusal: narrow.refusals[0]?.message});
      if (narrow.buildings.length) break;
    }
    cases.push({...selection, style, space: 'narrow', width: narrowWidth, depth: narrowDepth, scene: narrow, attempts});
  }
  const changedPairs = selections.filter(s => {
    const pair = cases.filter(c => c.family === s.family).map(c => c.scene?.buildings[0]);
    return pair[0] && pair[1] && signature(pair[0]) !== signature(pair[1]);
  }).map(s => s.family);
  assert(changedPairs.length > 0, 'No accepted narrow/roomy pair changes actual geometry.');
  for (const entry of cases) for (const building of entry.scene?.buildings ?? []) {
    assert.equal(building.recipe_id, entry.style!.recipe_id);
    assert.equal(building.variant_id, entry.style!.variant_id);
    assert.equal(building.simplification, 'architectural_plan');
    assert(building.volumes.length > 0 && building.volumes.every(v => v.roof_mesh.vertices.length === 0), 'Gallery must use real mesh-free native plans.');
  }
  await writeFile(resolve(output, 'native-cases.json'), JSON.stringify(cases, null, 2));

  const browser = await chromium.launch({headless: true, channel: process.env.BUILDING_BENCH_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined)});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1570}, deviceScaleFactor: 1});
    await page.addInitScript('globalThis.__name = (value) => value;');
    await page.route('**/native-building-gallery.html', route => route.fulfill({contentType: 'text/html', body: '<!DOCTYPE html><html><body style="margin:0;background:#eeeadf"><canvas width="1440" height="1570"></canvas></body></html>'}));
    await page.goto(`${vite}/native-building-gallery.html`);
    const visual = await page.evaluate(async ({cases, modulePath}) => {
      const {UrbanBuildingLodRenderer, buildingSurfaceContains} = await import(/* @vite-ignore */ modulePath) as typeof import('../src/render/urbanBuildingLod');
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d', {willReadFrequently: true})!;
      const background = '#faf8f1';
      ctx.fillStyle = '#eeeadf'; ctx.fillRect(0, 0, 1440, 1570);
      ctx.fillStyle = '#2e352c'; ctx.font = 'bold 25px sans-serif'; ctx.fillText('Plans architecturaux natifs · même style et même graine, emprises différentes', 24, 38);
      ctx.font = '15px sans-serif'; ctx.fillText('Gauche : terrain spacieux. Droite : terrain étroit. Même échelle par paire. Aucun maillage de toiture généré.', 24, 66);
      const checks: {id: string; bodyWitnesses: number; holesChecked: number; courtWitnesses: number; drawn: number}[] = [];
      const refusalNotes: string[] = [];
      const interior = (surface: Surface, avoid?: Surface): {x: number; y: number} | undefined => {
        const points = surface.flatMap(p => p.outer), x0 = Math.min(...points.map(p => p.x)), x1 = Math.max(...points.map(p => p.x));
        const y0 = Math.min(...points.map(p => p.y)), y1 = Math.max(...points.map(p => p.y));
        // Interior sample, avoiding rasterized boundaries in narrow/concave ranges.
        const step = Math.min(x1 - x0, y1 - y0) / 50;
        const samples = Array.from({length: 19}, (_, i) => i + 1).sort((a, b) => Math.abs(a - 10) - Math.abs(b - 10));
        for (const j of samples) for (const i of samples) {
          const p = {x: x0 + (x1 - x0) * i / 20, y: y0 + (y1 - y0) * j / 20};
          if ([p, {x: p.x - step, y: p.y}, {x: p.x + step, y: p.y}, {x: p.x, y: p.y - step}, {x: p.x, y: p.y + step}].every(p => buildingSurfaceContains(surface, p) && (!avoid || !buildingSurfaceContains(avoid, p)))) return p;
        }
        return undefined;
      };
      for (let row = 0; row < 5; row++) {
        const pair = cases.slice(row * 2, row * 2 + 2);
        const mpp = Math.max(...pair.map(c => c.width / 520), ...pair.map(c => c.depth / 210), .03);
        for (let column = 0; column < 2; column++) {
          const entry = pair[column], left = 24 + column * 708, top = 95 + row * 290;
          ctx.resetTransform(); ctx.fillStyle = background; ctx.fillRect(left, top, 684, 272);
          ctx.fillStyle = '#2e352c'; ctx.font = 'bold 18px sans-serif';
          ctx.fillText(`${entry.label} · ${entry.space === 'roomy' ? 'spacieux' : 'étroit'}`, left + 14, top + 25);
          ctx.font = '13px sans-serif';
          if (entry.unavailable) {
            ctx.fillStyle = '#8a5d43'; ctx.fillText('Aucun FP-L déclaré dans les 415 bundles indexés.', left + 14, top + 70);
            ctx.fillText('Les compositions maison + tour restent montrées sous leur vrai nom.', left + 14, top + 94);
            continue;
          }
          const building = entry.scene?.buildings[0];
          ctx.fillText(`${entry.style!.id} · emprise ${entry.width.toFixed(1)} × ${entry.depth.toFixed(1)} m`, left + 14, top + 46);
          if (!building) {
            const message = entry.scene?.refusals[0]?.message ?? 'Refus natif'; refusalNotes.push(`${entry.style!.id}: ${message}`);
            ctx.fillStyle = '#a54839'; ctx.fillText('Refus explicite : aucun plan admissible dans cette emprise.', left + 14, top + 90); continue;
          }
          const originX = left + 32, originY = top + 58;
          ctx.translate(originX, originY); ctx.scale(1 / mpp, 1 / mpp);
          ctx.strokeStyle = '#b4aa92'; ctx.lineWidth = mpp; ctx.setLineDash([3 * mpp, 3 * mpp]);
          ctx.strokeRect(0, 0, entry.width, entry.depth); ctx.setLineDash([]);
          const renderer = new UrbanBuildingLodRenderer(entry.scene!, {raster: false});
          const metrics = renderer.draw(ctx, {viewport: {minX: 0, minY: 0, maxX: entry.width, maxY: entry.depth}, metresPerPixel: mpp, appearance: {style: 'cartographic', diagnostic: 'none'}});
          if (metrics.visibleBuildings !== 1 || metrics.drawCalls < 1) throw new Error(`Native plan invisible: ${building.id}`);
          ctx.resetTransform();
          const pixel = (p: {x: number; y: number}) => [...ctx.getImageData(Math.round(originX + p.x / mpp), Math.round(originY + p.y / mpp), 1, 1).data].join(',');
          let bodyWitnesses = 0, holesChecked = 0, courtWitnesses = 0;
          for (const volume of building.volumes) {
            const witness = interior(volume.footprint);
            if (witness && buildingSurfaceContains(building.roof_footprint, witness)) {
              if (pixel(witness) === '250,248,241,255') throw new Error(`Native body blank: ${building.id}/${volume.id}`);
              bodyWitnesses++;
            }
          }
          for (const polygon of building.roof_footprint) for (const hole of polygon.holes) {
            const witness = interior([{outer: hole, holes: []}]);
            if (!witness || buildingSurfaceContains(building.roof_footprint, witness)) continue;
            if (renderer.pick(witness) || pixel(witness) !== '250,248,241,255') throw new Error(`Native court filled or pickable: ${building.id}`);
            holesChecked++;
          }
          for (const court of building.courtyards) {
            const witness = interior([court], building.roof_footprint);
            if (!witness) throw new Error(`Native semantic courtyard has no uncovered sample: ${building.id}`);
            if (renderer.pick(witness) || pixel(witness) !== '250,248,241,255') throw new Error(`Native semantic courtyard filled or pickable: ${building.id}`);
            courtWitnesses++;
          }
          checks.push({id: building.id, bodyWitnesses, holesChecked, courtWitnesses, drawn: metrics.visibleBuildings});
          ctx.fillStyle = '#58604e'; ctx.font = '12px sans-serif';
          ctx.fillText(`${building.volumes.length} corps · ${courtWitnesses} cour(s) libre(s) vérifiée(s) · ${building.cartographic?.ridges.length ?? 0} segments de faîtage natifs`, left + 14, top + 258);
        }
      }
      return {checks, refusalNotes, courtyardsChecked: checks.reduce((sum, check) => sum + check.holesChecked + check.courtWitnesses, 0)};
    }, {cases, modulePath: `/@fs/${resolve('src/render/urbanBuildingLod.ts').replaceAll('\\', '/')}`});
    assert(visual.courtyardsChecked > 0, 'Gallery has no verified visible courtyard.');
    await page.screenshot({path: resolve(output, 'gallery.png')});
    const report = {date: new Date().toISOString(), backend: 'rust-native', isolatedPort: port, executable,
      sourceIndexEntries: index.entries.length, changedPairs, visual,
      cases: cases.map(c => ({family: c.family, space: c.space, style: c.style?.id, width: c.width, depth: c.depth, unavailable: c.unavailable,
        attempts: c.attempts, accepted: c.scene?.buildings.length ?? 0, refusals: c.scene?.refusals,
        building: c.scene?.buildings[0] ? {bodies: c.scene.buildings[0].volumes.length, footprintAreaM2: area(c.scene.buildings[0].footprint),
          roofAreaM2: area(c.scene.buildings[0].roof_footprint), courtyardAreaM2: area(c.scene.buildings[0].courtyards),
          nativeRoofVertices: c.scene.buildings[0].volumes.reduce((sum, volume) => sum + volume.roof_mesh.vertices.length, 0)} : undefined})),
      limits: ['Plan-only gallery: roof envelopes/heights/entrances remain cartographic proxies until native realization.', 'No FP-L source bundle exists in the current atlas; no source was fabricated.']};
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({output, accepted: cases.reduce((sum, c) => sum + (c.scene?.buildings.length ?? 0), 0), changedPairs, visual}, null, 2));
  } finally { await browser.close(); }
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
