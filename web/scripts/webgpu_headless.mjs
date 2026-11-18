/**
 * Headless Chrome with a real WebGPU adapter on the RTX 5090 (Windows, two NVIDIA cards, RDP session).
 *
 * What works (2026-11-16, Chrome 157, Playwright 1.63):
 *   channel 'chrome' (Playwright's bundled Chromium is not installed), default ANGLE (D3D11),
 *   `--enable-unsafe-webgpu --ignore-gpu-blocklist --use-adapter-luid=<high>,<low>` with the 5090 LUID.
 * What does NOT work:
 *   `--use-angle=vulkan` (with or without VK_LOADER_DEVICE_ID_FILTER): WebGL runs on Vulkan but
 *   `navigator.gpu.requestAdapter()` returns null for every powerPreference ("No available adapters").
 *   Without the LUID flag WebGPU and WebGL land on the 4090 (display GPU).
 *   `--use-adapter-luid=0x...` (hex) is ignored; the format is decimal `high,low`.
 * The LUID changes at every reboot, so it is read from chrome://gpu (line `DEVICE=0x2b85 ... LUID={h,l}`).
 * Override with MAGNA_TEST_ADAPTER_LUID=h,l or pick another card with MAGNA_GPU_DEVICE_ID=0x2684.
 *
 *   import { launchWebGpuChrome } from './webgpu_headless.mjs';
 *   const browser = await launchWebGpuChrome();          // chromium.launch options may be passed
 *   node scripts/webgpu_headless.mjs                      // one-line check: prints the adapter
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const BASE_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];

/** Reads `high,low` LUID of the card with the given PCI device id from chrome://gpu. */
export async function findAdapterLuid(deviceId = process.env.MAGNA_GPU_DEVICE_ID ?? '0x2b85') {
  if (process.env.MAGNA_TEST_ADAPTER_LUID) return process.env.MAGNA_TEST_ADAPTER_LUID;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: BASE_ARGS, timeout: 30000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto('chrome://gpu');
    const want = `device=${deviceId.toLowerCase()}`;
    for (let attempt = 0; attempt < 60; attempt++) {
      const text = await page.evaluate(() => {
        const walk = n => (n.shadowRoot ? walk(n.shadowRoot) : '') + [...n.childNodes].map(c => (c.nodeType === 3 ? c.textContent : walk(c) + '\n')).join('');
        return walk(document.body);
      });
      const line = text.split('\n').find(l => l.toLowerCase().includes(want) && l.includes('LUID='));
      const match = line?.match(/LUID=\{(\d+),(\d+)\}/);
      if (match) return `${match[1]},${match[2]}`;
      await page.waitForTimeout(250);
    }
    throw new Error(`no adapter with ${want} in chrome://gpu`);
  } finally {
    await browser.close();
  }
}

/** Launches headless Chrome whose WebGL and WebGPU both run on the selected card (default: RTX 5090). */
export async function launchWebGpuChrome(options = {}) {
  const luid = await findAdapterLuid();
  return chromium.launch({ channel: 'chrome', headless: true, timeout: 30000, ...options, args: [...BASE_ARGS, `--use-adapter-luid=${luid}`, ...(options.args ?? [])] });
}

/** Returns a one-line description of the WebGPU adapter and WebGL renderer seen by a page. */
export async function describeAdapter(page) {
  return page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const webgl = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'none';
    return `webgpu=${adapter ? `${adapter.info.vendor}/${adapter.info.architecture}` : 'none'} webgl=${webgl}`;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // WebGPU needs a secure context: serve a blank local page.
  const server = createServer((_, r) => {
    r.setHeader('content-type', 'text/html');
    r.end('<!doctype html><title>gpu</title>');
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await launchWebGpuChrome();
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const line = await describeAdapter(page);
    console.log(line);
    process.exitCode = line.startsWith('webgpu=none') ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}
