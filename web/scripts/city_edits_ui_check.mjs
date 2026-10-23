// From web/: node scripts/city_edits_ui_check.mjs [--server http://127.0.0.1:8806] [--artifact city-01-river-plain-s] [--out out/edits/ui]
// City Bench structural edits, through the real inspector and shape editor (spec OPUS_EDITS_SPEC.md c/d):
// reshape, delete and reroll a parcel; reroll, reshape and delete a quarter; MU1 round trip; reset.
// A screenshot before and after each step. Software GL only (the RTX 5090 stays free).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const server = option('server', 'http://127.0.0.1:8806');
const artifact = option('artifact', 'city-01-river-plain-s');
const out = option('out', 'out/edits/ui');
const bench = option('bench', 'http://127.0.0.1:5173/citybench.html');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { artifact, steps: [], errors: [] };
const responses = [];
const area = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j].x * r[i].y - r[i].x * r[j].y; return Math.abs(s) / 2; };
const inside = (r, p) => { let hit = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < (r[j].x - r[i].x) * (p.y - r[i].y) / (r[j].y - r[i].y) + r[i].x) hit = !hit; return hit; };
const bbox = r => r.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
/** An interior point: the centroid when inside, else the best grid sample. */
function interior(r) {
  const c = { x: r.reduce((s, p) => s + p.x, 0) / r.length, y: r.reduce((s, p) => s + p.y, 0) / r.length };
  if (inside(r, c)) return c;
  const b = bbox(r);
  for (let k = 1; k < 20; k++) for (let i = 1; i < 20; i++) { const p = { x: b.minX + (b.maxX - b.minX) * i / 20, y: b.minY + (b.maxY - b.minY) * k / 20 }; if (inside(r, p)) return p; }
  return c;
}
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`.slice(0, 400)); });
  page.on('response', async response => {
    if (!response.url().endsWith('/urban') || response.request().method() !== 'POST') return;
    try {
      const request = JSON.parse(response.request().postData() ?? '{}'), body = await response.json();
      responses.push({ kind: request.kind, request, ...(body.data ?? body) });
    } catch (error) { report.errors.push(String(error)); }
  });
  const url = new URL(bench);
  for (const [k, v] of Object.entries({ standalone: '1', profile: 'local', localServer: server, artifact })) url.searchParams.set(k, v);
  await page.goto(url.href);
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), undefined, { timeout: 180000 });
  const busy = kind => page.evaluate(k => document.querySelector(`#${k} [data-apply]`)?.getAttribute('aria-busy') === 'true', kind);
  const idle = async (timeout = 600000) => {
    const t0 = Date.now();
    for (;;) {
      await page.waitForTimeout(400);
      for (const k of ['urbanQuarterStage', 'urbanParcelStage']) await page.waitForFunction(kk => document.querySelector(`#${kk} [data-apply]`)?.getAttribute('aria-busy') !== 'true', k, { timeout });
      const n = responses.length; await page.waitForTimeout(5000);
      if (n === responses.length && !await busy('urbanQuarterStage') && !await busy('urbanParcelStage') || Date.now() - t0 > timeout) break;
    }
    await page.waitForFunction(() => (document.querySelector('[data-city-frame]')?.textContent ?? '').length > 0, undefined, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1000);
  };
  await page.waitForTimeout(2000);
  if (!responses.some(r => r.kind === 'quarters') && !await busy('urbanQuarterStage')) await page.locator('#urbanQuarterStage [data-apply]').click();
  await idle();
  if (!responses.some(r => r.kind === 'parcels' && r.partitions)) { await page.locator('#urbanParcelStage [data-apply]').click(); await idle(); }
  const last = kind => responses.filter(r => r.kind === kind && (kind === 'quarters' ? r.layouts : r.partitions)).at(-1);
  const plan = () => ({ layout: last('quarters').layouts[0], partition: last('parcels').partitions[0] });
  const counts = () => { const { layout, partition } = plan(); return { quarters: layout.quarters.length, blocks: layout.blocks.length, streets: layout.streets.length, parcels: partition.parcels.length }; };
  const base = counts();
  report.base = base;

  const view = async (cx, cy, scale) => { await page.evaluate(v => window.magnaBenchContext.restore({ view: v }), { cx, cy, scale }); await page.waitForTimeout(900); };
  const viewOf = async r => { const b = bbox(r), w = Math.max(30, (b.maxX - b.minX) * 1.8, (b.maxY - b.minY) * 1.8 * 1.5); await view((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 1500 / w * 0.75); };
  const shot = name => page.locator('#viewport').screenshot({ path: `${out}/${name}.png` });
  const panelShot = name => page.locator('.urban-parcel-inspection').screenshot({ path: `${out}/${name}-inspector.png` }).catch(() => {});
  const client = p => page.evaluate(q => { const m = document.getElementById('map').getScreenCTM(); const r = new DOMPoint(q.x, q.y).matrixTransform(m); return { x: r.x, y: r.y }; }, p);
  const clickWorld = async p => { const c = await client(p); await page.mouse.click(c.x, c.y); await page.waitForTimeout(500); };
  /** Clicks inside `ring` until the inspector shows a section of `scope` (samples the interior). */
  const clickInside = async (ring, scope) => {
    const b = bbox(ring), samples = [interior(ring)];
    for (let k = 1; k < 6; k++) for (let i = 1; i < 6; i++) { const p = { x: b.minX + (b.maxX - b.minX) * i / 6, y: b.minY + (b.maxY - b.minY) * k / 6 }; if (inside(ring, p)) samples.push(p); }
    for (const p of samples.slice(0, 12)) { await clickWorld(p); if (await page.locator(`.urban-parcel-inspection section[data-scope^="${scope}"]`).count()) return true; }
    report.errors.push(`no ${scope} section after clicking ${samples.length} points; inspector: ${(await page.locator('.urban-parcel-inspection').textContent().catch(() => '')).slice(0, 200)}`);
    return false;
  };
  const section = scope => page.locator(`.urban-parcel-inspection section[data-scope^="${scope}"]`).first();
  const sinceEdit = () => responses.length;
  const step = async (name, run, describe) => {
    const before = counts(), from = sinceEdit();
    await shot(`${name}-before`);
    await run();
    await idle();
    await page.waitForTimeout(800);
    await shot(`${name}-after`); await panelShot(`${name}-after`);
    const after = counts(), fresh = responses.slice(from);
    const entry = { name, before, after, requests: fresh.map(r => r.kind), errors: fresh.filter(r => r.error).map(r => r.error),
      editsBox: await page.locator('[data-city-edits]').textContent().catch(() => ''),
      inspector: (await page.locator('.urban-parcel-inspection').textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 900),
      engineStale: await page.locator('[data-engine-stale]').count(),
      warnings: [...new Set(fresh.flatMap(r => [...(r.layouts ?? []).flatMap(l => l.warnings), ...(r.partitions ?? []).flatMap(p => [...p.warnings, ...(p.programme?.warnings ?? [])])]).filter(w => /Retouche|introuvable/.test(w)))],
      ...(describe ? await describe(fresh) : {}) };
    report.steps.push(entry); console.log(JSON.stringify(entry));
    return entry;
  };

  // ---- choose a lot (plot, in a block with 3+ lots) and quarters away from it
  const { layout, partition } = plan();
  const byBlock = new Map();
  partition.parcels.forEach((p, i) => { if (!byBlock.has(p.block)) byBlock.set(p.block, []); byBlock.get(p.block).push(i); });
  const candidates = partition.parcels.map((p, i) => ({ p, i })).filter(({ p }) => p.id && p.use === 'plot' && byBlock.get(p.block).length >= 4 && area(p.shape.outer) > 120 && area(p.shape.outer) < 1500);
  const blockCount = new Map(); for (const b of layout.blocks) blockCount.set(b.quarter, (blockCount.get(b.quarter) ?? 0) + 1);
  const quartersByBlocks = [...blockCount.entries()].filter(([q]) => layout.quarters[q]).sort((a, b) => b[1] - a[1]).map(([q]) => q);
  const lotQuarter = c => layout.blocks[c.p.block]?.quarter;
  const lot = candidates.find(c => lotQuarter(c) === quartersByBlocks[0]) ?? candidates[0];
  const lotQ = lotQuarter(lot);
  const others = quartersByBlocks.filter(q => q !== lotQ && blockCount.get(q) >= 2);
  const [qReroll, qShape, qDelete] = [others[0], others[1], others[2]];
  report.choice = { lot: lot.p.id, lotQuarter: lotQ, qReroll, qShape, qDelete };
  const lotsInBlock = byBlock.get(lot.p.block).map(i => partition.parcels[i]);
  // Delete target: a plot of the same block whose neighbours are plots (so the merge has a survivor).
  const lotB = lotsInBlock.filter(p => p.id !== lot.p.id && p.use === 'plot' && area(p.shape.outer) > 60).sort((a, b) => area(a.shape.outer) - area(b.shape.outer))[0] ?? lotsInBlock.find(p => p.id !== lot.p.id);
  const lotC = lotsInBlock.find(p => p.id !== lot.p.id && p.id !== lotB.id && p.use === 'plot') ?? lotsInBlock.find(p => p.id !== lot.p.id && p.id !== lotB.id);
  const find = id => plan().partition.parcels.find(p => p.id === id);

  // 1. Reshape a parcel: drag one handle, add a vertex on an edge, « Valider ».
  await viewOf(lot.p.shape.outer);
  await step('1-parcel-reshape', async () => {
    await clickInside(lot.p.shape.outer, 'lot:');
    await section('lot:').locator('[data-shape-edit]').click();
    await page.waitForSelector('#cityShapeEditor .se-handle');
    await shot('1-parcel-reshape-editing');
    // Drag the first handle 6 m away from the lot centre (into a neighbour).
    const ring = lot.p.shape.outer, c = interior(ring);
    let far = 0; ring.forEach((p, i) => { if (Math.hypot(p.x - c.x, p.y - c.y) > Math.hypot(ring[far].x - c.x, ring[far].y - c.y)) far = i; });
    const v = ring[far], d = Math.hypot(v.x - c.x, v.y - c.y) || 1;
    const from = await client(v), to = await client({ x: v.x + (v.x - c.x) / d * 8, y: v.y + (v.y - c.y) / d * 8 });
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
    // Press an edge (between vertices 1 and 2): inserts a vertex, dragged 3 m outward.
    let long = 0; ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length], r = ring[(long + 1) % ring.length]; if (i !== far && (i + 1) % ring.length !== far && Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(r.x - ring[long].x, r.y - ring[long].y)) long = i; });
    const a = ring[long], b = ring[(long + 1) % ring.length], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dm = Math.hypot(m.x - c.x, m.y - c.y) || 1;
    const e0 = await client(m), e1 = await client({ x: m.x + (m.x - c.x) / dm * 3, y: m.y + (m.y - c.y) / dm * 3 });
    await page.mouse.move(e0.x, e0.y); await page.mouse.down(); await page.mouse.move(e1.x, e1.y, { steps: 5 }); await page.mouse.up();
    report.reshapeDraft = await page.locator('[data-se-count]').textContent();
    await shot('1-parcel-reshape-draft');
    await page.locator('[data-se-commit]').click();
  }, async () => { const now = find(lot.p.id); return { lotArea: [area(lot.p.shape.outer), now ? area(now.shape.outer) : null], sent: last('parcels').request.parcelConfig?.overrides?.parcels?.[lot.p.id] ? 'shape sent' : 'not sent' }; });

  // 1b. « Valider » without moving anything: no edit, no request (review defects 1 and 9).
  {
    const n = responses.length, target = find(lotC.id) ?? lotC;
    await viewOf(target.shape.outer);
    await clickInside(target.shape.outer, 'lot:');
    await section('lot:').locator('[data-shape-edit]').click();
    await page.waitForSelector('#cityShapeEditor .se-handle');
    const problem = await page.locator('[data-se-problem]').textContent();
    await shot('1b-unmoved-editing');
    await page.locator('[data-se-commit]').click(); await page.waitForTimeout(2500);
    report.unmoved = { requests: responses.length - n, problem, editorClosed: !(await page.locator('#cityShapeEditor').count()), edited: await page.evaluate(id => /parcel/.test(document.querySelector('[data-city-edits]')?.textContent ?? '') && id, target.id) };
    console.log(JSON.stringify({ unmoved: report.unmoved }));
  }
  // 1c. A service lot (market place): « Supprimer » and « Tirer au sort » are disabled (review defect 5).
  {
    const place = plan().partition.parcels.find(p => p.use === 'place' || p.use === 'reserve');
    if (place) {
      await viewOf(place.shape.outer); await clickInside(place.shape.outer, 'lot:');
      report.serviceLot = { use: place.use, deleteDisabled: await section('lot:').locator('[data-delete]').isDisabled(), saltDisabled: await section('lot:').locator('[data-salt-next]').isDisabled() };
      await panelShot('1c-service-lot'); console.log(JSON.stringify({ serviceLot: report.serviceLot }));
    }
  }

  // 2. Delete a parcel (merge with its neighbour), two-step confirm.
  await viewOf((find(lotB.id) ?? lotB).shape.outer);
  await step('2-parcel-delete', async () => {
    await clickInside((find(lotB.id) ?? lotB).shape.outer, 'lot:');
    report.deleteClicked = await section('lot:').getAttribute('data-scope');
    const del = section('lot:').locator('[data-delete]');
    await del.click(); await del.click();
  }, async () => ({ deletedStillPresent: !!find(lotB.id), survivor: plan().partition.parcels.find(p => (p.parentIds ?? []).includes(lotB.id))?.id ?? null }));

  // 3. Reroll a parcel.
  let roleBefore;
  await viewOf((find(lotC.id) ?? lotC).shape.outer);
  await step('3-parcel-reroll', async () => {
    await clickInside((find(lotC.id) ?? lotC).shape.outer, 'lot:');
    roleBefore = (await section('lot:').textContent()).replace(/\s+/g, ' ').slice(0, 200);
    await section('lot:').locator('[data-salt-next]').click();
  }, async () => ({ roleBefore, salt: await page.locator('.city-salt').first().textContent().catch(() => null) }));

  // 4. Reroll a quarter.
  const quarterView = async q => viewOf(plan().layout.quarters[q].shape.outer);
  const clickQuarter = async q => {
    const { layout: l } = plan(); const block = l.blocks.find(b => b.quarter === q && b.kind !== 'reserve') ?? l.blocks.find(b => b.quarter === q);
    await clickInside(block.shape.outer, 'quarter:');
  };
  const blocksOf = q => plan().layout.blocks.filter(b => b.quarter === q).map(b => JSON.stringify(b.shape)).sort().join('|');
  const othersOf = q => plan().layout.blocks.filter(b => b.quarter !== q).map(b => JSON.stringify(b.shape)).join('|');
  let rerollBefore, rerollOthers;
  await quarterView(qReroll);
  await step('4-quarter-reroll', async () => {
    rerollBefore = blocksOf(qReroll); rerollOthers = othersOf(qReroll);
    await clickQuarter(qReroll);
    await section('quarter:').locator('[data-salt-next]').click();
  }, async () => ({ quarterBlocksChanged: blocksOf(qReroll) !== rerollBefore, otherBlocksIdentical: othersOf(qReroll) === rerollOthers, salt: await section('quarter:').locator('.city-salt').textContent().catch(() => null) }));

  // 5. Reshape a quarter: drag the outermost vertex 40 m outward, « Valider ».
  let shapeBefore;
  await quarterView(qShape);
  await step('5-quarter-reshape', async () => {
    shapeBefore = plan().layout.quarters[qShape].shape.outer;
    await clickQuarter(qShape);
    await section('quarter:').locator('[data-shape-edit]').click();
    await page.waitForSelector('#cityShapeEditor .se-handle');
    const handles = await page.locator('#cityShapeEditor .se-handle').evaluateAll(els => els.map(e => ({ x: Number(e.getAttribute('cx')), y: Number(e.getAttribute('cy')) })));
    const c = interior(shapeBefore);
    let best = 0; handles.forEach((h, i) => { if (Math.hypot(h.x - c.x, h.y - c.y) > Math.hypot(handles[best].x - c.x, handles[best].y - c.y)) best = i; });
    const v = handles[best], d = Math.hypot(v.x - c.x, v.y - c.y) || 1;
    const from = await client(v), to = await client({ x: v.x + (v.x - c.x) / d * 40, y: v.y + (v.y - c.y) / d * 40 });
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    await shot('5-quarter-reshape-draft');
    await page.locator('[data-se-commit]').click();
  }, async () => ({ quarterArea: [area(shapeBefore), area(plan().layout.quarters[qShape].shape.outer)] }));

  // 6. Delete a quarter.
  await quarterView(qDelete);
  await step('6-quarter-delete', async () => {
    await clickQuarter(qDelete);
    const del = section('quarter:').locator('[data-delete]');
    await del.click(); await del.click();
  }, async () => ({ blocksLeft: plan().layout.blocks.filter(b => b.quarter === qDelete).length }));

  // MU1 round trip: the code carries the edits; a fresh tab rebuilds the same counts.
  const edited = counts();
  // Clipboard refused on purpose: the bench then writes the code into #situationInput.
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('headless')); });
  await page.locator('#situationCopy').click(); await page.waitForTimeout(800);
  const code = await page.locator('#situationInput').inputValue().catch(() => '');
  if (code.startsWith('MU1')) {
    const tab = await browser.newPage({ viewport: { width: 1500, height: 1000 } }), tabResponses = [];
    tab.on('response', async response => { if (!response.url().endsWith('/urban') || response.request().method() !== 'POST') return; try { const body = await response.json(); tabResponses.push(body.data ?? body); } catch { /* ignore */ } });
    const u = new URL(bench); u.searchParams.set('standalone', '1'); u.searchParams.set('profile', 'local'); u.searchParams.set('localServer', server); u.searchParams.set('situation', code);
    await tab.goto(u.href);
    await tab.waitForFunction(() => window.magnaBenchContext?.ready(), undefined, { timeout: 180000 });
    await tab.waitForTimeout(3000);
    for (const k of ['urbanQuarterStage', 'urbanParcelStage']) await tab.waitForFunction(kk => document.querySelector(`#${kk} [data-apply]`)?.getAttribute('aria-busy') !== 'true', k, { timeout: 600000 });
    await tab.waitForTimeout(2000);
    const l = tabResponses.filter(r => r.layouts).at(-1)?.layouts?.[0], p = tabResponses.filter(r => r.partitions).at(-1)?.partitions?.[0];
    report.mu1 = { codeLength: code.length, source: edited, reopened: l && p ? { quarters: l.quarters.length, blocks: l.blocks.length, streets: l.streets.length, parcels: p.parcels.length } : null };
    await tab.locator('#viewport').screenshot({ path: `${out}/7-mu1-reopened.png` });
    await tab.close();
  } else report.mu1 = { error: 'no MU1 code in #situationInput' };

  report.urlLength = await page.evaluate(() => location.href.length);
  // 8. Reset everything.
  await page.locator('#focusCity').click().catch(() => {}); await page.waitForTimeout(800);
  await step('8-reset', async () => { await page.locator('[data-edits-reset]').click(); }, async () => ({ backToBase: JSON.stringify(counts()) === JSON.stringify(base) }));
  await page.close();
} catch (error) { report.errors.push(String(error?.stack ?? error)); }
finally { await browser.close(); }
writeFileSync(`${out}/result.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ base: report.base, choice: report.choice, unmoved: report.unmoved, serviceLot: report.serviceLot, mu1: report.mu1, urlLength: report.urlLength, errors: report.errors }, null, 2));
