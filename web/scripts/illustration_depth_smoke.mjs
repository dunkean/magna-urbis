import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  await page.route(base + '/depth-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Depth capture fixture</body></html>' }));
  await page.goto(base + '/depth-fixture');
  const result = await page.evaluate(async () => {
    const { captureWebGlFrame } = await import('/illustrationDepth.ts');
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true });
    gl.clearColor(.25, .5, .75, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(24, 16, 48, 32); gl.clearDepth(.3); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.scissor(48, 16, 24, 32); gl.clearDepth(.6); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.scissor(36, 16, 12, 32); gl.clearDepth(.45); gl.clear(gl.DEPTH_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
    const captured = captureWebGlFrame(gl, 1, 100);
    const pixels = captured.depth.getContext('2d').getImageData(0, 0, 96, 64).data;
    const at = x => pixels[(32 * 96 + x) * 4];
    return { error: gl.getError(), background: [...pixels.slice(0, 4)], near: at(30), middle: at(40), far: at(60),
      color: [...captured.color.getContext('2d').getImageData(0, 0, 1, 1).data] };
  });
  assert.equal(result.error, 0); assert.equal(result.background[0], 0); assert.equal(result.near, 255);
  assert.ok(result.middle > result.far && result.middle < result.near); assert.equal(result.far, 1);
  assert.ok(Math.abs(result.color[1] - 128) <= 1); console.log('Exact WebGL depth capture passed', result);
} finally { await browser.close(); }
