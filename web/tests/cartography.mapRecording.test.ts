import { describe, expect, it } from 'vitest';
import { createMapRecording } from '../src/render/cartography/mapRecording';
import { RecordingCanvas } from '../src/render/gpu/recorder';

describe('text-free map recording', () => {
  it.each([0.01, 0.6, 1.5])('keeps map geometry and excludes names at scale %s', scale => {
    const canvas = createMapRecording(512, 512);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#123456';
    ctx.fillRect(2, 3, 20, 30);
    ctx.save();
    ctx.font = '120px serif';
    ctx.strokeText('Forest', 40, 50);
    ctx.fillText('Main Street', 40, 60, 200);
    ctx.restore();
    ctx.fillText('River', 80, 90);
    const list = canvas.finish();
    expect(list.unsupported).toBeUndefined();
    expect(list.ops.map(op => op.type)).toEqual(['fill']);
    expect(list.stats.calls).toBe(1);
    expect(list.stats.sprites).toBe(0);
  });

  it('keeps rejecting other unsupported painting and leaves ordinary recording unchanged', () => {
    const map = createMapRecording(512, 512);
    map.getContext('2d')!.createLinearGradient(0, 0, 10, 10);
    expect(map.finish().unsupported).toBe('gradient');
    const exact = new RecordingCanvas(512, 512);
    exact.getContext('2d')!.fillText('Capture label', 10, 20);
    expect(exact.finish().unsupported).toBe('text');
  });
});
