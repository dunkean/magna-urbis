import type { V2Settings } from './contracts';
import { presetComposition, resolveComposition, type PresetId } from '../render/composition';
import { styleTraits } from '../render/terrainStyle';
import { writeAppearanceControl } from './renderControls';

export type RenderMixComponent = 'ground' | 'water' | 'roads' | 'vegetation' | 'buildings' | 'text' | 'lighting' | 'plan';

/** Assemble existing shader components. No extra renderer, blending pass or generation setting is added. */
export function mixRenderStyle(settings: V2Settings, component: RenderMixComponent, preset: PresetId): void {
  const source = presetComposition(preset),
    resolved = resolveComposition(source, styleTraits(source.ground.variant), 'view2d', { nativeCities: true, nativeTerrain: true, paintedTextures: true, parcels: true, buildings: true, ruralLanduse: true, urbanLanduse: true });
  const set = (path: string, value: unknown) => writeAppearanceControl(settings, `appearance.composition.${path}`, value);
  if (component === 'ground') {
    set('ground.look', source.ground.look);
    set('ground.variant', source.ground.variant);
  } else if (component === 'water') set('networks.water.look', resolved.networks.water.look);
  else if (component === 'roads') {
    set('networks.roads.look', resolved.networks.roads.look === 'rendered' ? 'natural' : resolved.networks.roads.look);
    set('networks.roads.emphasis', source.networks.roads.emphasis);
    set('networks.roads.surface', source.networks.roads.surface ?? 'plan');
  } else if (component === 'vegetation') set('vegetation.look', source.vegetation.look);
  else if (component === 'buildings') set('buildings.look', source.buildings.look);
  else if (component === 'text') {
    set('text.look', source.text.look);
    set('text.halo', source.text.halo);
  } else if (component === 'plan') {
    for (const key of ['parcels', 'blocks', 'districts'] as const) set(`buildings.${key}`, source.buildings[key]);
  } else {
    for (const key of ['azimuth', 'elevation', 'strength', 'exaggeration'] as const) set(`effects.lighting.${key}`, source.effects.lighting[key]);
  }
}
