// Vitest setup: the synchronous Rust bridges (`generate()`, land use, site, urban) need the core WASM package
// initialised before the first call, as the page does with `await loadCoreWasm()`.
// It runs in `beforeAll`, after the test file registered its `vi.mock`s: a file that mocks the runtime or the
// package (no real `initSync`) keeps its own doubles, and a failed load never fails a file by itself.
import { beforeAll } from 'vitest';

beforeAll(async () => {
  try {
    const pkg = await import('../../../rust/pkg/wasm/magna_urbis_wasm.js');
    if (typeof pkg.initSync !== 'function') return;
    const runtime = await import('../../../rust/bridge/wasmRuntime');
    if (typeof runtime.loadCoreWasm === 'function') await runtime.loadCoreWasm();
  } catch (error) {
    if (!/export is defined on the .* mock/.test(String(error))) console.warn('Core WASM not loaded for this test file:', error instanceof Error ? error.message : error);
  }
}, 120000);
