import { beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
/** These tests exercise the Rust chain; rebuild both WASM packages with the port. */
beforeAll(async () => {
  const pkg = await import('../../rust/pkg/wasm/magna_urbis_wasm.js');
  const { adoptSingleWasm } = await import('../../rust/bridge/wasmRuntime');
  await adoptSingleWasm(async () => pkg.initSync({ module: readFileSync(new URL('../../rust/pkg/wasm/magna_urbis_wasm_bg.wasm', import.meta.url)) }));
});
