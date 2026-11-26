import { afterEach, describe, expect, it, vi } from 'vitest';
import { contourRaster, contourRasterSide, contourRasterUrl, contourTint, paintContourRaster } from '../src/render/contourRaster';
import { RecordingCanvas } from '../src/render/gpu/recorder';

afterEach(() => vi.unstubAllGlobals());

describe('one retained contour plate', () => {
  it('caps its fixed definition independently of zoom and screen pixel ratio', () => {
    expect(contourRasterSide(4000)).toBe(8000);
    expect(contourRasterSide(128000)).toBe(8192);
    expect(contourRasterSide(200)).toBe(1024);
  });

  it('keeps one plate across tints and encodes line classes independently, replacing coverage only for geometry changes', () => {
    const strokes: [string, string, number][] = [];
    const ctx = {
      setTransform: vi.fn(),
      lineWidth: 0,
      strokeStyle: '',
      globalCompositeOperation: '',
      stroke() {
        strokes.push([this.strokeStyle, this.globalCompositeOperation, this.lineWidth]);
      },
    };
    const create = vi.fn(() => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn(() => 'data:image/png;base64,plate') }));
    vi.stubGlobal('document', { createElement: create });
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(public data: string) {}
      },
    );
    const paths = { thin: 'M0,0L1,1', index: 'M0,1L1,0' };
    const terrain = { width: 4000 };
    const look = { contour: '#402000', contourOpacity: 0.5, contourThinW: 1, contourIndexW: 1.6 };
    const otherLook = { ...look, contour: '#003300', contourOpacity: 1 };
    const plate = contourRaster(terrain, paths, look, true);
    expect(plate.metresPerTexel).toBe(0.5);
    expect(contourRaster(terrain, paths, otherLook, true)).toBe(plate);
    expect(create).toHaveBeenCalledOnce();
    expect(strokes).toEqual([
      ['#ff0000', 'lighter', 0.3],
      ['#00ff00', 'lighter', 0.5],
    ]);
    expect(contourRasterUrl(plate)).toBe(contourRasterUrl(plate));
    expect(plate.canvas.toDataURL).toHaveBeenCalledOnce();

    const rec = new RecordingCanvas(100, 100),
      canvasCtx = rec.getContext('2d')!,
      first = contourTint(look, 1),
      second = contourTint(otherLook, 1);
    paintContourRaster(canvasCtx, plate, first, 0, 0, 100, 100);
    paintContourRaster(canvasCtx, plate, second, 0, 0, 100, 100);
    const list = rec.finish();
    expect(list.unsupported).toBeUndefined();
    expect(list.ops).toMatchObject([
      { type: 'sprites', source: plate.canvas, contourTint: first },
      { type: 'sprites', source: plate.canvas, contourTint: second },
    ]);

    const heavier = contourRaster(terrain, paths, { ...look, contourIndexW: 3.2 }, true);
    expect(heavier).not.toBe(plate);
    const restored = contourRaster(terrain, paths, look, true);
    expect(restored).not.toBe(plate);
    expect(contourRaster(terrain, { ...paths }, look, true)).not.toBe(restored);
    expect(contourRaster({ ...terrain }, paths, look, true)).not.toBe(restored);
  });

  it('tints thin, index and overlapping coverage in the Canvas fallback using only output pixels', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 0, 255]);
    const scratch = { canvas: {}, clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })), putImageData: vi.fn() };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => scratch }) });
    const ctx = { canvas: { width: 4, height: 1 }, save: vi.fn(), restore: vi.fn(), getTransform: () => ({ a: 1, d: 1, e: -100, f: -100 }), setTransform: vi.fn(), drawImage: vi.fn() };
    const tint = contourTint({ contour: '#402000', contourOpacity: 0.5 }, 1);
    const plate = { canvas: {} as HTMLCanvasElement, worldSize: 4000, metresPerTexel: 0.5 };
    paintContourRaster(ctx as unknown as CanvasRenderingContext2D, plate, tint, 0, 0, 4000, 4000);
    expect(scratch.getImageData).toHaveBeenCalledWith(0, 0, 4, 1);
    expect([...data]).toEqual([64, 32, 0, 0, 64, 32, 0, 89, 64, 32, 0, 128, 64, 32, 0, 172]);
    expect(ctx.drawImage).toHaveBeenCalledWith(scratch.canvas, 0, 0, 4, 1, 0, 0, 4, 1);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});
