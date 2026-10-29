import { defineConfig, normalizePath, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { surfaceLivePlugin } from './scripts/surface_live_plugin';

const vendorNotice = '/*! polygon-clipping 0.15.7\n' + readFileSync(new URL('./src/vendor/polygonClipping.LICENSE.md', import.meta.url), 'utf8') + '\n*/';

function terrainWasmReload(): Plugin {
  const packageDir = normalizePath(fileURLToPath(new URL('../rust/pkg/wasm/', import.meta.url)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    name: 'terrain-wasm-reload',
    apply: 'serve',
    configureServer(server) {
      // Inline URL assets outside Vite's root are not automatically watched.
      server.watcher.add(packageDir);
      server.httpServer?.once('close', () => clearTimeout(timer));
    },
    handleHotUpdate({ file, server }) {
      if (!normalizePath(file).startsWith(packageDir) || !/\.(js|wasm)$/.test(file)) return;
      // wasm-pack writes the binary and bindings separately. Reload the pair
      // together, including cached inline assets and the worker's imports.
      clearTimeout(timer);
      timer = setTimeout(() => {
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload', path: '*' });
      }, 200);
      return [];
    },
  };
}

/** Urban Bench decors (web/decors, written by scripts/export_decors.mjs), served at /decors/. */
function decorServe(): Plugin {
  const dir = fileURLToPath(new URL('./decors/', import.meta.url));
  return {
    name: 'decor-serve', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/decors', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = dir + name;
        if (!/^[\w.-]+$/.test(name) || !existsSync(file) || !statSync(file).isFile()) { next(); return; }
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}

function housesWasmReload(): Plugin {
  const packageDir = normalizePath(fileURLToPath(new URL('../rust/pkg/houses/', import.meta.url)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    name: 'houses-wasm-reload', apply: 'serve',
    configureServer(server) {
      server.watcher.add(packageDir);
      server.httpServer?.once('close', () => clearTimeout(timer));
    },
    handleHotUpdate({ file, server }) {
      if (!normalizePath(file).startsWith(packageDir) || !/\.(js|wasm)$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { server.moduleGraph.invalidateAll(); server.ws.send({ type: 'full-reload', path: '*' }); }, 200);
      return [];
    },
  };
}

function neuralServe(): Plugin {
  const dir = fileURLToPath(new URL('../rust/pkg/neural-web/', import.meta.url));
  return { name: 'neural-web-assets', apply: 'serve', configureServer(server) {
    server.middlewares.use('/neural', (req, res, next) => {
      const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
      if (!/^(?:models\/)?[\w.-]+$/.test(name)) { next(); return; }
      const file = dir + name;
      if (!existsSync(file) || !statSync(file).isFile()) { next(); return; }
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  } };
}

/** Shared external assets for the normal build: `?url&inline` WASM and
 * `?worker&inline` workers resolve to one hashed file each in `assets/`, so the
 * terrain WASM is not embedded as base64 in every worker and page. The explicit
 * offline export (`--mode <bench>-offline` or MAGNA_SINGLE_FILE=1) keeps the
 * self-contained single HTML file. */
function externalAssets(): Plugin {
  return {
    name: 'magna-external-assets', apply: 'build', enforce: 'pre',
    async resolveId(source, importer) {
      if (!/[?&]inline\b/.test(source) || !/[?&](?:url|worker)\b/.test(source)) return null;
      return this.resolve(source.replace(/&inline\b/, ''), importer, { skipSelf: true });
    },
  };
}

function rustBenchEntry(): Plugin {
  return { name: 'rust-bench-entry', apply: 'serve', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/' && url.pathname !== '/index.html') { next(); return; }
      res.writeHead(302, { Location: `/rustbench.html${url.search}` });
      res.end();
    });
  } };
}

/** COEP credentialless keeps no-cors cross-origin loads working without CORP
 * (Chromium, Firefox); Safari ignores it and simply stays non-isolated. */
const isolationHeaders = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default defineConfig(({ mode: requested, command }) => {
  // `<bench>-offline` builds the same bench as one self-contained file.
  const offline = requested.endsWith('-offline') || process.env.MAGNA_SINGLE_FILE === '1', mode = requested.replace(/-offline$/, '');
  const single = command === 'serve' || offline;
  return {
  // Keep generated caches inside this checkout even when dependencies are shared.
  cacheDir: fileURLToPath(new URL('./out/.vite-cache/', import.meta.url)),
  root: 'src/ui',
  base: single ? undefined : './',
  plugins: [surfaceLivePlugin(), ...(single ? [viteSingleFile()] : [externalAssets()]), neuralServe(), ...(mode === 'rustbench' ? [rustBenchEntry()] : []), ...(['terrainbench', 'citybench', 'rustbench'].includes(mode) ? [terrainWasmReload(), decorServe()] : []), ...(['housebench', 'rustbench'].includes(mode) ? [housesWasmReload()] : [])],
  // Keep third-party notices inside the self-contained offline bundle.
  esbuild: { legalComments: 'inline' },
  optimizeDeps: mode === 'housebench' ? { entries: ['housebench.html'] } : mode === 'rustbench' ? { entries: ['rustbench.html', 'terrainbench.html', 'citybench.html', 'urbanbench.html', 'housebench.html'] } : undefined,
  // Cross-origin isolation (SharedArrayBuffer) for the WASM threads package. Static
  // hosting (github.io) gets the same through public/coi-serviceworker.js.
  server: { headers: isolationHeaders, ...(['terrainbench', 'citybench', 'housebench', 'rustbench'].includes(mode) ? { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } } : {}) },
  preview: { headers: isolationHeaders },
  build: {
    target: 'es2022',
    outDir: mode === 'rustbench' ? fileURLToPath(new URL('../rust/out/benches', import.meta.url)) : mode === 'housebench' ? fileURLToPath(new URL('../rust/out/houses', import.meta.url)) : mode === 'terrainbench' || mode === 'citybench' || mode === 'urbanbench' || mode === 'urbaneditor' ? fileURLToPath(new URL('../rust/out/browser', import.meta.url)) : '../../dist',
    emptyOutDir: !['testbench', 'citybench', 'urbanbench', 'urbaneditor', 'rustbench'].includes(mode),
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      ...(mode === 'testbench' || mode === 'urbaneditor' ? { input: 'src/ui/testbench.html' } : {}),
      ...(mode === 'terrainbench' ? { input: 'src/ui/terrainbench.html' } : {}),
      ...(mode === 'citybench' ? { input: 'src/ui/citybench.html' } : {}),
      ...(mode === 'urbanbench' ? { input: 'src/ui/urbanbench.html' } : {}),
      ...(mode === 'housebench' ? { input: 'src/ui/housebench.html' } : {}),
      ...(mode === 'rustbench' ? { input: 'src/ui/rustbench.html' } : {}),
      output: { banner: vendorNotice },
    },
  },
  worker: { format: mode === 'housebench' ? 'iife' : 'es', plugins: () => single ? [] : [externalAssets()], rollupOptions: { output: { banner: vendorNotice } } },
  };
});
