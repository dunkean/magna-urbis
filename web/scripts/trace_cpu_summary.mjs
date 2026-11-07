// Summarise V8 CPU samples of a Chrome trace per thread: self and inclusive ms per function.
// node scripts/trace_cpu_summary.mjs trace.json [top=40]
import { readFileSync } from 'node:fs';
const trace = JSON.parse(readFileSync(process.argv[2], 'utf8')), top = Number(process.argv[3] ?? 40);
const events = trace.traceEvents ?? trace;
const names = new Map();
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
const profiles = new Map();
for (const e of events) {
  if (e.name !== 'ProfileChunk' && e.name !== 'Profile') continue;
  const key = `${e.pid}:${e.id}`; let p = profiles.get(key);
  if (!p) profiles.set(key, p = { thread: `${e.pid}:${e.tid}`, nodes: new Map(), samples: [], deltas: [] });
  if (e.name === 'Profile') { p.thread = `${e.pid}:${e.tid}`; continue; }
  const d = e.args.data; if (!d) continue;
  for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
  p.samples.push(...(d.cpuProfile?.samples ?? [])); p.deltas.push(...(d.timeDeltas ?? []));
}
for (const p of profiles.values()) {
  const label = n => { const f = n.callFrame; return `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber + 1}`; };
  const selfMs = new Map(), incl = new Map(); let total = 0, idle = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.deltas[i + 1] ?? 0) / 1000; const n = p.nodes.get(p.samples[i]); if (!n) continue;
    const fn = n.callFrame.functionName;
    if (fn === '(idle)' || fn === '(program)' && false) { idle += dt; continue; }
    total += dt; const l = label(n); selfMs.set(l, (selfMs.get(l) ?? 0) + dt);
    const seen = new Set(); for (let c = n; c; c = p.nodes.get(c.parent)) { const cl = label(c); if (!seen.has(cl)) { seen.add(cl); incl.set(cl, (incl.get(cl) ?? 0) + dt); } }
  }
  if (total < 200) continue;
  // parent links
  console.log(`\n### thread ${names.get(p.thread) ?? p.thread} busy ${Math.round(total)} ms idle ${Math.round(idle)} ms`);
  console.log('-- self'); for (const [l, ms] of [...selfMs].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${Math.round(ms).toString().padStart(7)}  ${l}`);
  console.log('-- inclusive'); for (const [l, ms] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${Math.round(ms).toString().padStart(7)}  ${l}`);
}
