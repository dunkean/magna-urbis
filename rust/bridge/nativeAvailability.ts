import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { recordNativeBuild } from './engineIdentity';

const HEALTH_TTL_MS = 3000;
const HEALTH_TIMEOUT_MS = 1500;
const REQUEST_TIMEOUT_MS = 300000;
const health = new Map<string, { until: number; result: Promise<boolean> }>();
const failures = new Set<(server: string) => void>();
const origin = (server: string) => server.replace(/\/+$/, '');
/** A run also observes optional bridges that can already recover through WASM themselves. */
export function onNativeConnectionFailure(listener: (server: string) => void): () => void {
  failures.add(listener);
  return () => {
    failures.delete(listener);
  };
}

/** The name survives the bridges that serialize errors as strings across workers.
 * Only transport failures receive it; HTTP/JSON engine errors remain ordinary errors. */
export class NativeConnectionError extends Error {
  constructor(readonly server: string) {
    super('NativeConnectionError: Native engine is unreachable.');
    this.name = 'NativeConnectionError';
  }
  override toString(): string {
    return this.message;
  }
}
export function isNativeConnectionFailure(error: unknown): boolean {
  return error instanceof NativeConnectionError || /(?:^|\b)NativeConnectionError: Native engine is unreachable\./.test(error instanceof Error ? error.message : String(error));
}
/** Counts only time in which the event loop ran: a page stalled by synchronous WASM or rendering
 * must not let an overdue timer abort a reply that already arrived (a healthy engine seen offline). */
export function responsiveTimeout(timeoutMs: number, onTimeout: () => void): () => void {
  const step = Math.min(250, Math.max(50, timeoutMs / 10));
  let spent = 0,
    last = Date.now(),
    timer: ReturnType<typeof setTimeout>;
  const tick = (): void => {
    const now = Date.now();
    spent += Math.min(now - last, step);
    last = now;
    if (spent >= timeoutMs) onTimeout();
    else timer = setTimeout(tick, Math.min(step, timeoutMs - spent));
  };
  timer = setTimeout(tick, Math.min(step, timeoutMs));
  return () => clearTimeout(timer);
}
export function markNativeUnavailable(server: string): void {
  health.set(origin(server), { until: Date.now() + HEALTH_TTL_MS, result: Promise.resolve(false) });
}

const RESTART_WAIT_MS = 10000,
  RESTART_POLL_MS = 500,
  RESTART_PROBE_MS = 1000;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** An engine restart takes a few seconds: poll /status until it answers again (bounded). */
export async function waitForNativeRestart(server: string, signal?: AbortSignal | null, waitMs = RESTART_WAIT_MS): Promise<boolean> {
  for (let waited = 0; waited <= waitMs && !signal?.aborted; waited += RESTART_POLL_MS) {
    const controller = new AbortController(),
      stop = responsiveTimeout(RESTART_PROBE_MS, () => controller.abort());
    try {
      const response = await fetch(`${origin(server)}/status`, { cache: 'no-store', signal: controller.signal });
      // A restarted engine may be another binary: its build keys the page's retained results.
      if (response.ok) {
        recordNativeBuild(server, ((await response.json().catch(() => ({}))) as { build?: string }).build);
        return true;
      }
    } catch {
      /* Still restarting. */
    } finally {
      stop();
    }
    await delay(RESTART_POLL_MS);
  }
  return false;
}
/** Bodies that can be sent twice; a consumed stream cannot be replayed after a restart. */
const replayable = (body: RequestInit['body']) => !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);

/** Bound both fetch and body reads, including streamed architecture replies. Parse errors
 * are deliberately outside this boundary: invalid JSON is an engine bug, not a disconnect.
 * A refused/reset connection is sent again at once (a kept-alive socket the server had closed),
 * then once more after /status answers again (an engine restart). Only an action request that
 * still fails marks the engine unreachable; a probe (`retryAfterRestart` false) or a broken reply
 * body never does. Caller cancellations are not replayed. */
export async function nativeFetch(runtime: ExecutionRuntime, path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS, retryAfterRestart = true): Promise<Response> {
  const attempts = retryAfterRestart && replayable(init.body) ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt === 2 && !(await waitForNativeRestart(runtime.server, init.signal))) break;
    const result = await sendOnce(runtime, path, init, timeoutMs);
    if (result.response) {
      if (attempt) health.delete(origin(runtime.server));
      return result.response;
    }
    if (result.error !== undefined) throw result.error;
    if (result.timedOut) break;
  }
  if (!retryAfterRestart) throw new NativeConnectionError(runtime.server);
  markNativeUnavailable(runtime.server);
  failures.forEach(listener => listener(runtime.server));
  throw new NativeConnectionError(runtime.server);
}
/** `{ response }`, `{ error }` (caller cancellation: final), `{ timedOut }`, or `{}` for a refused/reset connection. */
async function sendOnce(runtime: ExecutionRuntime, path: string, init: RequestInit, timeoutMs: number): Promise<{ response?: Response; error?: unknown; timedOut?: boolean }> {
  const controller = new AbortController();
  const stopTimer = responsiveTimeout(timeoutMs, () => controller.abort(new DOMException('Native request timed out.', 'TimeoutError')));
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const cancelled = (): unknown => (init.signal?.aborted && init.signal.reason?.name !== 'TimeoutError' ? init.signal.reason : undefined);
  let response: Response;
  try {
    response = await fetch(`${origin(runtime.server)}${path}`, { ...init, signal });
  } catch {
    stopTimer();
    const reason = cancelled();
    return reason !== undefined ? { error: reason } : { timedOut: controller.signal.aborted };
  }
  if (!response.body) {
    stopTimer();
    return { response };
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          stopTimer();
          stream.close();
        } else stream.enqueue(chunk.value);
      } catch {
        stopTimer();
        stream.error(cancelled() ?? new NativeConnectionError(runtime.server));
      }
    },
    cancel(reason) {
      stopTimer();
      return reader.cancel(reason);
    },
  });
  return { response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }) };
}

/** A short, deduplicated check of the existing endpoint; no service startup or downloads. */
export function nativeRuntimeAvailable(runtime: ExecutionRuntime, fresh = false): Promise<boolean> {
  if (runtime.profile !== 'local') return Promise.resolve(false);
  const server = origin(runtime.server),
    known = health.get(server);
  if (known && known.until > Date.now() && (!fresh || known.until === Infinity)) return known.result;
  const entry = { until: Infinity, result: Promise.resolve(false) };
  entry.result = (async () => {
    try {
      const response = await nativeFetch(runtime, '/status', { cache: 'no-store' }, HEALTH_TIMEOUT_MS, false);
      const status = (await response.json()) as { service?: string; backend?: string; build?: string };
      const ok = response.ok && status.service === 'magna-urbis-local' && status.backend === 'rust-native';
      recordNativeBuild(server, ok ? (status.build ?? 'unversioned') : undefined);
      return ok;
    } catch {
      recordNativeBuild(server, undefined);
      return false;
    } finally {
      entry.until = Date.now() + HEALTH_TTL_MS;
    }
  })();
  health.set(server, entry);
  return entry.result;
}
