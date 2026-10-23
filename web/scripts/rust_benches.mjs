import { build } from 'vite';
import { copyFile, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Assemble existing WASM packages and all benches beside their shared shell.
const outDir = fileURLToPath(new URL('../../rust/out/benches/', import.meta.url));
await rm(new URL('../../rust/out/benches/neuralbench.html', import.meta.url), { force: true });
for (const mode of ['terrainbench', 'citybench', 'urbanbench', 'urbaneditor', 'housebench', 'rustbench']) {
  await build({ mode, build: { outDir, emptyOutDir: false } });
}
await copyFile(new URL('../../rust/out/benches/rustbench.html', import.meta.url), new URL('../../rust/out/benches/index.html', import.meta.url));
const neuralAssets = new URL('../../rust/pkg/neural-web/', import.meta.url);
if (existsSync(neuralAssets)) {
  await cp(neuralAssets, new URL('../../rust/out/benches/neural/', import.meta.url), { recursive: true });
}
console.log(`Ateliers Rust : ${outDir}index.html`);
