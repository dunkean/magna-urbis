import { defineConfig, normalizePath, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
        res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
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

export default defineConfig(({ mode }) => ({
  root: 'src/ui',
  plugins: [viteSingleFile(), neuralServe(), ...(mode === 'rustbench' ? [rustBenchEntry()] : []), ...(['terrainbench', 'rustbench'].includes(mode) ? [terrainWasmReload(), decorServe()] : []), ...(['housebench', 'rustbench'].includes(mode) ? [housesWasmReload()] : [])],
  // Keep third-party notices inside the self-contained offline bundle.
  esbuild: { legalComments: 'inline' },
  optimizeDeps: mode === 'housebench' ? { entries: ['housebench.html'] } : mode === 'rustbench' ? { entries: ['rustbench.html', 'terrainbench.html', 'urbanbench.html', 'housebench.html'] } : undefined,
  server: ['terrainbench', 'housebench', 'rustbench'].includes(mode) ? { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } } : undefined,
  build: {
    target: 'es2022',
    outDir: mode === 'rustbench' ? fileURLToPath(new URL('../rust/out/benches', import.meta.url)) : mode === 'housebench' ? fileURLToPath(new URL('../rust/out/houses', import.meta.url)) : mode === 'terrainbench' || mode === 'urbanbench' || mode === 'urbaneditor' ? fileURLToPath(new URL('../rust/out/browser', import.meta.url)) : '../../dist',
    emptyOutDir: !['testbench', 'urbanbench', 'urbaneditor', 'rustbench'].includes(mode),
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      ...(mode === 'testbench' || mode === 'urbaneditor' ? { input: 'src/ui/testbench.html' } : {}),
      ...(mode === 'terrainbench' ? { input: 'src/ui/terrainbench.html' } : {}),
      ...(mode === 'urbanbench' ? { input: 'src/ui/urbanbench.html' } : {}),
      ...(mode === 'housebench' ? { input: 'src/ui/housebench.html' } : {}),
      ...(mode === 'rustbench' ? { input: 'src/ui/rustbench.html' } : {}),
      output: { banner: vendorNotice },
    },
  },
  worker: { format: mode === 'housebench' ? 'iife' : 'es', rollupOptions: { output: { banner: vendorNotice } } },
}));
