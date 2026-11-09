import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject, validateSettings } from '../src/v2/project';
import { applyLabelEdits } from '../src/v2/mapLabels';
import { buildMapLabels } from '../src/render/mapLabels';
import { PALETTES } from '../src/render/styles';
import type { World } from '../src/gen/types';

describe('V2 authored label persistence and rendering', () => {
  it('retains text, position and typography through a portable recipe and renders the same label', () => {
    const settings = defaultSettings();
    settings.naming = { labels: { 'free:note': { kind: 'free', text: '<My district> & harbour', anchor: { x: 135, y: 210 }, style: { color: '#aa3322', size: 1.5, bold: true, italic: true } } } };
    const restored = parseProject(serializeProject(settings));
    expect(restored.settings.naming?.labels).toEqual(settings.naming.labels);
    const world = { names: { family: 'english', town: 'Town', entries: [] } } as unknown as World;
    applyLabelEdits(world, restored.settings.naming?.labels);
    const labels = buildMapLabels(world, 'parchment', PALETTES.parchment);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: '<My district> & harbour', x: 135, y: 210, st: { color: '#aa3322', bold: true, italic: true } });
    applyLabelEdits(world, restored.settings.naming?.labels);
    expect(world.names?.entries).toHaveLength(1);
  });
  it('rejects malformed author positions and styles at the project boundary', () => {
    for (const edit of [
      { text: 'Note', anchor: { x: NaN, y: 3 } },
      { text: 'Note', style: { color: 'url(javascript:bad)' } },
      { text: 'Note', style: { size: -2 } },
    ]) {
      const settings = defaultSettings();
      settings.naming = { labels: { invalid: edit } } as typeof settings.naming;
      expect(() => validateSettings(settings)).toThrow();
    }
  });
});
