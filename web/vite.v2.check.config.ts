import { defineConfig, mergeConfig } from 'vite';
import config from './vite.v2.config';

/** Keep integration tests stable while other contributors edit the live V2 UI. */
export default defineConfig(mergeConfig(config, {
  server: { port: 5175, strictPort: true, hmr: false },
}));
