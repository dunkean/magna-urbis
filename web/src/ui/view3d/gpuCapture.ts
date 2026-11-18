/**
 * WebGPU color/depth readback, called by Terrain3dGpu.captureFrame.
 * Reads/writes: Reads canvas and depth targets from the supplied context; owns and releases temporary resolve/readback resources and returns encoded canvases.
 */
import type { TerrainGpuContext } from './terrainGpuContext';

/** Colour from the canvas (same task as the draw), depth resolved from sample 0 and read back. */
export async function captureFrame(context: TerrainGpuContext, near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
  const width = context.canvas.width,
    height = context.canvas.height,
    targets = context.targets;
  if (!targets || targets.width !== width || targets.height !== height) throw new Error('Capture 3D indisponible.');
  const color = document.createElement('canvas');
  color.width = width;
  color.height = height;
  color.getContext('2d')!.drawImage(context.canvas, 0, 0);
  const device = context.device,
    pipeline = context.gpu.depthReadback();
  const resolved = device.createTexture({ label: 'depth readback', size: [width, height], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const readback = device.createBuffer({ label: 'depth readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder({ label: 'depth readback' });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: resolved.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1, 0, 0, 1] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: targets.depth.createView({ aspect: 'depth-only' }) }] }));
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: resolved }, { buffer: readback, bytesPerRow, rowsPerImage: height }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const rows = new Float32Array(readback.getMappedRange()),
      inverse = new Float32Array(width * height),
      stride = bytesPerRow / 4;
    // As captureWebGlFrame: inverse distance from GL window depth, normalized over the rendered geometry.
    let low = Infinity,
      high = -Infinity;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const d = rows[y * stride + x],
          i = y * width + x;
        if (!(d < 1)) continue; // Sky, outside the rendered geometry.
        inverse[i] = (far + near - (2 * d - 1) * (far - near)) / (2 * near * far);
        low = Math.min(low, inverse[i]);
        high = Math.max(high, inverse[i]);
      }
    readback.unmap();
    const depth = document.createElement('canvas');
    depth.width = width;
    depth.height = height;
    const context = depth.getContext('2d')!,
      data = context.createImageData(width, height);
    for (let i = 0; i < inverse.length; i++) {
      const value = inverse[i] ? (high > low ? 1 + Math.round((254 * (inverse[i] - low)) / (high - low)) : 255) : 0;
      data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = value;
      data.data[i * 4 + 3] = 255;
    }
    context.putImageData(data, 0, 0);
    return { color, depth };
  } finally {
    resolved.destroy();
    readback.destroy();
  }
}
