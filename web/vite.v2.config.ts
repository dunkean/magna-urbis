import { defineConfig, normalizePath, type Plugin } from 'vite';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const web = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(web, '..');
const output = resolve(web, 'dist-v2');
const vendorNotice = '/*! polygon-clipping 0.15.7\n' + readFileSync(new URL('./src/vendor/polygonClipping.LICENSE.md', import.meta.url), 'utf8') + '\n*/';

/** Keep WASM/workers external so large binaries are downloaded once and cached. */
function externalAssets(): Plugin {
  return { name: 'v2-shared-external-assets', enforce: 'pre', apply: 'build',
    async resolveId(source, importer) {
      if (!/[?&]inline\b/.test(source) || !/[?&](?:url|worker)\b/.test(source)) return null;
      return this.resolve(source.replace(/&inline\b/, ''), importer, { skipSelf: true });
    },
  };
}

/** Inline WASM outside Vite's root otherwise remains cached after prepare:v2. */
function wasmReload(): Plugin {
  const directories = ['wasm', 'houses'].map(name => normalizePath(resolve(root, `rust/pkg/${name}`)) + '/');
  let timer: ReturnType<typeof setTimeout> | undefined;
  return { name: 'v2-wasm-reload', apply: 'serve',
    configureServer(server) {
      for (const directory of directories) server.watcher.add(directory);
      server.httpServer?.once('close', () => clearTimeout(timer));
    },
    handleHotUpdate({ file, server }) {
      if (!directories.some(directory => normalizePath(file).startsWith(directory)) || !/\.(?:js|wasm)$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        server.moduleGraph.invalidateAll();
        if (server.config.server.hmr !== false) server.ws.send({ type: 'full-reload', path: '*' });
      }, 200);
      return [];
    },
  };
}

function v2Resources(): Plugin {
  const sources = [
    { prefix: '/scientific/', directory: resolve(root, 'docs/scientific') },
    { prefix: '/neural/', directory: resolve(root, 'rust/pkg/neural-web') },
  ];
  return {
    name: 'v2-resources',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/' || pathname === '/index.html') {
          res.writeHead(302, { Location: `/v2.html${new URL(req.url ?? '/', 'http://localhost').search}` }); res.end(); return;
        }
        for (const source of sources) {
          if (!pathname.startsWith(source.prefix)) continue;
          let relative: string;
          try { relative = decodeURIComponent(pathname.slice(source.prefix.length)) || 'index.html'; } catch { next(); return; }
          const path = resolve(source.directory, relative);
          if (!path.startsWith(source.directory + sep) || !existsSync(path) || !statSync(path).isFile()) { next(); return; }
          const extension = path.split('.').pop();
          res.setHeader('Content-Type', ({ html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream');
          createReadStream(path).pipe(res); return;
        }
        next();
      });
    },
    async closeBundle() {
      // index.html works at /magna-urbis/v2/ on GitHub Pages and inside Tauri.
      if (existsSync(resolve(output, 'v2.html'))) await rename(resolve(output, 'v2.html'), resolve(output, 'index.html'));
      // Desktop's explicit entry also supports direct links and development parity.
      if (existsSync(resolve(output, 'index.html'))) await cp(resolve(output, 'index.html'), resolve(output, 'v2.html'));
      await mkdir(output, { recursive: true });
      // Copy only the optional neural runtime, never local model caches or Python environments.
      for (const source of sources) if (existsSync(source.directory)) await cp(source.directory, resolve(output, source.prefix.slice(1)), {
        recursive: true,
        filter: path => !path.endsWith('.gitignore') && !path.endsWith('.ts') && !path.endsWith('.mjs'),
      });
      // GitHub Pages must not run Jekyll over the bundled asset tree.
      const { writeFile } = await import('node:fs/promises');
      await writeFile(resolve(output, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  root: resolve(web, 'src/ui'),
  base: './',
  cacheDir: resolve(web, 'out/.vite-v2'),
  plugins: [externalAssets(), v2Resources(), wasmReload()],
  esbuild: { legalComments: 'inline' },
  // Cross-origin isolation for the WASM threads package (static hosting: public/coi-serviceworker.js).
  server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { allow: [root] }, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  build: {
    outDir: output, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 6000,
    rollupOptions: { input: resolve(web, 'src/ui/v2.html'), output: { banner: vendorNotice } },
  },
  worker: { format: 'es', plugins: () => [externalAssets()], rollupOptions: { output: { banner: vendorNotice } } },
});
