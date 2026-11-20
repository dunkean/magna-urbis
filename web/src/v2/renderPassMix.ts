import type { V2Settings } from './contracts';
import { presetComposition, type PresetId } from '../render/composition';
import { writeAppearanceControl } from './renderControls';

export type RenderMixComponent = 'ground' | 'vegetation' | 'buildings' | 'text' | 'lighting';

/** Assemble existing shader components. No extra renderer, blending pass or generation setting is added. */
export function mixRenderStyle(settings: V2Settings, component: RenderMixComponent, preset: PresetId): void {
  const source = presetComposition(preset);
  const set = (path: string, value: unknown) => writeAppearanceControl(settings, `appearance.composition.${path}`, value);
  if (component === 'ground') {
    set('ground.look', source.ground.look);
    set('ground.variant', source.ground.variant);
  } else if (component === 'vegetation') set('vegetation.look', source.vegetation.look);
  else if (component === 'buildings') set('buildings.look', source.buildings.look);
  else if (component === 'text') {
    set('text.look', source.text.look);
    set('text.halo', source.text.halo);
  } else {
    for (const key of ['azimuth', 'elevation', 'strength', 'exaggeration'] as const) set(`effects.lighting.${key}`, source.effects.lighting[key]);
  }
}
