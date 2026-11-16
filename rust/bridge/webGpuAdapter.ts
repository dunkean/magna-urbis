/** Match the neural engine's adapter selection: prefer performance, then let the browser choose. */
export async function requestWebGpuAdapter(): Promise<GPUAdapter | null> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;
  try {
    const preferred = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (preferred) return preferred;
  } catch { /* Some browsers reject an explicit preference but provide a default adapter. */ }
  return gpu.requestAdapter();
}
