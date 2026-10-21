// Derive a synchronous GPU texture array from the existing Fantasy artwork.
// Run from web/: node scripts/pack_forest_brushes.mjs
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { zlibSync } from 'fflate';

const assets = new URL('../src/render/assets/fantasy/families/runtime/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', assets), 'utf8'));
const families = ['pines', 'broadleaf', 'tropical', 'cypress'];
const size = 128, layers = [], coverage = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const family of families) {
    const meta = manifest[family];
    const source = 'data:image/webp;base64,' + (await readFile(new URL(meta.file, assets))).toString('base64');
    const result = await page.evaluate(async ({ source, meta, size }) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const result = [];
      for (let variant = 0; variant < 8; variant++) {
        const [x, y, w, h] = meta.rects[variant + 8];
        const scale = (size - 8) / Math.max(w, h), dw = w * scale, dh = h * scale;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(image, x, y, w, h, (size - dw) / 2, (size - dh) / 2, dw, dh);
        const rgba = ctx.getImageData(0, 0, size, size).data;
        let area = 0, sum = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          const a = rgba[i + 3] / 255;
          area += a; sum += a * (.2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2]);
        }
        const mean = sum / area, rg = new Uint8Array(size * size * 2);
        for (let i = 0, p = 0; i < rgba.length; i += 4, p += 2) {
          rg[p] = rgba[i + 3];
          const luminance = .2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2];
          rg[p + 1] = rgba[i + 3] ? Math.round(128 + 96 * Math.max(-1, Math.min(1, (luminance - mean) / Math.max(mean, 20)))) : 128;
        }
        result.push({ data: Array.from(rg), coverage: area / (size * size) });
      }
      return result;
    }, { source, meta, size });
    for (const layer of result) { layers.push(Uint8Array.from(layer.data)); coverage.push(layer.coverage); }
  }
} finally { await browser.close(); }
const bytes = zlibSync(Buffer.concat(layers), { level: 9 });
const result = { size, families, variants: 8, channels: 'R coverage, G centered luminance; RG8 texture array', coverage, zlib: Buffer.from(bytes).toString('base64') };
await writeFile(new URL('../src/render/assets/fantasy/forest-brushes.json', import.meta.url), JSON.stringify(result) + '\n');
console.log(`${families.length * 8} Fantasy brushes, ${size}px, ${bytes.length} compressed bytes`);
