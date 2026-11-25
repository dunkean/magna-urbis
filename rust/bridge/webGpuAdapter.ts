/** Wait of the callers that nothing visible depends on: shader compiles of a slow GPU delay the adapter by several seconds. */
export const PATIENT_GPU_MS = 15000;

/** Match the neural engine's adapter selection: prefer performance, then let the browser choose. */
export async function requestWebGpuAdapter(waitMs = 2500): Promise<GPUAdapter | null> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;
  // Driver requests occasionally never settle after a reload. Every caller, including
  // display preparation, must be able to continue without the browser GPU.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = async () => {
    try {
      const preferred = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (preferred) return preferred;
    } catch {
      /* Some browsers reject an explicit preference but provide a default adapter. */
    }
    return gpu.requestAdapter();
  };
  try {
    return await Promise.race([
      request(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Device creation can stall independently of adapter discovery. Release a late device after the caller moved on. */
export async function requestWebGpuDevice(adapter: GPUAdapter, descriptor?: GPUDeviceDescriptor): Promise<GPUDevice | null> {
  let pending = true,
    timer: ReturnType<typeof setTimeout> | undefined;
  const creating = adapter.requestDevice(descriptor).then(device => {
    if (!pending) device.destroy();
    return device;
  });
  try {
    return await Promise.race([
      creating,
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), 2500);
      }),
    ]);
  } finally {
    pending = false;
    clearTimeout(timer);
  }
}
