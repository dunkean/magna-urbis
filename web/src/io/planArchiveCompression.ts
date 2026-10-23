/** Package-scoped asynchronous compression for the native architecture bridge. */
function alreadyInWorker(): boolean {
  const scope = (globalThis as unknown as { WorkerGlobalScope?: { prototype: object } }).WorkerGlobalScope;
  return !!scope && scope.prototype.isPrototypeOf(globalThis);
}

export async function gzipPlanBytes(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const { gzip, gzipSync } = await import('fflate');
  // Native transport already processes <=64 plans at a time in the city worker.
  // Avoid starting another worker per chunk; the main/UI path remains async.
  if (alreadyInWorker()) return gzipSync(raw, { level: 6, mtime: 0 });
  return new Promise((resolve, reject) => {
    gzip(raw, { level: 6, mtime: 0, consume: true }, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}

export async function gunzipPlanBytes(compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const { gunzip } = await import('fflate');
  return new Promise((resolve, reject) => {
    gunzip(compressed, { consume: true }, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}
