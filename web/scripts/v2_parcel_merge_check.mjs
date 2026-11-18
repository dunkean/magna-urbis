/** Parcel merge in the real V2 editor: select a lot, "Merge with neighbour", click an adjacent lot of the same
 * block, Regenerate area; the two lots become one (union outline, the first lot's id) in the drawn and picked world.
 * Uses the running page server (MAGNA_V2_URL, default :5173) and native engine (MAGNA_LOCAL_SERVER, default :8791). */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../out/parcel-merge/', import.meta.url));
await mkdir(out, { recursive: true });
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5173';
const server = process.env.MAGNA_LOCAL_SERVER ?? 'http://127.0.0.1:8791';
const deadline = setTimeout(() => {
  console.error('Parcel merge check: 8 minute limit reached');
  process.exit(2);
}, 8 * 60_000);
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(`${base}/v2.html?empty&test=1&lang=en&profile=local&localServer=${encodeURIComponent(server)}`);
  await page.waitForFunction(() => window.__v2Test?.ready);
  await page.evaluate(() => window.__v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 600, seed: 'parcel-merge', fortification: 'none' }));
  await page.evaluate(() => window.__v2Test.run('main'));
  const view = await page.evaluate(() => window.__v2Test.view('2d-core'));
  const box = await page.locator('#map').boundingBox();
  const toScreen = p => ({ x: box.x + box.width / 2 + (p.x - view.cx) * view.scale, y: box.y + box.height / 2 + (p.y - view.cy) * view.scale });
  // Two plots of one block sharing at least two vertices, both well inside the viewport.
  const pair = await page.evaluate(
    ({ view, box }) => {
      const visible = p => {
        const x = box.x + box.width / 2 + (p.x - view.cx) * view.scale,
          y = box.y + box.height / 2 + (p.y - view.cy) * view.scale;
        return x > box.x + 80 && x < box.x + box.width * 0.6 && y > box.y + 120 && y < box.y + box.height - 160;
      };
      const w = window.__v2Test.world(),
        key = w.settlements[0].key,
        parcels = w.debug.v2RustCities[key].partitions[0].parcels;
      const inside = (ring, p) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
        }
        return c;
      };
      const area = ring =>
        Math.abs(
          ring.reduce((s, p, i) => {
            const q = ring[(i + 1) % ring.length];
            return s + p.x * q.y - q.x * p.y;
          }, 0),
        ) / 2;
      const centre = ring => {
        const c = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
        return inside(ring, c) ? c : undefined;
      };
      const plots = parcels.filter(p => p.use === 'plot' && area(p.shape.outer) > 60 && centre(p.shape.outer) && visible(centre(p.shape.outer)));
      for (const a of plots)
        for (const b of plots) {
          if (a === b || a.block !== b.block) continue;
          const shared = a.shape.outer.filter(p => b.shape.outer.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 0.05)).length;
          if (shared >= 2) return { key, a: { id: a.id, at: centre(a.shape.outer), area: area(a.shape.outer) }, b: { id: b.id, at: centre(b.shape.outer), area: area(b.shape.outer) } };
        }
      return undefined;
    },
    { view, box },
  );
  assert(pair, 'two adjacent plots of one block exist');
  console.log('Merging', pair.a.id, '+', pair.b.id);
  await page.evaluate(() => {
    const inspect = document.querySelector('#inspect-mode');
    inspect.checked = true;
    inspect.dispatchEvent(new Event('change'));
    const target = document.querySelector('#inspect-target');
    target.value = 'parcel';
    target.dispatchEvent(new Event('change'));
  });
  const a = toScreen(pair.a.at),
    b = toScreen(pair.b.at);
  await page.mouse.click(a.x, a.y);
  const opened = await page
    .waitForFunction(() => [...document.querySelectorAll('#subdivision-actions button')].some(x => x.textContent.includes('Merge with neighbour')), null, { timeout: 20000 })
    .then(
      () => true,
      () => false,
    );
  if (!opened) {
    await page.screenshot({ path: `${out}/no-inspector.png` });
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          inspector: document.querySelector('#inspector')?.hidden,
          scope: document.querySelector('#inspector')?.dataset.scope,
          text: document.querySelector('#building-inspector')?.textContent?.slice(0, 300),
          targets: [...document.querySelectorAll('#inspect-target option')].map(o => o.value),
          toast: document.querySelector('#toast')?.textContent,
        })),
      ),
    );
    throw new Error('the parcel inspector did not open');
  }
  assert(
    await page.evaluate(() => {
      const more = document.querySelector('#building-inspector details.urban-advanced');
      return !!more && !more.open && !!more.querySelector('[data-field-path="houseConfig.pack"]') && !!document.querySelector('#building-inspector [data-field-path="enclosure"]');
    }),
    'the parcel shows its fence and a collapsed Advanced section',
  );
  await page.evaluate(() => [...document.querySelectorAll('#subdivision-actions button')].find(x => x.textContent.includes('Merge with neighbour')).click());
  await page.mouse.click(b.x, b.y);
  assert.match(await page.locator('#selection-status').textContent(), /1 parcel/, 'the neighbour joins the merge');
  await page.evaluate(() => document.querySelector('#subdivision-apply').click());
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false' && !window.__v2Test.busy?.());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(({ key, a, b }) => {
    const w = window.__v2Test.world(),
      parcels = w.debug.v2RustCities[key].partitions[0].parcels;
    const area = ring =>
      Math.abs(
        ring.reduce((s, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return s + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    const merged = parcels.find(p => p.id === a.id);
    return { merged: merged && area(merged.shape.outer), gone: !parcels.some(p => p.id === b.id), drawn: !w.urban.parcels.some(p => p.nativeId === b.id), warnings: w.debug.v2RustCities[key].partitions[0].warnings ?? [], toast: document.querySelector('#toast')?.textContent };
  }, pair);
  console.log(JSON.stringify(after));
  await page.screenshot({ path: `${out}/merged.png` });
  assert(after.gone, 'the absorbed lot leaves the cadastre');
  assert(after.drawn, 'the absorbed lot leaves the drawn and picked world');
  assert(Math.abs(after.merged - (pair.a.area + pair.b.area)) < 0.05 * (pair.a.area + pair.b.area), `the merged lot covers both: ${after.merged} vs ${pair.a.area + pair.b.area}`);
  assert.deepEqual(errors, []);
  console.log('Parcel merge check passed');
} finally {
  clearTimeout(deadline);
  await browser?.close();
}
