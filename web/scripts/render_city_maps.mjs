// Pre-rendered City Bench maps: one atlas-style PNG per City Bench decor (tags.kit = city),
// so a lightweight page can show an image instead of booting the live terrain renderer.
//
//   npm run dev:terrain                      (in another terminal)
//   node scripts/render_city_maps.mjs [--size 2048] [--only city-03] [--force] [--headed]
//                                     [--url http://127.0.0.1:5173] [--style parchment|render]
//                                     [--software | --hardware]
//
// Each web/decors/<id>.png is a square image covering exactly the world square [0, width]²
// (pixel (0, 0) is the world corner (0, 0), x east, y south), drawn by Terrain Bench in the
// atlas style: relief shading, hypsometry, coasts, lakes and rivers. Roads, settlements,
// land use, urban overlays, pins, frame, scale bar, legend, ruler and UI are left out.
// Existing PNGs are kept unless --force.
//
// --style <id> renders another Terrain Bench map style (parchment, render, or any 2D palette
// style) to web/decors/<id>-<style>.png, same square, same size, same georeferencing, so the
// City Bench can swap backgrounds pixel for pixel. Without --style the atlas image is written
// to <id>.png as before. Styled renders default to SwiftShader (software WebGL2, no GPU used);
// --hardware uses the real GPU instead, --software forces SwiftShader for the default too.
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const web = fileURLToPath(new URL('..', import.meta.url));
const decors = join(web, 'decors');
const base = option('url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const size = Number(option('size', 2048)), only = option('only', '');
const STYLES = ['atlas', 'parchment', 'render', 'watabou', 'engraving', 'cadastre', 'blueprint', 'illuminated', 'topographic', 'night'];
const style = option('style', ''), mapStyle = style || 'atlas';
if (!STYLES.includes(mapStyle)) throw new Error(`Invalid --style ${style} (one of ${STYLES.join(', ')}; render3d/fantasy are not flat raster styles)`);
const software = flag('software') || (!!style && !flag('hardware'));
const outputName = id => style && style !== 'atlas' ? `${id}-${style}.png` : `${id}.png`;
if (!Number.isInteger(size) || size < 64 || size > 8192) throw new Error(`Invalid --size ${option('size')}`);

const maps = JSON.parse(readFileSync(join(decors, 'index.json'), 'utf8')).decors
  .filter(e => e.tags?.kit === 'city' && e.id.startsWith(only));
if (!maps.length) throw new Error(`No City Bench decor matches "${only}" in decors/index.json (node scripts/export_decors.mjs --set city).`);

// Everything but the terrain canvas and the water layer stays hidden; the viewport is pinned
// to the page corner at exactly size × size CSS pixels (device scale factor 1).
const css = `/* city-map-capture */
#viewport { position: fixed !important; inset: 0 auto auto 0 !important; width: ${size}px !important; height: ${size}px !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; outline: 0 !important; z-index: 2147483000 !important; }
#viewport > :not(#gl):not(#map) { display: none !important; }
#map > :not(#hydrologyOverlay):not(#terrainOverview):not(#terrainDetail):not(#terrainContourOverlay):not(defs) { display: none !important; }`;

const pngSize = buffer => [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];

async function renderMap(page, entry) {
  const width = entry.width;
  await page.goto(`${base}/terrainbench.html?stage=settlements&standalone=1&profile=web&style=${mapStyle}&layer_frame=0`, { timeout: 240000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`#terrainLibrary select option[value="${entry.id}"]`, { state: 'attached', timeout: 120000 });
  await page.selectOption('#terrainLibrary select', entry.id);
  await Promise.all([
    page.waitForURL(url => new URL(url).searchParams.get('artifact') === entry.id, { timeout: 120000 }),
    page.click('#terrainLibrary [data-load]'),
  ]);
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 180000 });
  // A decor brings its own display style back on load: force the requested one (the load
  // may re-apply its style once more, hence the second look).
  for (let attempt = 0; attempt < 3 && await page.inputValue('#style') !== mapStyle; attempt++) {
    await page.evaluate(style => { const s = document.getElementById('style'); if (![...s.options].some(o => o.value === style)) s.append(new Option(style, style)); s.value = style; s.dispatchEvent(new Event('change', { bubbles: true })); }, mapStyle);   // #style can be hidden: set it directly
    await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 180000 });
    await page.waitForTimeout(1500);
  }
  await page.addStyleTag({ content: css });
  await page.evaluate(([width, size]) => {
    const frame = document.getElementById('showFrame');
    if (frame?.checked) { frame.checked = false; frame.dispatchEvent(new Event('input', { bubbles: true })); frame.dispatchEvent(new Event('change', { bubbles: true })); }
    window.magnaBenchContext.restore({ view: { cx: width / 2, cy: width / 2, scale: size / width } });
    window.magnaBenchContext.refresh();
  }, [width, size]);
  await page.waitForTimeout(500);
  await page.waitForFunction(size => { const gl = document.getElementById('gl'); return !gl || (gl.width === size && gl.height === size); }, size, { timeout: 60000 }).catch(() => {});
  // The SVG viewBox is the view: it must be exactly the world square on a size² viewport.
  // Checked before and after the capture: a late reload would otherwise capture the bench UI.
  const check = async () => {
    const geometry = await page.evaluate(() => {
      const rect = e => document.getElementById(e).getBoundingClientRect();
      const gl = document.getElementById('gl');
      return { viewBox: document.getElementById('map').getAttribute('viewBox').split(/\s+/).map(Number), map: rect('map').toJSON(), gl: rect('gl').toJSON(), canvas: [gl.width, gl.height], frame: document.getElementById('showFrame')?.checked, style: document.getElementById('style')?.value,
        capture: [...document.querySelectorAll('style')].some(s => s.textContent.includes('city-map-capture')), artifact: new URLSearchParams(location.search).get('artifact') };
    });
    const expected = [0, 0, width, width];
    if (!geometry.capture) throw new Error('capture stylesheet lost (page reloaded)');
    if (geometry.artifact !== entry.id) throw new Error(`page shows ${geometry.artifact}, expected ${entry.id}`);
    if (geometry.viewBox.some((v, i) => Math.abs(v - expected[i]) > width * 1e-6)) throw new Error(`viewBox ${geometry.viewBox.join(' ')} is not the world square ${width}`);
    for (const r of [geometry.map, geometry.gl]) if (r.x !== 0 || r.y !== 0 || r.width !== size || r.height !== size) throw new Error(`viewport rect ${JSON.stringify(r)} is not ${size}²`);
    if (geometry.canvas[0] !== size || geometry.canvas[1] !== size) throw new Error(`terrain canvas ${geometry.canvas.join('×')} is not ${size}²`);
    if (geometry.frame) throw new Error('map frame still shown');
    if (geometry.style !== mapStyle) throw new Error(`Terrain Bench style is ${geometry.style}, expected ${mapStyle}`);
  };
  await check();
  // Detail refinement streams in after the overview: wait for two identical frames.
  const clip = { x: 0, y: 0, width: size, height: size }, started = Date.now();
  let previous, image, stable = false;
  while (Date.now() - started < 120000) {
    await page.waitForTimeout(1000);
    image = await page.screenshot({ clip, type: 'png', timeout: 180000 });
    if (previous?.equals(image)) { stable = true; break; }
    previous = image;
  }
  await check();
  const [w, h] = pngSize(image);
  if (w !== size || h !== size) throw new Error(`capture is ${w}×${h}, expected ${size}²`);
  return { image, stable, settleMs: Date.now() - started };
}

