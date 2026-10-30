/**
 * Compiles the generated WGSL of the WebGPU map renderer (src/ui/terrainWgsl.generated.ts) in a headless
 * Chrome (Tint), on top of naga's validation in `npm run shaders:wgsl`. Exits 1 on any error.
 *
 *   npm run shaders:wgsl:check
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import * as generated from '../src/ui/terrainWgsl.generated';

const modules = Object.fromEntries(Object.entries(generated).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
// WebGPU needs a secure context: a local page, not about:blank.
const server = createServer((_, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>wgsl</title>'); }).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  const result = await page.evaluate(async modules => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return { adapter: 'none', modules: {} as Record<string, string[]> };
    const device = await adapter.requestDevice();
    const out: Record<string, string[]> = {};
    for (const [key, code] of Object.entries(modules)) {
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      out[key] = info.messages.filter(m => m.type === 'error').map(m => `${m.lineNum}:${m.linePos} ${m.message}`);
    }
    return { adapter: `${adapter.info.vendor} ${adapter.info.architecture}`, modules: out };
  }, modules);
  console.log(`adapter: ${result.adapter}`);
  let failed = result.adapter === 'none';
  for (const [key, errors] of Object.entries(result.modules)) {
    console.log(`${key}: ${errors.length ? errors.join('; ') : 'ok'}`);
    failed ||= errors.length > 0;
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close(); server.close();
}
