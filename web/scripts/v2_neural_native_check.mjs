/** Real GPU smoke check: serve twice, verify physical metadata and restart determinism. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const match = /^--(binary|weights)=(.+)$/.exec(arg); if (!match) throw Error(`Invalid argument: ${arg}`); return [match[1], match[2]]; }));
const binary = resolve(args.binary ?? `${root}/rust/target/release/magna-urbis-neural${process.platform === 'win32' ? '.exe' : ''}`);
const weights = resolve(args.weights ?? `${root}/release-v2/models`);
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function once() {
  const child = spawn(binary, ['serve', '--weights', weights, '--address', '127.0.0.1:0'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '', errors = '', port, spawnError;
  child.on('error', error => { spawnError = error; });
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-12000); });
  child.stdout.on('data', chunk => {
    text += chunk;
    for (const line of text.split('\n')) { try { const value = JSON.parse(line); if (value.ready) port = value.port; } catch {} }
  });
  try {
    const deadline = Date.now() + 120000;
    let ready;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, errors);
      if (port) {
        try { ready = await (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) })).json(); } catch {}
        if (ready?.state === 'error') throw Error(`${ready.message}\n${errors}`);
        if (ready?.state === 'ready') break;
      }
      await sleep(250);
    }
    assert.equal(ready?.state, 'ready', errors);
    assert.equal(ready.service, 'magna-urbis-neural');
    const response = await fetch(`http://127.0.0.1:${port}/generate?seed=desktop-release&relief=hills&extent=40000&sampleSpacing=1000`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error(await response.text());
    const bytes = Buffer.from(await response.arrayBuffer()), heights = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const meta = JSON.parse(response.headers.get('X-Neural-Meta'));
    assert.equal(meta.extent, 40000); assert.equal(meta.resolution, 40); assert.equal(meta.nativeCellM, 30); assert.equal(meta.nativeResolution, 1334);
    assert.equal(meta.profile, 'coarse4-nf4-b75-t2-decoder'); assert.equal(heights.length, 1600); assert.ok(heights.every(Number.isFinite));
    return { sha256: createHash('sha256').update(bytes).digest('hex'), meta };
  } finally {
    if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  }
}
const first = await once(), restarted = await once();
assert.equal(first.sha256, restarted.sha256, 'Same seed and models must reproduce after restarting the native service');
console.log(JSON.stringify({ ok: true, profile: first.meta.profile, heights: 1600, restartDeterministic: true, sha256: first.sha256, firstMs: first.meta.totalMs, restartedMs: restarted.meta.totalMs }, null, 2));