// SwiftShader keeps every GPU free (the bench's WebGL2 terrain runs fine in software, only slower).
const gpuArgs = software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(process.env.ANGLE ? [`--use-angle=${process.env.ANGLE}`] : [])];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: !flag('headed'), args: gpuArgs });
console.log(`style ${mapStyle} → decors/${outputName('<id>')} · ${software ? 'SwiftShader' : 'hardware GPU'}`);
const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => console.warn(`  page error: ${error.message}`));
const started = Date.now();
let rendered = 0, skipped = 0, failed = 0;
for (const entry of maps) {
  const file = join(decors, outputName(entry.id));
  if (existsSync(file) && !flag('force')) { skipped++; console.log(`${entry.id}: exists`); continue; }
  const t = Date.now();
  try {
    // Software rendering on a busy machine can stall one attempt: retry once on a fresh page.
    const { image, stable, settleMs } = await renderMap(page, entry).catch(async error => {
      console.warn(`${entry.id}: retry after ${String(error.message).split(/\r?\n/)[0]}`);
      await page.goto('about:blank');
      return renderMap(page, entry);
    });
    writeFileSync(file, image); rendered++;
    console.log(`${entry.id}: ${size}² · ${entry.width} m · ${(image.length / 1024 / 1024).toFixed(1)} MB · ${((Date.now() - t) / 1000).toFixed(1)} s${stable ? '' : ` · not stable after ${settleMs} ms`}`);
  } catch (error) { failed++; console.error(`${entry.id}: FAILED ${error.message}`); }
}
await browser.close();
console.log(`${rendered} rendered, ${skipped} kept, ${failed} failed in ${((Date.now() - started) / 1000).toFixed(0)} s`);
if (failed) process.exitCode = 1;
