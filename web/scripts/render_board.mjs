import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const port = Number(arg('port', '')), label = arg('label', '');
if (!Number.isInteger(port) || port < 5191 || port > 5199 || !/^[\w.-]+$/.test(label)) throw Error('Usage: --port 5191..5199 --label name [--styles a,b] [--zooms far,mid,near] [--three-d] [--season s] [--climate zone] [--relief-climate zone] [--camera-from label] [--page v2.html]');
const styles = arg('styles', 'atlas,cadastre,topographic,satellite,parchment,illustration').split(',');
const zooms = arg('zooms', 'far,mid,near').split(','), steps = { far: 0, mid: 5, near: 9 };
for (const z of zooms) if (!(z in steps)) throw Error(`Unknown zoom ${z}`);
const out = path.join(web, 'out/render-board', label); fs.mkdirSync(out, { recursive: true });
const start = Date.now(), elapsed = () => Date.now() - start;
const meta = { label, commit: process.env.RENDER_BOARD_COMMIT || null, started: new Date().toISOString(), page: arg('page', 'v2.html'), viewport: { width: 1400, height: 1000 }, seed: 'magna-urbis-v2', source: 'procedural', styles, zooms, wheel: { point: { x: 680, y: 200 }, deltaY: -240, steps }, options: [], shots: [], pageErrors: [], consoleErrors: [], timings: {}, notes: [] };
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function save() {
  meta.timings.totalMs = elapsed(); fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  const cols = [...zooms, ...(args.includes('--three-d') ? ['3d'] : [])];
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${esc(label)} render board</title><style>body{font:14px system-ui;background:#181b20;color:#eee;margin:24px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #424750}img{width:100%;min-width:180px}th{position:sticky;top:0;background:#252a32}a{color:#abd7ff}td:first-child{font-weight:bold}small{color:#bdc5d0}</style><h1>${esc(label)}</h1><p>Procedural · ${meta.seed} · 1400×1000 · one chain · <a href="meta.json">metadata</a></p><p><small>Wheel: (${meta.wheel.point.x}, ${meta.wheel.point.y}), −240 px × 0 / 5 / 9. 3D: default fitted camera retained across styles.</small></p><table><thead><tr><th>Style</th>${cols.map(z=>`<th>${z}</th>`).join('')}</tr></thead><tbody>${styles.map(s=>`<tr><td>${esc(s)}</td>${cols.map(z=>{const shot=meta.shots.find(i=>i.style===s&&i.zoom===z);return `<td>${shot?`<a href="${shot.file}"><img loading="lazy" src="${shot.file}" alt="${esc(s)} ${z}"></a><small>${esc(shot.option)} · ${esc(shot.scaleLabel ?? '3D')}</small>`:'—'}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`);
}
let browser, page;
const timer = setTimeout(() => { meta.failure = 'Run exceeded 10 minutes; stopped without retry'; save(); browser?.close().finally(()=>process.exit(2)); }, 600000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' }, args: args.includes('--webgpu') ? ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--use-webgpu-adapter=d3d12', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] : ['--use-angle=vulkan', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
  // Restrict only processes launched by this browser. Never select by image name.
  if (process.platform === 'win32') {
    try { const cdp = await browser.newBrowserCDPSession(); const { processInfo } = await cdp.send('SystemInfo.getProcessInfo'); meta.chromePids = processInfo.map(p=>p.id); execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ids=@(${meta.chromePids.join(',')}); foreach($idValue in $ids){try{(Get-Process -Id $idValue -ErrorAction Stop).ProcessorAffinity=[IntPtr]0xFFFE00}catch{}}`], { stdio: 'ignore' }); await cdp.detach(); } catch(e) { meta.notes.push(`Affinity: ${e.message}`); }
  }
  page = await browser.newPage({ viewport: meta.viewport, deviceScaleFactor: 1 });
  meta.navigations=[];
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())meta.navigations.push({ms:elapsed(),url:frame.url()});});
  page.on('crash',()=>{meta.notes.push(`Page crashed at ${elapsed()} ms`);});
  page.on('console', m => { if (m.type() === 'warning' && /WebGPU|pipeline/i.test(m.text())) { meta.notes.push(m.text().slice(0, 300)); console.log('WARN', m.text().slice(0, 300)); } });
  page.on('pageerror', e => { meta.pageErrors.push({ ms: elapsed(), message: e.message }); console.log('PAGEERROR', e.message); });
  page.on('console', m => { if(m.type()==='error') meta.consoleErrors.push({ ms: elapsed(), message: m.text().slice(0,2000), location: m.location() }); });
  page.setDefaultTimeout(30000);
  // Other sessions edit this tree: a hot reload in the middle of the chain would lose the page.
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'text/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}});export const updateStyle=(id,css)=>{let e=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(!e){e=document.createElement("style");e.dataset.viteDevId=id;document.head.append(e);}e.textContent=css;};export const removeStyle=()=>{};export const injectQuery=u=>u;export const ErrorOverlay=class{};' }));
  // Board-only hook: expose the 3D view's camera so a board can record it and another board can reuse it (--camera-from label).
  // The default camera fits the buildings, so a climate variant with other farms would otherwise frame the map differently.
  await page.route(/\/city3d\.ts(\?.*)?$/, async route => { const response = await route.fetch(), body = await response.text(); if (!body.includes('return api;')) meta.notes.push('3D camera hook missing'); await route.fulfill({ response, body: body.replace('return api;', 'globalThis.__boardCity3d = api; return api;') }); });
  const cameraFrom = arg('camera-from', '') ? JSON.parse(fs.readFileSync(path.join(web, 'out/render-board', arg('camera-from', ''), 'meta.json'), 'utf8')).camera3d : undefined;
  if (arg('camera-from', '') && !cameraFrom) throw Error(`No camera3d in board ${arg('camera-from', '')}`);
  if (args.includes('--webgpu')) await page.addInitScript(() => { const proto = globalThis.GPUDevice?.prototype; if (!proto) return; const create = proto.createRenderPipelineAsync; proto.createRenderPipelineAsync = function (d) { const t = performance.now(); return create.call(this, d).then(r => { console.warn('WebGPU pipeline ok', d.label, Math.round(performance.now() - t) + ' ms'); return r; }, e => { console.warn('WebGPU pipeline FAILED', d.label, String(e.message).slice(0, 240)); throw e; }); }; });
  await page.goto(`http://127.0.0.1:${port}/${meta.page}?test=1&quality=full&lang=fr&source=procedural${args.includes('--webgpu') ? '&renderer=webgpu' : ''}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#map-style').waitFor(); await page.waitForTimeout(6000);
  const proc = page.locator('button', { hasText: /^\s*Proc/ }).first();
  if(await proc.count()) { await proc.click(); await page.waitForTimeout(1500); meta.notes.push('Clicked procedural source'); }
  else throw Error('Procedural source button missing; refusing an unverified generation');
  await page.locator('#seed').fill(meta.seed); await page.locator('#seed').dispatchEvent('change');
  await page.locator('#expert-open').click();
  meta.recipe = JSON.parse(await page.locator('#expert-json').inputValue());
  // --climate <zone> edits the recipe like the climate strip does (zone + its classic biome); every other parameter stays.
  // --relief-climate <zone> keeps that zone's landforms and water (default map: temperate) under the new climate.
  if (arg('climate', '') || arg('relief-climate', '')) {
    const zoneBiome = { temperate: 'temperate', mediterranean: 'temperate', continental: 'forest', nordic: 'forest', alpine: 'forest', arctic: 'tundra', steppe: 'steppe', desert: 'desert', savanna: 'steppe', tropical: 'tropical', wetland: 'temperate' }; // src/gen/biomes.ts climateZoneBiome
    const zone = arg('climate', ''), relief = arg('relief-climate', '');
    for (const z of [zone, relief].filter(Boolean)) if (!(z in zoneBiome)) throw Error(`Unknown climate zone ${z}`);
    meta.climate = { zone: zone || null, reliefClimate: relief || null, defaultBiome: meta.recipe.options.biome };
    meta.recipe.terrain = { ...meta.recipe.terrain, ...(zone ? { climate: zone } : {}), ...(relief ? { reliefClimate: relief } : {}) };
    if (zone) meta.recipe.options.biome = zoneBiome[zone];
    await page.locator('#expert-json').fill(JSON.stringify(meta.recipe)); await page.locator('#expert-apply').click(); await page.waitForTimeout(500);
    const refused = await page.locator('#expert-error').textContent(); if (refused) throw Error(`Recipe refused: ${refused}`);
    await page.locator('#expert-open').click(); meta.recipe = JSON.parse(await page.locator('#expert-json').inputValue());
  }
  await page.evaluate(()=>document.querySelector('#expert-dialog').close());
  if(meta.recipe.generation !== 'procedural' || !String(meta.recipe.runtime?.source).startsWith('procedural')) throw Error('Recipe did not confirm procedural source');
  meta.timings.readyMs = elapsed();
  await page.locator('#run-chain').click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 330000 });
  await page.waitForTimeout(6000);
  if(await page.locator('#map-canvas').isHidden()) throw Error(`Generation failed: ${await page.locator('#toast').textContent()}`);
  meta.timings.chainDoneMs = elapsed();
  meta.status = await page.locator('#footer-status').textContent();
  meta.jobLog = await page.locator('#job-log').textContent();
  meta.generationToast = await page.locator('#toast').textContent();
  // Relief identity: the app's own heightmap export (8-bit PNG + exact min/max) is kept next to the shots.
  await page.evaluate(()=>document.querySelector('#export-open').click());
  await page.locator('#export-format').selectOption('heightmap');
  const files = []; const onDownload = d => files.push(d); page.on('download', onDownload);
  await page.locator('#export-go').click();
  await page.waitForFunction(()=>!document.querySelector('#export-dialog')?.open,null,{timeout:60000}); await page.waitForTimeout(1000); page.off('download', onDownload);
  meta.heightmap = {};
  for (const d of files) { const name = d.suggestedFilename().endsWith('.png') ? 'heightmap.png' : 'heightmap.json'; await d.saveAs(path.join(out, name)); const bytes = fs.readFileSync(path.join(out, name)); meta.heightmap[name] = name.endsWith('.json') ? JSON.parse(bytes) : { sha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }; }
  console.log('HEIGHTMAP', JSON.stringify(meta.heightmap));
  meta.options = await page.locator('#map-style option').evaluateAll(os=>os.map(o=>({ value:o.value, label:o.textContent, disabled:o.disabled })));
  console.log('OPTIONS', JSON.stringify(meta.options));
  const aliases = { atlas:['atlas'], cadastre:['cadastre','plan','cadastral'], topographic:['topographic','topo','topography'], satellite:['satellite','natural','render-v2','render3d'], natural:['natural','satellite','render-v2','render3d'], parchment:['parchment'], illustration:['illustration','illustrated','fantasy'] };
  function resolveStyle(style) { const list=aliases[style]??[style]; for(const id of list) if(meta.options.some(o=>o.value===id&&!o.disabled)) return id; const words={atlas:/atlas/i,cadastre:/cadastre|plan|cadastr/i,topographic:/topo/i,satellite:/satellite|natural|render v2/i,parchment:/parch/i,illustration:/illustr/i}; const match=meta.options.find(o=>!o.disabled&&(words[style]??new RegExp(style,'i')).test(o.label)); if(!match)throw Error(`No style alias for ${style}`); meta.notes.push(`Closest style: ${style} -> ${match.value}`); return match.value; }
  await page.addStyleTag({ content: `html,body,#app{width:100%!important;height:100%!important;overflow:hidden!important}.app-header,#sidebar,.mobile-toggle,.map-topbar,.map-bottom,.map-compass,.map-tools,.map-hint,.inspector-mode,.places-panel,.inspector,.toast,.hint,.legend-strip,.progress-card,.city3d-bar,.city3d-info,.city3d-help{visibility:hidden!important;pointer-events:none!important}.workspace{display:block!important;position:fixed!important;inset:0!important;height:100vh!important}.map-area{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}.city3d{position:absolute!important;inset:0!important}` });
  await page.waitForTimeout(1000);
  const settle = async(delay=3000)=>{await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy')!=='true'&&document.querySelector('#render-status')?.hidden!==false,null,{timeout:240000});await page.waitForTimeout(delay);};
  async function shot(style, option, zoom) { if(!await page.locator('#map-canvas').count())throw Error(`Map DOM disappeared before ${style}-${zoom}`); const scaleLabel=zoom==='3d'?null:await page.locator('#scale-label').textContent(); const record={style,option,zoom,file:`${style}-${zoom}.png`,scaleLabel,approxPixelsPerMetre:scaleLabel?80/Number(scaleLabel.replace(/[^\d]/g,'')):null,...(zoom==='3d'?{camera:'Default fitted orbit camera, retained across styles; no navigation input'}:{}),renderStatus:await page.locator('#render-status').textContent().catch(()=>null),ms:elapsed()}; await page.evaluate(() => window.__v2Test?.prepareCapture()); await page.screenshot({ timeout: 200000,path:path.join(out,record.file)});meta.shots.push(record);console.log('SHOT',JSON.stringify(record));save(); }
  // Warm the painted 3D shaders early; keep the requested contact-sheet row order.
  meta.captureOrder=args.includes('--three-d')&&styles.includes('illustration')?['illustration',...styles.filter(s=>s!=='illustration')]:styles;
  for (const style of meta.captureOrder) {
    const option=resolveStyle(style); await page.evaluate(value=>{const select=document.querySelector('#map-style');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));},option); await settle(5000);
    if (args.includes('--no-text')) { await page.evaluate(()=>{const box=document.querySelector('[data-setting-path="appearance.composition.text.visible"]');if(!box)throw Error('no text toggle');box.checked=false;box.dispatchEvent(new Event('input',{bubbles:true}));box.dispatchEvent(new Event('change',{bubbles:true}));}); await settle(1500); }
    if (arg('season', '')) { const named = { winter: 0, spring: .25, summer: .5, autumn: .75 }, raw = arg('season', ''), v = raw in named ? named[raw] : Number(raw); meta.season = { raw, value: v }; await page.evaluate(v=>{const box=document.querySelector('[data-setting-path="composition.effects.season"],[data-setting-path="appearance.composition.effects.season"]');if(!box)throw Error('no season control');box.value=String(v);box.dispatchEvent(new Event('input',{bubbles:true}));box.dispatchEvent(new Event('change',{bubbles:true}));}, v); await settle(2500); }
    await page.evaluate(()=>document.querySelector('#fit-map').click()); await settle();
    let at=0;
    for (const zoom of [...zooms].sort((a,b)=>steps[a]-steps[b])) {
      if (arg('point')) { const [px, py] = arg('point').split(',').map(Number); meta.wheel.point = { x: px, y: py }; }
      await page.mouse.move(meta.wheel.point.x, meta.wheel.point.y);
      while(at<steps[zoom]) { await page.mouse.wheel(0,meta.wheel.deltaY); await page.waitForTimeout(200); at++; }
      await settle(); if (arg('hold')) await page.waitForTimeout(Number(arg('hold'))); await shot(style,option,zoom);
    }
    if(args.includes('--three-d')) {
      await page.evaluate(()=>document.querySelector('#view3d').click());
      await page.waitForFunction(()=>document.querySelector('#view3d')?.getAttribute('aria-pressed')==='true',null,{timeout:60000});
      await settle(6000);
      if (cameraFrom && !meta.cameraRestored) { await page.evaluate(c=>{const view=globalThis.__boardCity3d;if(!view)throw Error('3D camera hook missing');view.setCamera(c);},cameraFrom); meta.cameraRestored = arg('camera-from', ''); await settle(4000); }
      meta.camera3d ??= await page.evaluate(()=>{const c=globalThis.__boardCity3d?.getCamera();return c&&{x:c.x,y:c.y,distance:c.distance,yaw:c.yaw,pitch:c.pitch,exaggeration:c.exaggeration,navigation:c.navigation};});
      if (arg('hold')) await page.waitForTimeout(Number(arg('hold'))); await shot(style,option,'3d');
      await page.evaluate(()=>document.querySelector('#view3d').click()); await settle(1000);
    }
  }
  meta.completed=true;
} catch(e) { meta.failure=e.stack; console.error(e); process.exitCode=1; if(page&&!page.isClosed()){meta.failureUrl=page.url();await page.screenshot({path:path.join(out,'failure.png'),timeout:5000}).catch(()=>{});await page.content().then(html=>fs.writeFileSync(path.join(out,'failure.html'),html)).catch(()=>{});} }
finally { clearTimeout(timer); save(); await browser?.close(); }
