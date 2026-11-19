/** Sample the existing WASM's Rust symbols through Chromium's CPU profiler. No Rust rebuild. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const endpoint = process.env.MAGNA_EMBED_CHECK_URL ?? 'http://127.0.0.1:5187/embed.html';
const url = new URL(endpoint);
url.search = new URLSearchParams({ preview: '1', name: 'Brackenford', population: '2500', seed: '12340007', river: '0', coast: '0', walls: '1', cultureBase: 'English' }).toString();
const host = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><iframe style="width:640px;height:440px;border:0" sandbox="allow-scripts allow-same-origin" src="${url.href.replaceAll('&', '&amp;')}"></iframe>`);
});
await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
let timer;
try {
  const root = await browser.newBrowserCDPSession();
  const pending = new Map();
  let id = 0;
  root.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
    const reply = JSON.parse(message),
      key = `${sessionId}:${reply.id}`,
      waiter = pending.get(key);
    if (waiter) {
      pending.delete(key);
      reply.error ? waiter.reject(new Error(reply.error.message)) : waiter.resolve(reply.result);
    }
  });
  const command = (sessionId, method, params = {}) =>
    new Promise((resolve, reject) => {
      const number = ++id;
      pending.set(`${sessionId}:${number}`, { resolve, reject });
      root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: number, method, params }) }).catch(reject);
    });
  let resolveStarted, rejectStarted, startEpoch;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  // Avoid an unhandled rejection if attachment fails before the preview finishes loading.
  void started.catch(() => {});
  let attaching = false;
  const attach = async ({ targetInfo }) => {
    if (attaching || targetInfo.type !== 'worker' || !targetInfo.url.includes('/engine.worker-')) return;
    attaching = true;
    try {
      const { sessionId } = await root.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false });
      await command(sessionId, 'Profiler.enable');
      await command(sessionId, 'Profiler.setSamplingInterval', { interval: 1000 });
      startEpoch = Date.now();
      await command(sessionId, 'Profiler.start');
      resolveStarted(sessionId);
    } catch (error) {
      rejectStarted(error);
    }
  };
  root.on('Target.targetCreated', attach);
  root.on('Target.targetInfoChanged', attach);
  await root.send('Target.setDiscoverTargets', { discover: true });
  const context = await browser.newContext({ viewport: { width: 700, height: 500 } });
  await context.addInitScript(() => {
    window.__cpuStages = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'progress') window.__cpuStages.push({ at: performance.timeOrigin + performance.now(), ...data.progress });
        });
      }
      // Keep the worker available for Profiler.stop after its result; context.close releases it.
      terminate() {}
    };
  });
  const page = await context.newPage();
  timer = setTimeout(() => {
    void browser.close();
  }, 90000);
  await page.goto(`http://127.0.0.1:${host.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe').locator('html[data-state="ready"],html[data-state="error"]').waitFor({ timeout: 75000 });
  const sessionId = await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('Profiler did not attach')), 10000))]);
  const { profile } = await command(sessionId, 'Profiler.stop');
  const frame = page.frames().find(frame => frame.url().startsWith(new URL(endpoint).origin));
  const stages = await frame.evaluate(() => window.__cpuStages);
  const layoutStart = stages.find(stage => stage.stage === 'urban-layout').at;
  const layoutEnd = stages.find(stage => stage.stage === 'urban-parcels').at;
  const nodes = new Map(profile.nodes.map(node => [node.id, node])),
    parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const exclusive = new Map(),
    inclusive = new Map(),
    owners = new Map();
  let time = 0,
    samples = 0;
  const add = (map, key, ms) => map.set(key, (map.get(key) ?? 0) + ms);
  for (let i = 0; i < profile.samples.length; i++) {
    const ms = profile.timeDeltas[i] / 1000;
    time += ms;
    if (startEpoch + time < layoutStart || startEpoch + time > layoutEnd) continue;
    samples++;
    const node = nodes.get(profile.samples[i]);
    add(exclusive, node.callFrame.functionName, ms);
    const seen = new Set();
    let owner;
    for (let at = node.id; at !== undefined; at = parents.get(at)) {
      const name = nodes.get(at).callFrame.functionName;
      if (!seen.has(name)) {
        add(inclusive, name, ms);
        seen.add(name);
      }
      if (!owner && /magna_urbis_core.*::urban::/.test(name)) owner = name;
    }
    add(owners, owner ?? node.callFrame.functionName, ms);
  }
  const top = map =>
    [...map]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  const summary = { approximateLayoutMs: Math.round(layoutEnd - layoutStart), samples, exclusive: top(exclusive), inclusive: top(inclusive), owners: top(owners) };
  await mkdir('out/city-embed', { recursive: true });
  await writeFile('out/city-embed/layout.cpuprofile', JSON.stringify(profile));
  await writeFile('out/city-embed/layout-cpu-summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  clearTimeout(timer);
  await browser.close();
  await new Promise(resolve => host.close(resolve));
}
