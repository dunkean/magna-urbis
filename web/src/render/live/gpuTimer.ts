/**
 * GPU time of the compositor's frames (EXT_disjoint_timer_query_webgl2), for LiveStats.gpuMs.
 *
 * One TIME_ELAPSED query around a whole frame, from a small pool: a result is read at the start of a later frame, once
 * it has arrived, and is never waited for. A layer must not open its own TIME_ELAPSED query in `draw`.
 */
const TIMER_QUERIES = 4;

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface GpuTimer {
  /** Looks the extension up; once per context. */
  init(): void;
  /** Results of earlier frames that have arrived go to `record`, in milliseconds. */
  poll(): void;
  begin(): void;
  end(): void;
  /** Every query handle is dead. */
  contextLost(): void;
  dispose(): void;
}

export function createGpuTimer(gl: WebGL2RenderingContext, record: (ms: number) => void): GpuTimer {
  let extension: TimerExtension | null = null;
  const queries: (WebGLQuery | null)[] = [],
    busy: boolean[] = [];
  for (let i = 0; i < TIMER_QUERIES; i++) {
    queries.push(null);
    busy.push(false);
  }
  let open = -1;
  return {
    init() {
      extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
    },
    poll() {
      if (!extension) return;
      for (let i = 0; i < TIMER_QUERIES; i++) {
        const query = queries[i];
        if (!busy[i] || !query || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        busy[i] = false;
        if (!gl.getParameter(extension.GPU_DISJOINT_EXT)) record(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
      }
    },
    begin() {
      open = -1;
      if (!extension) return;
      for (let i = 0; i < TIMER_QUERIES; i++) {
        if (busy[i]) continue;
        const query = (queries[i] ??= gl.createQuery());
        if (query) {
          gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
          open = i;
        }
        return;
      }
    },
    end() {
      if (open < 0 || !extension) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      busy[open] = true;
      open = -1;
    },
    contextLost() {
      extension = null;
      open = -1;
      for (let i = 0; i < TIMER_QUERIES; i++) {
        queries[i] = null;
        busy[i] = false;
      }
    },
    dispose() {
      for (const query of queries) if (query) gl.deleteQuery(query);
    },
  };
}
