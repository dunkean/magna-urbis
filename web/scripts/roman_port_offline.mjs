/** Paint already computed parent CLI fixtures, with zero network/native generation. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const out = resolve('out/roman-port-proof/visual'); await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const additional = process.argv[2];
if (additional && !/^[a-z][a-z0-9-]*$/.test(additional)) throw new Error('Invalid saved variant');
const south = additional === 'south';
const current = process.argv.includes('--current');
const reference = additional ? JSON.parse(await readFile(resolve(out, 'report.json'), 'utf8')) : undefined;
const painter = additional && !current ? await readFile(resolve(out, 'painter.js'), 'utf8')
  : (await build({ stdin: { contents: "import {buildCityScene,buildCityBuildings,drawCity,selectCityLod} from './src/render/cityCanvas.ts';import {silhouetteScene} from './src/ui/urbanSilhouettes.ts';globalThis.auditApi={buildCityScene,buildCityBuildings,drawCity,selectCityLod,silhouetteScene};", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' })).outputFiles[0].text;
if (!additional || current) await writeFile(resolve(out, current ? 'painter-current.js' : 'painter.js'), painter);
if (reference && !current && reference.painterSha256 !== hash(painter)) throw new Error('Saved painter no longer matches the reference');
const states = [];
for (const name of south ? current ? ['after'] : ['before', 'after'] : additional ? [additional] : ['before', 'quay-profile']) {
  const state = { name, hashes: {} };
  for (const key of ['layouts', 'partitions', 'requests']) { const bytes = await readFile(`out/roman-port-proof/${name}/${key}.json`); state.hashes[key] = hash(bytes); state[key] = JSON.parse(bytes); }
  states.push(state);
}
const points = states.flatMap(s => s.layouts.flatMap(l => {
  const quarters = new Set(l.structure.districts.filter(d => d.role === 'port').flatMap(d => d.quarters));
  return l.blocks.filter(b => quarters.has(b.quarter)).flatMap(b => b.shape.outer);
}));
if (!points.length) throw new Error('No actual port district geometry');
const box = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
const cameras = south ? [{ id: current ? 'south-current' : 'south', center: [2635, 3310], mpp: .4 }]
  : reference?.cameras ?? [{ id: 'port', center: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], mpp: Math.max((box.maxX - box.minX + 120) / 1200, (box.maxY - box.minY + 120) / 925) },
  { id: 'centre', center: [2639.9315590685324, 2668.9433913724934], mpp: .4 }];
const backgroundFile = 'decors/city-04-mountain-bay-s-parchment.png', background = await readFile(backgroundFile);
if (reference && reference.backgroundSha256 !== hash(background)) throw new Error('Background no longer matches the reference');
const report = { source: 'Parent CLI outputs; both states share one fixture. Not a live UI run, not identical to old runtime8791.', networkCalls: 0, painterSha256: hash(painter), backgroundFile, backgroundSha256: hash(background), cameras, states: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 925 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => { report.networkCalls++; return route.abort(); });
  await page.setContent('<style>body{margin:0}canvas{display:block}</style><canvas width="1200" height="925"></canvas>');
  await page.addScriptTag({ content: painter });
  await page.evaluate(async source => { window.backgroundImage = new Image(); window.backgroundImage.src = source; await window.backgroundImage.decode(); }, `data:image/png;base64,${background.toString('base64')}`);
  for (const state of states) {
    await page.evaluate(({ layouts, partitions, requests }) => {
      const api = window.auditApi; window.city = api.buildCityScene(layouts, partitions); window.houses = api.buildCityBuildings(api.silhouetteScene(requests), window.city);
    }, state);
    const result = { name: state.name, hashes: state.hashes, blocks: state.layouts.reduce((n, l) => n + l.blocks.length, 0), requests: state.requests.length,
      quays: state.layouts.flatMap(l => l.streets).filter(s => s.role === 'quay').map(s => ({ path: s.path, widths: s.widths })), captures: [] };
    for (const camera of cameras) {
      const frame = await page.evaluate(({ center, mpp }) => {
        const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
        const viewport = { minX: center[0] - width * mpp / 2, maxX: center[0] + width * mpp / 2, minY: center[1] - height * mpp / 2, maxY: center[1] + height * mpp / 2 };
        ctx.resetTransform(); ctx.globalAlpha = 1; ctx.fillStyle = '#f1f0e9'; ctx.fillRect(0, 0, width, height);
        ctx.setTransform(1 / mpp, 0, 0, 1 / mpp, -viewport.minX / mpp, -viewport.minY / mpp); ctx.drawImage(window.backgroundImage, 0, 0, 4000, 4000);
        ctx.globalAlpha = .8;
        return window.auditApi.drawCity(ctx, window.city, { viewport, mpp, dpr: 1, lod: window.auditApi.selectCityLod(mpp), view: 'buildings', palette: 'parchment', width: .6,
          layers: { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false },
          buildings: window.houses, buildingsVisible: true, appearance: { style: 'silhouette', diagnostic: 'none' } });
      }, camera);
      const file = `${state.name}-${camera.id}.png`; await page.locator('canvas').screenshot({ path: resolve(out, file) }); result.captures.push({ file, camera, frame });
    }
    report.states.push(result);
  }
} finally { await browser.close(); await writeFile(resolve(out, additional ? `${additional}${current ? '-current' : ''}-report.json` : 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ out, networkCalls: report.networkCalls, states: report.states.map(s => ({ name: s.name, requests: s.requests, quays: s.quays.length })) }));
