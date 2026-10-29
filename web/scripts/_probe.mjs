import { chromium } from 'playwright';
import { createServer } from 'vite';
const web = 'D:/workspace/self/magna-urbis/web';
const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1);
const server = await createServer({ configFile: web + '/vite.config.ts', mode: 'rustbench', logLevel: 'info', server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, clearScreen: false });
await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`; console.log(T(), 'vite', origin);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let n = 0;
page.on('request', r => { n++; });
page.on('pageerror', e => console.log(T(), 'pageerror', e.message.slice(0, 200)));
page.on('console', m => { if (m.type() !== 'log') console.log(T(), m.type(), m.text().slice(0, 200)); });
page.on('crash', () => console.log(T(), 'CRASH'));
page.goto(`${origin}/rustbench.html?profile=local&localServer=http://127.0.0.1:8791#terrain?seed=bench-matrix&width=3000`, { waitUntil: 'commit' }).catch(e => console.log('goto', e.message));
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const st = await page.evaluate(() => ({ frames: document.querySelectorAll('iframe').length, ready: document.querySelector('iframe')?.contentWindow?.magnaBenchContext?.ready?.(), t: JSON.stringify(document.querySelector('iframe')?.contentWindow?.magnaBenchTimings), status: document.querySelector('iframe')?.contentDocument?.querySelector('#status')?.textContent?.slice(0, 120) })).catch(e => e.message.slice(0, 80));
  console.log(T(), 'requests', n, JSON.stringify(st));
}
await page.screenshot({ path: 'D:/workspace/self/magna-urbis/web/out/bench-matrix/probe.png' });
await browser.close(); await server.close();
