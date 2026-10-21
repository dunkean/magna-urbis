// Derive a synchronous GPU texture array from the overhead canopy/shrub artwork.
// Run from web/: node scripts/pack_forest_brushes.mjs
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { zlibSync } from 'fflate';

const assets = new URL('../src/render/assets/fantasy/families/', import.meta.url);
const families = ['pines', 'broadleaf', 'tropical', 'cypress', 'shrubs', 'dry-shrubs'];
const size = 128, layers = [], coverage = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const family of families) {
    const shrub = family === 'shrubs' || family === 'dry-shrubs';
    const meta = shrub ? { file: 'shrubs.png', columns: 4, rows: 4, offset: family === 'shrubs' ? 0 : 8 }
      : { file: 'canopy-overhead.png', columns: 8, rows: 4, offset: families.indexOf(family) * 8 };
    const source = 'data:image/png;base64,' + (await readFile(new URL(meta.file, assets))).toString('base64');
    const result = await page.evaluate(async ({ source, meta, size }) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const cutout = document.createElement('canvas');
      cutout.width = Math.round(image.width / meta.columns); cutout.height = Math.round(image.height / meta.rows);
      const scan = cutout.getContext('2d', { willReadFrequently: true });
      const result = [];
      for (let variant = 0; variant < 8; variant++) {
        const index = variant + meta.offset, cw = image.width / meta.columns, ch = image.height / meta.rows;
        let x = (index % meta.columns) * cw, y = Math.floor(index / meta.columns) * ch, w = cw, h = ch;
        // Trim only the transparent atlas margin. The sprite's foliage diameter,
        // rather than the source sheet's arbitrary gutter, sets its world size.
        scan.clearRect(0, 0, cutout.width, cutout.height);
        scan.drawImage(image, x, y, w, h, 0, 0, cutout.width, cutout.height);
        const alpha = scan.getImageData(0, 0, cutout.width, cutout.height).data;
        let left = cutout.width, top = cutout.height, right = -1, bottom = -1;
        for (let row = 0; row < cutout.height; row++) for (let col = 0; col < cutout.width; col++) {
          if (alpha[(row * cutout.width + col) * 4 + 3] < 8) continue;
          left = Math.min(left, col); right = Math.max(right, col); top = Math.min(top, row); bottom = Math.max(bottom, row);
        }
        if (right < left) throw new Error('Empty brush cell');
        x += left * cw / cutout.width; y += top * ch / cutout.height;
        w = (right - left + 1) * cw / cutout.width; h = (bottom - top + 1) * ch / cutout.height;
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
console.log(`${families.length * 8} overhead canopy/shrub brushes, ${size}px, ${bytes.length} compressed bytes`);
