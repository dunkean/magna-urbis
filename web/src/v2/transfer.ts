/** Collect buffers owned by a completed worker result; never use on the live main-thread world. */
export function resultTransferBuffers(root: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>(), seen = new WeakSet<object>(), pending: object[] = [];
  if (root && typeof root === 'object') pending.push(root);
  while (pending.length) {
    const value = pending.pop()!; if (seen.has(value)) continue; seen.add(value);
    if (value instanceof ArrayBuffer) { if (value.byteLength) buffers.add(value); continue; }
    if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer && value.buffer.byteLength) buffers.add(value.buffer); continue; }
    if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object') pending.push(child); }
    else for (const key in value) if (Object.hasOwn(value, key)) { const child = (value as Record<string, unknown>)[key]; if (child && typeof child === 'object') pending.push(child); }
  }
  return [...buffers];
}
