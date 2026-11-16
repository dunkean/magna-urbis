import { describe, expect, it, vi } from 'vitest';
import { resolveSettingsAppearance } from '../src/v2/appearance';
import { supportsSvgExport } from '../src/v2/exportOptions';
import { presetComposition } from '../src/render/composition';
import { defaultSettings } from '../src/v2/settings';
import { canvasPng, cropCanvasPng } from '../src/ui/canvasExport';

describe('exports of the current style', () => {
  it.each(['minimal', 'atlas', 'cadastre', 'topographic', 'parchment'] as const)('keeps vector export for %s, including the composite renderer', style => {
    const settings = defaultSettings();
    settings.appearance = { style: 'parchment', composition: presetComposition(style) };
    const before = structuredClone(settings);
    const resolved = resolveSettingsAppearance(settings, undefined, 'export');
    expect(supportsSvgExport(resolved)).toBe(true);
    expect(settings).toEqual(before);
  });
  it.each(['satellite', 'satellite-light', 'satellite-2', 'illustration'] as const)('disables vector export for %s', style => {
    const settings = defaultSettings();
    settings.appearance = { style: 'parchment', composition: presetComposition(style) };
    // Hidden Illustrated recipes normally normalize to parchment in V2; test the actual brush traits separately.
    const resolved = resolveSettingsAppearance(settings, undefined, 'export');
    if (style === 'illustration') expect(supportsSvgExport({ ...resolved, ground: { ...resolved.ground, traits: { ...resolved.ground.traits, family: 'brush' } } })).toBe(false);
    else expect(supportsSvgExport(resolved)).toBe(false);
  });
  it('disables SVG for a procedural canopy or a diagnostic on a map palette', () => {
    const resolved = resolveSettingsAppearance(defaultSettings(), undefined, 'export');
    expect(supportsSvgExport({ ...resolved, diagnostic: 'elevation' })).toBe(false);
    expect(supportsSvgExport({ ...resolved, composition: { ...resolved.composition, vegetation: { ...resolved.composition.vegetation, procedural: true } } })).toBe(false);
  });
});

describe('direct raster PNG export', () => {
  it('uses the asynchronous PNG encoder and propagates allocation/encoding failures', async () => {
    const png = new Blob(['pixels'], { type: 'image/png' });
    const toBlob = vi.fn((done: BlobCallback, type: string) => { expect(type).toBe('image/png'); done(png); });
    await expect(canvasPng({ toBlob } as unknown as HTMLCanvasElement)).resolves.toBe(png);
    await expect(canvasPng({ toBlob: (done: BlobCallback) => done(null) } as HTMLCanvasElement)).rejects.toThrow('PNG encoding failed');
    await expect(canvasPng({ toBlob: () => { throw new Error('allocation'); } } as unknown as HTMLCanvasElement)).rejects.toThrow('allocation');
  });
  it('crops map metres into source pixels and releases its rectangular output on success or failure', async () => {
    for (const fail of [false, true]) {
      const source = { width: 1600, height: 1600 } as HTMLCanvasElement, drawImage = vi.fn();
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (done: BlobCallback) => done(fail ? null : new Blob(['png'])) };
      vi.stubGlobal('document', { createElement: () => canvas });
      try {
        const result = cropCanvasPng(source, { x: 100, y: 200, width: 8000, height: 8000 }, { x: 2100, y: 1200, width: 4000, height: 2000 }, { width: 3000, height: 1500 });
        if (fail) await expect(result).rejects.toThrow('PNG encoding failed'); else await expect(result).resolves.toBeInstanceOf(Blob);
        expect(drawImage).toHaveBeenCalledWith(source, 400, 200, 800, 400, 0, 0, 3000, 1500);
        expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
        expect(source.width).toBe(1600);
      } finally { vi.unstubAllGlobals(); }
    }
  });
});
