/**
 * Map-label synchronization with the city text overlay, called by citySync.
 * Reads/writes: Reads plan/world/text/semantic getters; writes text-input cache, limits and label contents on the supplied context.
 */
import { buildMapLabels } from '../../render/mapLabels';
import { DEFAULT_TEXT, cityTextLabels } from '../../render/textLayer';
import { PALETTES } from '../../render/styles';
import type { City3dContext } from './cityContext';

export function syncText(cityContext: City3dContext): void {
  const supplied = cityContext.options.getText?.(),
    text = supplied?.text ?? DEFAULT_TEXT,
    palette = supplied?.palette ?? PALETTES.parchment;
  const world = supplied?.world,
    scene = cityContext.cityPlan(),
    key = JSON.stringify([text, palette.name, palette.lab, cityContext.options.labels]);
  const semantic = cityContext.options.getSemantic?.();
  if (semantic) cityContext.textOverlay.setLimits({ ...semantic, scenes: scene ? [scene] : [] });
  if (!cityContext.textInputs || cityContext.textInputs.world !== world || cityContext.textInputs.plan !== scene || cityContext.textInputs.key !== key) {
    const labels = cityContext.options.labels === false ? [] : [...(world ? buildMapLabels(world, palette.name, palette, text) : []), ...(scene ? cityTextLabels(scene, text, palette, world) : [])];
    labels.sort((a, b) => b.st.priority - a.st.priority);
    cityContext.textInputs = { world, plan: scene, key, labels };
    cityContext.textOverlay.set({ labels, text, palette });
  }
}
