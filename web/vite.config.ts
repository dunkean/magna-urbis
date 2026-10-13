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

export default defineConfig(({ mode }) => ({
  root: 'src/ui',
  plugins: [viteSingleFile(), ...(mode === 'terrainbench' ? [terrainWasmReload(), decorServe()] : []), ...(mode === 'housebench' ? [housesWasmReload()] : [])],
  // Keep third-party notices inside the self-contained offline bundle.
  esbuild: { legalComments: 'inline' },
  optimizeDeps: mode === 'housebench' ? { entries: ['housebench.html'] } : undefined,
  server: mode === 'terrainbench' || mode === 'housebench' ? { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } } : undefined,
  build: {
    target: 'es2022',
    outDir: mode === 'housebench' ? fileURLToPath(new URL('../rust/out/houses', import.meta.url)) : mode === 'terrainbench' || mode === 'neuralbench' || mode === 'urbanbench' ? fileURLToPath(new URL('../rust/out/browser', import.meta.url)) : '../../dist',
    emptyOutDir: mode !== 'testbench' && mode !== 'neuralbench' && mode !== 'urbanbench',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      ...(mode === 'testbench' ? { input: 'src/ui/testbench.html' } : {}),
      ...(mode === 'terrainbench' ? { input: 'src/ui/terrainbench.html' } : {}),
      ...(mode === 'neuralbench' ? { input: 'src/ui/neuralbench.html' } : {}),
      ...(mode === 'urbanbench' ? { input: 'src/ui/urbanbench.html' } : {}),
      ...(mode === 'housebench' ? { input: 'src/ui/housebench.html' } : {}),
      output: { banner: vendorNotice },
    },
  },
  worker: { format: mode === 'housebench' ? 'iife' : 'es', rollupOptions: { output: { banner: vendorNotice } } },
}));
