/** Two fresh native plans, visible-only realization and same-camera Canvas witness.
 * Uses an existing server; never starts/stops/rebuilds it.
 * From web/: node scripts/building_detail_smoke.mjs [runtime] [vite] [output]
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const runtime = process.argv[2] ?? 'http://127.0.0.1:8810', vite = process.argv[3] ?? 'http://127.0.0.1:5173';
const output = resolve(process.argv[4] ?? '../web/out/work/building-detail-smoke');
await mkdir(output, { recursive: true });
const requests = ['EUR-MED-B01', 'EUR-MED-B07'].map((recipe, index) => {
  const x = 100 + index * 80, y = 160, w = 48, h = 55;
  const surface = [{ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] }];
  return { id: `detail-smoke-${index}`, parcel_id: `detail-parcel-${index}`, seed: `compact-smoke:${recipe}`, cadastral: surface, buildable: surface, roof_domain: surface, reserves: [],
    accesses: [{ id: 'front', segment: [{ x, y: y + h }, { x: x + w, y: y + h }], kind: 'public', width_m: 2 }], party_boundaries: [], neighbors: [],
    culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null }, function: 'domestic',
    terrain: { origin: { x, y }, ground_z_m: 10, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
    config: { recipe, variation: 0, overrides: { variant: 'default' } }, parcel_fit: true };
});
const response = await fetch(`${runtime}/houses/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema_version: '1', requests }) });
const envelope = await response.json(); assert(response.ok && envelope.ok, JSON.stringify(envelope.error));
const scene = envelope.data; assert.equal(scene.buildings.length, 2, JSON.stringify(scene.refusals));
await writeFile(resolve(output, 'fresh-plans.json'), JSON.stringify(scene));
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 760 }, deviceScaleFactor: 1 });
  // Chromium's synthetic routed document has no inferred loopback address space.
  // Grant the localhost test origin its explicit local-network permission.
  await page.context().grantPermissions(['local-network-access'], { origin: new URL(vite).origin });
  const errors = [], networkErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') networkErrors.push(message.text()); });
  page.on('requestfailed', request => networkErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.route('**/building-detail-smoke.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><meta charset="utf-8"><body style="margin:0;background:#f4efdf;font:16px sans-serif;color:#393a31"><h2 style="margin:16px 20px">Plans compacts natifs · même scène, même caméra</h2><canvas width="1440" height="680"></canvas></body></html>' }));
  await page.goto(`${vite}/building-detail-smoke.html`);
  await page.evaluate(async ({ scene, runtime, moduleRoot }) => {
    const { UrbanBuildingLodRenderer } = await import(`${moduleRoot}/urbanBuildingLod.ts`);
    const { UrbanBuildingDetailController } = await import(`${moduleRoot}/urbanBuildingDetails.ts`);
    const points = scene.buildings.flatMap(building => building.roof_footprint.flatMap(polygon => polygon.outer));
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    const maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y));
    const metresPerPixel = Math.max((maxX - minX) / 1300, (maxY - minY) / 560), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const viewport = { minX: cx - 720 * metresPerPixel, minY: cy - 340 * metresPerPixel, maxX: cx + 720 * metresPerPixel, maxY: cy + 340 * metresPerPixel };
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const renderer = new UrbanBuildingLodRenderer(scene, { raster: false });
    let requests = 0, inFlight = 0, peakInFlight = 0;
    const controller = new UrbanBuildingDetailController({ scene, renderer,
      realize: async (building, options) => {
        if (options.interiors !== false) throw new Error('Interiors were requested.');
        requests++; inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
        try {
          const response = await fetch(`${runtime}/houses/realize-plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ building, interiors: options.interiors }) });
          const envelope = await response.json(); if (!response.ok || !envelope.ok) throw new Error(JSON.stringify(envelope.error)); return envelope.data;
        } finally { inFlight--; }
      } });
    const draw = () => {
      ctx.resetTransform(); ctx.fillStyle = '#f4efdf'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(1 / metresPerPixel, 0, 0, 1 / metresPerPixel, -viewport.minX / metresPerPixel, -viewport.minY / metresPerPixel);
      const metrics = renderer.draw(ctx, { viewport, metresPerPixel, appearance: { style: 'cartographic', diagnostic: 'none' } });
      ctx.resetTransform(); ctx.font = '18px sans-serif'; ctx.fillStyle = '#393a31';
      ctx.fillText(`Deux plans conservés · ${metresPerPixel.toFixed(3)} m/px · détail natif uniquement au zoom proche`, 22, 32);
      return metrics;
    };
    controller.update({ viewport, metresPerPixel: 10 });
    if (requests !== 0) throw new Error('Overview requested native detail.');
    const before = draw(), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice();
    window.__detailSmoke = { controller, renderer, scene, viewport, metresPerPixel, draw, pixels, before,
      activity: () => ({ requests, peakInFlight }) };
  }, { scene, runtime, moduleRoot: `/@fs/${resolve('src/render').replaceAll('\\', '/')}` });
  await page.screenshot({ path: resolve(output, 'before-compact.png') });
  const report = await page.evaluate(async () => {
    const state = window.__detailSmoke, footprintBefore = JSON.stringify(state.scene.buildings.map(building => building.footprint));
    const start = performance.now(); state.controller.update({ viewport: state.viewport, metresPerPixel: state.metresPerPixel, selectedId: state.scene.buildings[1].id });
    while (state.controller.stats.inFlight || state.controller.stats.queued) {
      if (performance.now() - start > 20_000) throw new Error('Native detail smoke timed out.');
      await new Promise(done => setTimeout(done, 20));
    }
    const after = state.draw(), canvas = document.querySelector('canvas'), pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let changedPixels = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== state.pixels[i] || pixels[i + 1] !== state.pixels[i + 1] || pixels[i + 2] !== state.pixels[i + 2]) changedPixels++;
    document.querySelector('h2').textContent = 'Extérieurs natifs à la demande · même scène, même caméra';
    const details = state.scene.buildings.map(building => ({ id: building.id, recipe: building.recipe_id, status: state.controller.status(building.id),
      faces: state.controller.getDetail(building.id)?.volumes.reduce((sum, volume) => sum + volume.roof_mesh.faces.length, 0) ?? 0,
      planReferencePreserved: state.controller.getDetail(building.id)?.footprint === building.footprint }));
    return { ...state.activity(), elapsedMs: performance.now() - start, stats: state.controller.stats, details, changedPixels,
      basePlansUnchanged: footprintBefore === JSON.stringify(state.scene.buildings.map(building => building.footprint)) && state.scene.buildings.every(building => building.volumes.every(volume => volume.roof_mesh.vertices.length === 0)),
      before: state.before, after };
  });
  await page.screenshot({ path: resolve(output, 'after-native.png') });
  const far = await page.evaluate(() => {
    const state = window.__detailSmoke, canvas = document.querySelector('canvas');
    state.controller.update({ viewport: state.viewport, metresPerPixel: 10 });
    const metrics = state.renderer.draw(canvas.getContext('2d'), { viewport: state.viewport, metresPerPixel: 10, appearance: { style: 'cartographic', diagnostic: 'none' } });
    state.controller.dispose(); return { roofMeshesRead: metrics.roofMeshesRead, requests: state.activity().requests };
  });
  Object.assign(report, { far, errors, networkErrors, runtime });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.equal(report.requests, 2); assert.equal(report.stats.cached, 2, JSON.stringify(report.details));
  assert.equal(report.stats.refused, 0); assert.equal(report.basePlansUnchanged, true);
  assert(report.details.every(detail => detail.faces > 0 && detail.planReferencePreserved));
  assert(report.changedPixels > 100); assert(report.peakInFlight <= 2); assert.equal(far.roofMeshesRead, 0); assert.equal(far.requests, 2); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, requests: report.requests, peakInFlight: report.peakInFlight, stats: report.stats, changedPixels: report.changedPixels, details: report.details.map(({ id, faces }) => ({ id, faces })), far }, null, 2));
} finally { await browser.close(); }
