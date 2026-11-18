// From web/: node scripts/nav_fps_table.mjs <label>
// Compares the nine input sequences, with fast and slow navigation split like yesterday's table.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [label] = process.argv.slice(2);
if (!label || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(label)) throw new Error('node scripts/nav_fps_table.mjs <label>');
const OUT = resolve('out/nav-fps', label);
const load = mode => {
  const file = `${OUT}/${mode}.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const runs = { compositor: load('compositor'), classic: load('classic') };
if (!runs.compositor && !runs.classic) throw new Error(`No reports in ${OUT}`);
const round = n => Math.round(n * 100) / 100;
const q = (values, f) => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? round(s[Math.min(s.length - 1, Math.floor(f * s.length))]) : null;
};
const fmt = v => (v == null ? '-' : String(v));
const dist = v => (v.length ? `${fmt(q(v, 0.5))}/${fmt(q(v, 0.95))}/${fmt(q(v, 1))}` : '-');
const styles = [...new Set(Object.values(runs).flatMap(r => Object.keys(r?.gestures ?? {}).map(k => k.split(':')[0])))];
const gestures = (run, style, pick) =>
  Object.entries(run?.gestures ?? {})
    .filter(([k, v]) => k.startsWith(style + ':') && pick(k.split(':')[1]) && !v.frozen)
    .map(([, v]) => v);
const row = g => {
  if (!g.length) return 'missing';
  const sum = f => g.reduce((s, v) => s + f(v), 0),
    max = f => Math.max(...g.map(f));
  const slowestP95 = max(v => v.p95 ?? 0),
    settled = g.map(v => v.settleMs).filter(v => v >= 0);
  const cpu = g.flatMap(v => v.live?.frameMs ?? []),
    gpu = g.flatMap(v => v.live?.gpuMs ?? []);
  const tasks = key => `${sum(v => v[key].n)}/${sum(v => v[key].sum)}/${max(v => v[key].max)}`;
  return `${fmt(
    q(
      g.map(v => v.fpsP50),
      0.5,
    ),
  )}/${slowestP95 > 0 ? round(1000 / slowestP95) : '-'} | ${dist(cpu)} | ${dist(gpu)} | ${tasks('long')} | ${tasks('restLong')} | ${fmt(q(settled, 0.5))}/${settled.length ? Math.max(...settled) : '-'} (${g.length - settled.length} timed out) | ${sum(v => v.live?.frames ?? 0)}`;
};

console.log(`Navigation FPS: ${label}`);
console.log('FPS = median gesture p50 FPS / FPS equivalent of the worst gesture p95 gap (higher is better).');
console.log('Uncapped rAF callback throughput is not monitor scan-out or a guaranteed count of presented map frames.');
console.log('Columns: FPS | compositor CPU p50/p95/max ms | GPU p50/p95/max ms | long during n/sum/max ms | long after n/sum/max ms | settle median/worst ms (timeouts) | compositor frames');
console.log('CPU/GPU quantiles pool recorded frame samples; GPU contains only queries resolved by input completion. Missing GPU samples are unavailable, never zero.');
console.log('Long tasks split at the last actual input event; after windows end after each bounded settle/quiet wait (observedAfterMs).');
console.log("rAF and CPU/GPU windows retain yesterday's final input gap (inputTailMs); settle is relative to the actual last input and sampled every 20 ms, including that gap.");
for (const [mode, r] of Object.entries(runs)) {
  if (!r) {
    console.log(`WARNING ${mode}: report missing`);
    continue;
  }
  if (r.error || r.reloaded) console.log(`INVALID/PARTIAL ${mode}: ${r.error ?? 'page reloaded'}`);
  if (r.skippedStyles?.length) console.log(`WARNING ${mode}: skipped styles ${r.skippedStyles.join(', ')}`);
  const rows = Object.values(r.gestures);
  for (const style of styles) {
    const n = gestures(r, style, () => true).length;
    if (n !== 9) console.log(`WARNING ${mode} ${style}: ${n}/9 gestures recorded`);
  }
  if (rows.some(v => !v.live?.available)) console.log(`WARNING ${mode}: __muLive missing in some/all gestures (older build); rAF/classic stats still recorded`);
  if (rows.some(v => !v.longTaskSupported)) console.log(`WARNING ${mode}: Long Tasks API unavailable`);
  if (rows.some(v => v.live?.samplesCapped || v.dropped)) console.log(`WARNING ${mode}: frame sample buffers capped; inspect JSON`);
  if (rows.some(v => v.live?.mode && v.live.mode !== mode)) console.log(`WARNING ${mode}: page reported a different live policy`);
}
if (runs.compositor && runs.classic) {
  for (const key of ['profile', 'extent', 'towns', 'seed', 'viewport', 'dpr', 'headed', 'world']) {
    if (JSON.stringify(runs.compositor[key]) !== JSON.stringify(runs.classic[key])) console.log(`WARNING modes differ in ${key}; inspect both reports before comparison`);
  }
}
for (const [name, pick] of [
  ['all nine gestures', () => true],
  ['fast wheel + pan (7 gestures)', k => !k.startsWith('wheel-slow')],
  ['slow wheel (2 gestures)', k => k.startsWith('wheel-slow')],
]) {
  console.log(`\n${name}`);
  for (const style of styles) {
    for (const [mode, run] of Object.entries(runs)) console.log(`${style.padEnd(14)} ${mode.padEnd(10)} ${row(gestures(run, style, pick))}`);
  }
}
console.log('\nCompositor policy and layers over all gestures (observed once per changed compositor frame; may miss frames).');
for (const style of styles) {
  const g = gestures(runs.compositor, style, () => true),
    policy = {},
    layers = {};
  for (const v of g) {
    for (const [key, count] of Object.entries(v.live?.activeObservations ?? {})) policy[key] = (policy[key] ?? 0) + count;
    for (const [name, s] of Object.entries(v.live?.observations ?? {})) {
      const a = (layers[name] ??= { observations: 0, ready: 0, standIn: 0, drawCalls: 0, triangles: 0, maxDrawCalls: 0, maxTriangles: 0 });
      for (const key of ['observations', 'ready', 'standIn', 'drawCalls', 'triangles']) a[key] += s[key];
      a.maxDrawCalls = Math.max(a.maxDrawCalls, s.maxDrawCalls);
      a.maxTriangles = Math.max(a.maxTriangles, s.maxTriangles);
    }
  }
  console.log(`${style}: active:reason observations ${JSON.stringify(policy)}`);
  if (!Object.keys(layers).length) console.log('  no live layer observations');
  for (const [name, s] of Object.entries(layers)) {
    console.log(`  ${name.padEnd(8)} live-ready ${s.ready}/${s.observations}, stand-in ${s.standIn}/${s.observations}; calls mean/max ${round(s.drawCalls / s.observations)}/${s.maxDrawCalls}; triangles mean/max ${round(s.triangles / s.observations)}/${s.maxTriangles}`);
  }
}
console.log('\nClassic vector engine liveParts (per-part worst across gestures, in the original units).');
for (const style of styles) {
  for (const [mode, run] of Object.entries(runs)) {
    const parts = {};
    for (const v of gestures(run, style, () => true)) for (const [key, value] of Object.entries(v.parts ?? {})) parts[key] = Math.max(parts[key] ?? 0, value);
    console.log(`${style.padEnd(14)} ${mode.padEnd(10)} ${JSON.stringify(parts)}`);
  }
}

// package.json currently declares no PNG decoder. Do not import Playwright's private/transitive codecs or add one.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
if (!deps.pngjs && !deps.sharp) {
  console.log('\nRest screenshot mean absolute pixel difference: skipped (no PNG decoder declared in web/package.json).');
} else {
  let decode;
  if (deps.pngjs) {
    const { PNG } = await import('pngjs');
    decode = file => PNG.sync.read(readFileSync(file));
  } else {
    const { default: sharp } = await import('sharp');
    decode = async file => {
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    };
  }
  console.log('\nRest screenshot mean absolute RGBA pixel difference (0..255; exact and navigation-rest).');
  for (const style of styles)
    for (const camera of ['full', 'town', 'close', 'town-after'])
      for (const kind of ['exact', 'live']) {
        const a = runs.compositor?.rest?.[`${style}:${camera}`],
          b = runs.classic?.rest?.[`${style}:${camera}`];
        if (!a || !b || !existsSync(`${OUT}/${a[kind]}`) || !existsSync(`${OUT}/${b[kind]}`)) {
          console.log(`${style} ${camera} ${kind}: missing pair`);
          continue;
        }
        if (JSON.stringify(a.view) !== JSON.stringify(b.view)) {
          console.log(`${style} ${camera} ${kind}: camera mismatch; skipped`);
          continue;
        }
        const [A, B] = await Promise.all([decode(`${OUT}/${a[kind]}`), decode(`${OUT}/${b[kind]}`)]);
        if (A.width !== B.width || A.height !== B.height || A.data.length !== B.data.length) {
          console.log(`${style} ${camera} ${kind}: dimensions differ; skipped`);
          continue;
        }
        let difference = 0;
        for (let i = 0; i < A.data.length; i++) difference += Math.abs(A.data[i] - B.data[i]);
        console.log(`${style} ${camera} ${kind}: ${round(difference / A.data.length)}`);
      }
}
