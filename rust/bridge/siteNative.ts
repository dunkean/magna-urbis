// Main-town site choice (`chooseSite`) in Rust: native `/site/choose` in the local profile, the `site_choose`
// WASM export otherwise. Same framed wire format both ways (siteWire.ts, rust/crates/core/src/site.rs).
import type { Options } from '../../web/src/gen/options';
import type { SiteLayer, TerrainLayer } from '../../web/src/gen/types';
import type { Rng } from '../../web/src/gen/core/rng';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { nativeRequest } from './nativeEngine';
import { loadCoreWasm } from './wasmRuntime';
import { encodeSiteRequest, decodeSiteReply } from './siteWire';

const nativeServers = new Map<string, Promise<boolean>>();
function nativeAvailable(runtime: ExecutionRuntime): Promise<boolean> {
  let known = nativeServers.get(runtime.server);
  if (!known) {
    known = fetch(`${runtime.server.replace(/\/$/, '')}/status`, { cache: 'no-store' }).then(r => r.json())
      .then((status: { capabilities?: unknown }) => Array.isArray(status.capabilities) && status.capabilities.includes('site.choose-v1'), () => false);
    nativeServers.set(runtime.server, known);
    void known.then(ok => { if (!ok) nativeServers.delete(runtime.server); });
  }
  return known;
}

/** Rust `chooseSite`: the same SiteLayer as the TypeScript one (same random draws, same chosen site). */
export async function chooseSiteRust(terrain: TerrainLayer, opts: Options, mapSize: number, root: Rng, runtime?: ExecutionRuntime, displayOnly = false): Promise<SiteLayer> {
  const body = encodeSiteRequest(terrain, opts, mapSize, root, displayOnly);
  const { w: n, cell } = terrain.height;
  if (runtime?.profile === 'local' && await nativeAvailable(runtime)) {
    // Consume the whole reply body so the keep-alive connection is free.
    const reply = new Uint8Array(await (await nativeRequest(runtime, '/site/choose', new Blob([body]))).arrayBuffer());
    return decodeSiteReply(reply, n, cell, displayOnly);
  }
  const wasm = await loadCoreWasm() as unknown as { site_choose?: (request: Uint8Array) => Uint8Array };
  if (typeof wasm.site_choose !== 'function') throw new Error('Rust/WASM site_choose export missing: rebuild the WASM packages.');
  return decodeSiteReply(wasm.site_choose(body), n, cell, displayOnly);
}
