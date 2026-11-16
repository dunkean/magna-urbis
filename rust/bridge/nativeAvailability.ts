import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';

const HEALTH_TTL_MS = 3000;
const HEALTH_TIMEOUT_MS = 1500;
const REQUEST_TIMEOUT_MS = 300000;
const health = new Map<string, { until: number; result: Promise<boolean> }>();
const failures = new Set<(server: string) => void>();
const origin = (server: string) => server.replace(/\/+$/, '');
/** A run also observes optional bridges that can already recover through WASM themselves. */
export function onNativeConnectionFailure(listener: (server: string) => void): () => void {
  failures.add(listener);
  return () => { failures.delete(listener); };
}

/** The name survives the bridges that serialize errors as strings across workers.
 * Only transport failures receive it; HTTP/JSON engine errors remain ordinary errors. */
export class NativeConnectionError extends Error {
  constructor(readonly server: string) {
    super('NativeConnectionError: Native engine is unreachable.');
    this.name = 'NativeConnectionError';
  }
  override toString(): string { return this.message; }
}
export function isNativeConnectionFailure(error: unknown): boolean {
  return error instanceof NativeConnectionError
    || /(?:^|\b)NativeConnectionError: Native engine is unreachable\./.test(error instanceof Error ? error.message : String(error));
}
export function markNativeUnavailable(server: string): void {
  health.set(origin(server), { until: Date.now() + HEALTH_TTL_MS, result: Promise.resolve(false) });
}

/** Bound both fetch and body reads, including streamed architecture replies. Parse errors
 * are deliberately outside this boundary: invalid JSON is an engine bug, not a disconnect. */
export async function nativeFetch(runtime: ExecutionRuntime, path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Native request timed out.', 'TimeoutError')), timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const failure = (): unknown => {
    clearTimeout(timer);
    if (init.signal?.aborted && init.signal.reason?.name !== 'TimeoutError') return init.signal.reason;
    markNativeUnavailable(runtime.server);
    failures.forEach(listener => listener(runtime.server));
    return new NativeConnectionError(runtime.server);
  };
  let response: Response;
  try { response = await fetch(`${origin(runtime.server)}${path}`, { ...init, signal }); }
  catch { throw failure(); }
  if (!response.body) { clearTimeout(timer); return response; }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { clearTimeout(timer); stream.close(); }
        else stream.enqueue(chunk.value);
      } catch { stream.error(failure()); }
    },
    cancel(reason) { clearTimeout(timer); return reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** A short, deduplicated check of the existing endpoint; no service startup or downloads. */
export function nativeRuntimeAvailable(runtime: ExecutionRuntime): Promise<boolean> {
  if (runtime.profile !== 'local') return Promise.resolve(false);
  const server = origin(runtime.server), known = health.get(server);
  if (known && known.until > Date.now()) return known.result;
  const entry = { until: Infinity, result: Promise.resolve(false) };
  entry.result = (async () => {
    try {
      const response = await nativeFetch(runtime, '/status', { cache: 'no-store' }, HEALTH_TIMEOUT_MS);
      const status = await response.json() as { service?: string; backend?: string };
      return response.ok && status.service === 'magna-urbis-local' && status.backend === 'rust-native';
    } catch { return false; }
    finally { entry.until = Date.now() + HEALTH_TTL_MS; }
  })();
  health.set(server, entry);
  return entry.result;
}
