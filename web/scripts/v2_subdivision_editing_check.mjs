/** Real V2 selection, scoped model controls and atomic refusal, against the current native build.
 * Scope check: each selection edit (house roof, house reroll, parcel content, block density, quarter wealth) must change only
 * its element, and for a parcel/block the buildings on it: no street, other block, parcel, building or town changes.
 * Per-edit counts and regenerate wall times: web/out/subdivision-editing/report.json. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const out = fileURLToPath(new URL('../out/subdivision-editing/', import.meta.url));
await mkdir(out, { recursive: true });
const binary = process.env.MAGNA_LOCAL_BIN ?? fileURLToPath(new URL('../../rust/target/debug/magna-urbis-local.exe', import.meta.url));
const engine = spawn(binary, ['--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, MAGNA_LOCAL_ADDR: '127.0.0.1:0' } });
let browser, page, monitor, dev;
const errors = [];
const report = { edits: {}, errors };
const fail = [];
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native engine startup timed out')), 20000);
    let output = '';
    engine.stdout.on('data', chunk => {
      output += chunk;
      for (const line of output.split('\n'))
        try {
          const value = JSON.parse(line);
          if (value.ready && value.port) {
            clearTimeout(timer);
            resolve(value.port);
          }
        } catch {}
    });
    engine.once('error', reject);
    engine.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Native engine exited: ${code}`));
    });
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => {
    errors.push(error.stack ?? error.message);
    console.error(error.stack ?? error.message);
  });
  let base = process.env.MAGNA_V2_URL;
  if (!base) {
    dev = await createServer({ mode: 'rustbench', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
    await dev.listen();
    base = `http://127.0.0.1:${dev.httpServer.address().port}`;
  }
  await page.goto(`${base}/v2.html?empty&test=1&lang=fr&profile=local&localServer=${encodeURIComponent(`http://127.0.0.1:${port}`)}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__v2Test?.ready, undefined, { timeout: 240000 });
  monitor = setInterval(
    () =>
      void page
        .evaluate(() => ({ busy: document.querySelector('#app')?.getAttribute('aria-busy'), status: document.querySelector('#footer-status')?.textContent, progress: document.querySelector('#progress-label')?.textContent }))
        .then(state => console.log('V2 check:', JSON.stringify(state)))
        .catch(() => {}),
    20000,
  );
  await page.evaluate(async () => {
    await window.__v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 100, seed: 'local-house-editing', fortification: 'none' });
  });
  const generation = page.evaluate(() => window.__v2Test.run());
  await Promise.race([generation, new Promise((_, reject) => setTimeout(() => reject(new Error('V2 generation did not settle within 180 seconds')), 180000).unref())]);
  // Content snapshot of every native town: streets and blocks by content, parcels and buildings by id. Numbers are
  // compared at 1 mm (`h`); buildings also keep an exact hash (`x`) to tell float re-encoding from real changes.
  const snapshot = (remember = false) =>
    page.evaluate(remember => {
      const hash = (value, exact = false) => {
        const s = JSON.stringify(value, exact ? undefined : (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)) ?? '';
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
        return h.toString(36) + ':' + s.length;
      };
      const cities = window.__v2Test.world().debug.v2RustCities ?? {};
      if (remember) {
        window.__scopeRefs = { ...cities };
        window.__scopeScene = Object.fromEntries(Object.entries(cities).map(([key, c]) => [key, new Map((c.scene?.buildings ?? []).map(b => [b.id, b]))]));
      }
      const towns = {};
      for (const [key, c] of Object.entries(cities)) {
        const layout = c.layouts?.[0];
        const parcels = {};
        (c.partitions?.[0]?.parcels ?? []).forEach((p, i) => (parcels[p.id ?? `#${i}`] = { h: hash(p.shape), block: p.block }));
        const buildings = {};
        for (const b of c.scene?.buildings ?? []) {
          const content = [b.parcel_id, b.footprint, b.roof_footprint, b.courtyards, b.volumes, b.cartographic, b.recipe_id, b.variant_id, b.transform];
          buildings[b.id] = { h: hash(content), x: hash(content, true), parcel: b.parcel_id };
        }
        towns[key] = {
          streets: (layout?.streets ?? []).map(s => hash([s.path, s.widths, s.rank, s.role])),
          blocks: (layout?.blocks ?? []).map(b => hash([b.shape, b.kind, b.quarter])),
          blockQuarter: (layout?.blocks ?? []).map(b => b.quarter),
          quarters: (layout?.quarters ?? []).map(q => hash(q.shape)),
          parcels,
          buildings,
        };
      }
      return towns;
    }, remember);
  const identity = () => page.evaluate(() => Object.fromEntries(Object.entries(window.__v2Test.world().debug.v2RustCities ?? {}).map(([k, c]) => [k, window.__scopeRefs?.[k] === c])));
  const multisetDiff = (a, b) => {
    const count = new Map();
    for (const h of a) count.set(h, (count.get(h) ?? 0) + 1);
    let added = 0;
    for (const h of b) {
      const n = count.get(h) ?? 0;
      if (n) count.set(h, n - 1);
      else added++;
    }
    return { removed: [...count.values()].reduce((s, n) => s + n, 0), added };
  };
  /** Compares two snapshots of `key`; `scope` names what may change: { building } | { parcel } | { blocks: Set<index> }. */
  const compare = async (before, after, key, scope) => {
    const a = before[key],
      b = after[key];
    const streets = multisetDiff(a.streets, b.streets);
    const changedBlocks = [];
    for (let i = 0; i < Math.max(a.blocks.length, b.blocks.length); i++) if (a.blocks[i] !== b.blocks[i]) changedBlocks.push(i);
    const allowedBlocks = scope.blocks ?? new Set();
    const blocksOutside = changedBlocks.filter(i => !allowedBlocks.has(i));
    const parcelIds = new Set([...Object.keys(a.parcels), ...Object.keys(b.parcels)]);
    const inScopeParcel = id => (scope.parcel !== undefined ? id === scope.parcel : allowedBlocks.has(a.parcels[id]?.block) || allowedBlocks.has(b.parcels[id]?.block));
    const parcelsChanged = [...parcelIds].filter(id => a.parcels[id]?.h !== b.parcels[id]?.h);
    const parcelsOutside = parcelsChanged.filter(id => !inScopeParcel(id));
    const scopeParcels = new Set([...parcelIds].filter(inScopeParcel));
    const buildingIds = new Set([...Object.keys(a.buildings), ...Object.keys(b.buildings)]);
    const inScopeBuilding = id => (scope.building !== undefined ? id === scope.building : scopeParcels.has(a.buildings[id]?.parcel) || scopeParcels.has(b.buildings[id]?.parcel));
    const buildingsChanged = [...buildingIds].filter(id => a.buildings[id]?.h !== b.buildings[id]?.h);
    const buildingsOutside = buildingsChanged.filter(id => !inScopeBuilding(id));
    const buildingsOutsideExact = [...buildingIds].filter(id => a.buildings[id]?.x !== b.buildings[id]?.x && !inScopeBuilding(id)).length;
    // Which fields of the first out-of-scope buildings changed (1 mm rounding), and the largest footprint vertex move.
    const fields = await page.evaluate(
      ({ key, ids }) => {
        const old = window.__scopeScene?.[key],
          now = new Map((window.__v2Test.world().debug.v2RustCities[key].scene?.buildings ?? []).map(b => [b.id, b]));
        const round = v => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x));
        return ids.map(id => {
          const a = old?.get(id),
            b = now.get(id);
          if (!a || !b) return { id, fields: [!a ? 'added' : 'removed'] };
          const points = s => (s ?? []).flatMap(r => [...(r.outer ?? []), ...(r.holes ?? []).flat()]);
          const pa = points(a.footprint),
            pb = points(b.footprint);
          const move = pa.length === pb.length ? Math.max(0, ...pa.map((p, i) => Math.hypot(p.x - pb[i].x, p.y - pb[i].y))) : 'vertex count ' + pa.length + ' -> ' + pb.length;
          return { id, fields: Object.keys({ ...a, ...b }).filter(k => k !== 'resolved' && round(a[k]) !== round(b[k])), footprintMoveM: move };
        });
      },
      { key, ids: buildingsOutside.slice(0, 5) },
    );
    const status = (x, y) => (!x ? 'added' : !y ? 'removed' : 'changed');
    const same = await identity();
    const otherTowns = Object.keys(before)
      .filter(k => k !== key)
      .map(k => ({ key: k, sameObject: !!same[k], sameContent: JSON.stringify(before[k]) === JSON.stringify(after[k]) }));
    return {
      streetsChanged: streets.removed + streets.added ? streets : 0,
      streetCount: [a.streets.length, b.streets.length],
      quartersChanged: multisetDiff(a.quarters, b.quarters),
      blocksChanged: changedBlocks.length,
      blocksOutside: blocksOutside.length,
      blockCount: [a.blocks.length, b.blocks.length],
      parcelsChanged: parcelsChanged.length,
      parcelsOutside: parcelsOutside.length,
      parcelCount: [Object.keys(a.parcels).length, Object.keys(b.parcels).length],
      buildingsChanged: buildingsChanged.length,
      targetChanged: scope.building !== undefined ? buildingsChanged.includes(scope.building) : undefined,
      buildingsOutside: buildingsOutside.length,
      buildingsOutsideExact,
      buildingCount: [Object.keys(a.buildings).length, Object.keys(b.buildings).length],
      otherTownsChanged: otherTowns.filter(t => !t.sameContent).length,
      otherTowns,
      examples: {
        blocks: blocksOutside.slice(0, 5),
        parcels: parcelsOutside.slice(0, 5).map(id => ({ id, block: a.parcels[id]?.block ?? b.parcels[id]?.block, status: status(a.parcels[id], b.parcels[id]) })),
        buildings: buildingsOutside.slice(0, 5).map((id, i) => ({ id, parcel: a.buildings[id]?.parcel ?? b.buildings[id]?.parcel, status: status(a.buildings[id], b.buildings[id]), ...fields[i] })),
      },
    };
  };
  /** Clicks a regenerate control; measures click -> busy=false (then settled 1.5 s) -> exact 2D capture ready. */
  const regenerate = async click => {
    await page.evaluate(() => {
      const app = document.querySelector('#app');
      window.__regen = { start: performance.now(), seen: false, idle: undefined, change: performance.now() };
      window.__regenObs?.disconnect();
      window.__regenObs = new MutationObserver(() => {
        const busy = app.getAttribute('aria-busy');
        window.__regen.change = performance.now();
        if (busy === 'true') window.__regen.seen = true;
        else if (busy === 'false' && window.__regen.seen) window.__regen.idle = performance.now();
      });
      window.__regenObs.observe(app, { attributes: true, attributeFilter: ['aria-busy'] });
    });
    await click();
    await page.waitForFunction(
      () => {
        const r = window.__regen;
        return document.querySelector('#app').getAttribute('aria-busy') === 'false' && performance.now() - r.change > 1500 && (r.seen || performance.now() - r.start > 5000);
      },
      undefined,
      { timeout: 600000, polling: 100 },
    );
    return page.evaluate(async () => {
      const r = window.__regen;
      window.__regenObs.disconnect();
      const idle = r.idle ?? r.start;
      const capture = performance.now();
      await Promise.race([window.__v2Test.prepareCapture?.(), new Promise(resolve => setTimeout(resolve, 60000))]);
      return { busySeen: r.seen, busyMs: Math.round(idle - r.start), readyMs: Math.round(idle - r.start + performance.now() - capture) };
    });
  };
  const mainKey = await page.evaluate(() => window.__v2Test.world().settlements[0].key);
  /** One edit: snapshot, regenerate, compare; strict edits must change nothing outside their scope. */
  const scopedEdit = async (name, scope, click, strict = true) => {
    const before = await snapshot(true);
    const time = await regenerate(click);
    const after = await snapshot();
    const diff = await compare(before, after, mainKey, typeof scope === 'function' ? scope(before[mainKey]) : scope);
    const outside = (diff.streetsChanged ? 1 : 0) + diff.blocksOutside + diff.parcelsOutside + diff.buildingsOutside + diff.otherTownsChanged;
    const buildingRequests = await page.evaluate(key => window.__v2Test.world().debug.v2RustCities[key].lastBuildingRequests, mainKey);
    const entry = { strict, time, buildingRequests, ...diff, ok: outside === 0 };
    report.edits[name] = entry;
    console.log(
      `SCOPE ${name}: ${entry.ok ? 'PASS' : strict ? 'FAIL' : 'RECORDED'}`,
      JSON.stringify({
        streets: diff.streetsChanged,
        blocksOutside: diff.blocksOutside,
        parcelsOutside: diff.parcelsOutside,
        buildingsOutside: diff.buildingsOutside,
        buildingsOutsideExact: diff.buildingsOutsideExact,
        buildingsChanged: diff.buildingsChanged,
        buildingRequests,
        otherTownsChanged: diff.otherTownsChanged,
        time,
      }),
    );
    if (strict && !entry.ok) fail.push(name);
    return entry;
  };
  const setField = (selector, value) =>
    page.locator(selector).evaluate((input, value) => {
      for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  const pickLevel = async (level, point) => {
    await page.evaluate(level => {
      const select = document.querySelector('#inspect-target');
      select.value = level;
      select.dispatchEvent(new Event('change'));
    }, level);
    await page.mouse.click(point.screenX, point.screenY);
    await page.waitForTimeout(800);
  };
  const view = await page.evaluate(() => window.__v2Test.view('2d-core'));
  const box = await page.locator('#map').boundingBox();
  const candidates = await page.evaluate(() =>
    window.__v2Test
      .world()
      .urban.buildings.filter(b => b.nativeRequestId)
      .map(b => ({ id: b.nativeRequestId, parcel: b.nativeParcelId, x: b.poly.reduce((sum, p) => sum + p.x / b.poly.length, 0), y: b.poly.reduce((sum, p) => sum + p.y / b.poly.length, 0) })),
  );
  const house = candidates
    .map(b => ({ ...b, screenX: box.x + box.width / 2 + (b.x - view.cx) * view.scale, screenY: box.y + box.height / 2 + (b.y - view.cy) * view.scale }))
    .find(b => b.parcel && b.screenX > box.x + 50 && b.screenX < box.x + box.width * 0.55 && b.screenY > box.y + 100 && b.screenY < box.y + box.height - 80);
  assert(house, 'a house is visible in the map');
  await page.evaluate(() => {
    const inspect = document.querySelector('#inspect-mode');
    inspect.checked = true;
    inspect.dispatchEvent(new Event('change'));
    document.querySelector('#inspect-target').value = 'house';
  });
  await page.mouse.click(house.screenX, house.screenY);
  await page.locator('#house-native-controls [data-setting-path="pack"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#house-roof').count(), 0, 'native houses use a single generation editor');
  assert(await page.locator('[data-urban-selection] path').last().getAttribute('d'), 'selected house has an outline');
  assert(await page.locator('#house-native-controls [data-setting-path="culture"] option[value="myconid-colony"]').count(), 'individual fantasy styles are selectable');
  const styleCaption = await page.locator('#house-native-controls [data-field-path="culture"] .parameter-caption').textContent();
  // The house culture field is captioned by the shared urban field name (urbanFieldNames.culture), in French here.
  const cultureName = (await readFile(fileURLToPath(new URL('../src/v2/urbanControlSchema.ts', import.meta.url)), 'utf8')).match(/^\s*culture: \['([^']+)', '([^']+)'\]/m);
  assert(cultureName, 'urbanFieldNames.culture is readable');
  assert.equal(styleCaption, cultureName[2], 'the house culture caption uses the shared localized field name');
  await page.locator('#house-native-controls [data-setting-path="pack"]').evaluate(input => {
    for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  });
  await page.waitForFunction(() => {
    const pack = document.querySelector('#house-native-controls [data-setting-path="pack"]');
    return pack?.tagName === 'SELECT' ? pack.options.length > 1 : pack?.getAttribute('list');
  });
  await page.screenshot({ path: `${out}/selected-house.png` });
  const roof = page.locator('#house-native-controls [data-setting-path="overrides.roof"]');
  const originalFootprint = await page.evaluate(id => {
    const w = window.__v2Test.world();
    return w.debug.v2RustCities[w.settlements[0].key].scene.buildings.find(b => b.id === id).footprint;
  }, house.id);
  const allowed = 'RF-FLAT';
  await roof.selectOption(allowed);
  await scopedEdit('a-house-roof', { building: house.id }, () => page.locator('#house-native-apply').click());
  const recomputed = await page.evaluate(() => {
    const w = window.__v2Test.world();
    return w.debug.v2RustCities[w.settlements[0].key].lastBuildingRequests;
  });
  // Checked at the end with the scope results, so every edit below still runs and reports.
  report.edits['a-house-roof'].buildingRequests = recomputed;
  if (recomputed !== 1) fail.push(`a-house-roof replanned ${recomputed} building requests, not 1`);
  // Same footprint within 1 mm: the re-planned house comes back through another float encoding (~1e-6 m apart).
  const editedFootprint = await page.evaluate(id => {
    const w = window.__v2Test.world();
    return w.debug.v2RustCities[w.settlements[0].key].scene.buildings.find(b => b.id === id).footprint;
  }, house.id);
  const points = surface => surface.flatMap(ring => [...ring.outer, ...(ring.holes ?? []).flat()]);
  const [p0, p1] = [points(originalFootprint), points(editedFootprint)];
  assert(p0.length === p1.length && p0.every((p, i) => Math.hypot(p.x - p1[i].x, p.y - p1[i].y) < 1e-3), 'a procedural roof change preserves the existing footprint');
  assert.equal(await page.evaluate(id => window.__v2Test.world().urban.buildings.find(b => b.nativeRequestId === id).roof, house.id), 'flat', 'the edited roof is visible in the rendered city contract');
  await page.locator('#house-native-controls [data-setting-path="overrides.roof"]').waitFor({ state: 'attached' });
  assert(await page.locator('[data-urban-selection] path').last().getAttribute('d'), 'selection survives an accepted edit');
  const reroll = await scopedEdit('b-house-reroll', { building: house.id }, () => page.locator('#house-reroll').click());
  // The dice draws another variant of that house, and of that house only.
  if (!reroll.targetChanged) fail.push('b-house-reroll left the house unchanged');
  await page.locator('#house-native-controls [data-setting-path="overrides.roof"]').waitFor({ state: 'attached' });
  const before = await page.evaluate(() => {
    const w = window.__v2Test.world();
    return JSON.stringify(w.debug.v2RustCities[w.settlements[0].key].scene);
  });
  const nextRoof = page.locator('#house-native-controls [data-setting-path="overrides.roof"]');
  await nextRoof.evaluate(input => {
    for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  });
  // The roof is a select of the known systems: offer an unknown one to provoke the engine refusal.
  await nextRoof.evaluate(select => {
    const option = document.createElement('option');
    option.value = 'RF-INVALID';
    select.append(option);
    select.value = 'RF-INVALID';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#house-native-apply').click();
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  assert.equal(
    await page.evaluate(() => {
      const w = window.__v2Test.world();
      return JSON.stringify(w.debug.v2RustCities[w.settlements[0].key].scene);
    }),
    before,
    'a refused roof keeps every existing building',
  );
  assert(await page.locator('[data-urban-selection] path').last().getAttribute('d'), 'selection survives the refusal');
  assert(await page.locator('#toast').isVisible(), 'the engine refusal is visible');

  // The selected house's parcel, block and quarter, hit-tested at its point as the subdivision inspector does.
  const place = await page.evaluate(
    ({ key, x, y }) => {
      const c = window.__v2Test.world().debug.v2RustCities[key];
      const inside = (ring, p) => {
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].y > p.y !== ring[j].y > p.y && p.x < ((ring[j].x - ring[i].x) * (p.y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) hit = !hit;
        return hit;
      };
      const parcel = c.partitions[0].parcels.find(p => inside(p.shape.outer, { x, y }) && !p.shape.holes?.some(h => inside(h, { x, y })));
      return parcel && { parcel: parcel.id, block: parcel.block, quarter: c.layouts[0].blocks[parcel.block].quarter };
    },
    { key: mainKey, x: house.x, y: house.y },
  );
  assert(place, 'the selected house stands on a parcel');
  report.place = { ...place, house: house.id, houseParcel: house.parcel };

  // (c) Parcel content, then Regenerate area.
  await pickLevel('parcel', house);
  const role = page.locator('#subdivision-controls select[data-setting-path="role"]');
  await role.waitFor({ state: 'attached' });
  const roles = await role.locator('option').evaluateAll(list => list.filter(o => o.value && !o.disabled).map(o => o.value));
  const currentRole = await page.evaluate(({ key, id }) => window.__v2Test.world().debug.v2RustCities[key].programmePartitions?.[0]?.programme?.allocations.find(a => a.parcelId === id)?.role, { key: mainKey, id: place.parcel });
  const nextRole = ['commerce.tavern', ...roles].find(r => roles.includes(r) && r !== currentRole && !r.startsWith('dwelling'));
  assert(nextRole, 'another parcel content is offered');
  await role.selectOption(nextRole);
  report.place.roles = { from: currentRole, to: nextRole };
  await scopedEdit('c-parcel-content', { parcel: place.parcel }, () => page.locator('#subdivision-apply').click());

  // (d) Block density, then Regenerate area.
  await pickLevel('block', house);
  const density = '#subdivision-controls input[data-setting-path="density"]';
  await page.locator(density).waitFor({ state: 'attached' });
  await setField(density, '1.6');
  await scopedEdit('d-block-density', { blocks: new Set([place.block]) }, () => page.locator('#subdivision-apply').click());

  // (e) Quarter wealth: only the blocks of that quarter (their lots and buildings) may change.
  await pickLevel('quarter', house);
  const wealth = '#subdivision-controls [data-setting-path="wealth"]';
  await page.locator(wealth).waitFor({ state: 'attached' });
  await setField(wealth, '0.9');
  await scopedEdit(
    'e-quarter-wealth',
    town => ({ blocks: new Set(town.blockQuarter.flatMap((q, i) => (q === place.quarter ? [i] : []))) }),
    () => page.locator('#subdivision-apply').click(),
  );
  await page.locator('#map-advanced-open').click();
  await page.locator('#name-visibility-controls').waitFor();
  assert.equal(await page.locator('[data-name-category="buildings"]').isChecked(), false);
  assert.equal(await page.locator('[data-name-category="districts"]').isChecked(), false);
  assert.equal(await page.locator('#name-detail').getAttribute('type'), 'range');
  await page.screenshot({ path: `${out}/names-advanced.png` });
  Object.assign(report, { selected: house.id, outline: true, styleSelector: true, styleCaption, acceptedRoof: allowed, recomputed, footprintPreserved: true, refusalRetainsScene: true, quietDefaults: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(fail, [], `selection edits changed elements outside their scope: ${fail.join(', ')}`);
  report.passed = true;
  console.log('V2 subdivision editing check passed');
} catch (error) {
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error('Browser errors:', errors);
  report.passed = false;
  report.failure = String(error?.stack ?? error);
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
  clearInterval(monitor);
  await browser?.close();
  await dev?.close();
  engine.kill();
}
