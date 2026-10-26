// Read-only git source loader: build both benchmark modules with the same
// esbuild options. No checkout, source-tree rewrite or generated WASM required.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { revision: { type: 'string' }, out: { type: 'string' } } });
if (!values.revision || !/^[a-f0-9]{7,40}$/.test(values.revision) || !values.out) throw Error('--revision FROZEN_GIT_SHA --out NEW_BUNDLE_DIRECTORY');
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repository = resolve(web, '..'), out = resolve(values.out);
mkdirSync(out, { recursive: true });
const stdin = { contents: 'export * from "./src/surface/compiler.ts";export * from "./src/surface/materials.ts";', resolveDir: web };
for (const mode of ['baseline', 'optimized']) await build({ stdin, bundle: true, platform: 'node', format: 'esm', outfile: resolve(out, mode + '.mjs'),
  plugins: mode === 'baseline' ? [{ name: 'frozen-git-source', setup(plugin) {
    plugin.onLoad({ filter: /\.(ts|js)$/ }, args => {
      const path = relative(repository, args.path).replaceAll('\\', '/');
      if (!path.startsWith('web/src/surface/')) throw Error('Unexpected reference dependency: ' + path);
      return { contents: execFileSync('git', ['show', values.revision + ':' + path], { cwd: repository, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }), loader: args.path.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(args.path) };
    });
  } }] : [] });
console.log(JSON.stringify({ baselineRevision: execFileSync('git', ['rev-parse', values.revision], { cwd: repository, encoding: 'utf8' }).trim(), out }));
