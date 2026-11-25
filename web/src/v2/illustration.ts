/** Connect the existing illustration client to the current V2 view. */
import { captureViewport, mountIllustration } from '../../../illustration/web/index.mjs';
import type { World } from '../gen/types';
import type { View } from '../render/view';
import { illustrationContext } from '../ui/illustrationContext';
import type { V2Settings } from './contracts';
import { nativeCitiesOf } from './nativeProducts';
import { registerMessages, setText, translate } from './i18n';

export interface V2IllustrationOptions {
  host: Element;
  getWorld(): World | undefined;
  getSettings(): V2Settings;
  /** The same DOM viewport and camera used by the V2 viewer. */
  getViewport(): { element: HTMLElement; view: View };
  beforeCapture2d?(): void;
  navigation?: import('../../../illustration/web/index.mjs').IllustrationNavigation;
}

registerMessages({
  '✦ Illustrer': { en: '✦ Illustrate', fr: '✦ Illustrer' },
  'Créer une illustration de cette vue': { en: 'Create an illustration of this view', fr: 'Créer une illustration de cette vue' },
  'Créez d’abord une carte avant de capturer la vue.': { en: 'Create a map before capturing the view.', fr: 'Créez d’abord une carte avant de capturer la vue.' },
});

export function mountV2Illustration(options: V2IllustrationOptions) {
  const mounted = mountIllustration({
    host: options.host,
    navigation: options.navigation,
    capture: async () => {
      const world = options.getWorld();
      if (!world) throw new Error(translate('Créez d’abord une carte avant de capturer la vue.'));
      const settings = options.getSettings(),
        { element, view } = options.getViewport();
      const scenes = nativeCitiesOf(world)
        .map(city => city.scene)
        .filter(scene => scene !== undefined);
      const context = illustrationContext({
        sourceStyle: settings.appearance?.composition?.ground.variant ?? settings.options.style,
        seed: world.seed,
        view: { ...view },
        width: element.clientWidth,
        height: element.clientHeight,
        terrain: {
          relief: settings.terrain?.relief ?? settings.options.relief,
          climate: settings.terrain?.climate,
          environment: settings.terrain?.environment,
          biome: settings.options.biome,
          temperature: settings.terrain?.climateValues?.temperature,
          precipitation: settings.terrain?.climateValues?.precipitation,
          ambience: settings.appearance?.composition?.effects.ambience,
        },
        settlements: world.settlements,
        terrainLayer: world.terrain,
        buildings: { buildings: scenes.flatMap(scene => scene.buildings), materials: scenes.flatMap(scene => scene.materials ?? []) },
        architecture: settings.urban?.houses,
        generation: { culture: settings.options.culture, population: settings.options.population, size: settings.options.size, workflow: settings.options.workflow, coast: settings.options.coast, river: settings.options.river, biome: settings.options.biome },
      });
      // Freeze the GPU ground before captureViewport composites the visible layers.
      options.beforeCapture2d?.();
      return { image: await captureViewport(element), guides: {}, context };
    },
  });
  setText(mounted.button, '✦ Illustrer');
  mounted.dialog.classList.add('workbench-illustration');
  mounted.dialog.querySelector<HTMLDetailsElement>('[data-local-tuning]')!.open = false;
  const header = mounted.dialog.querySelector('header')!,
    close = mounted.dialog.querySelector('[data-illustration-close]')!;
  for (const action of ['[data-generate]', '[data-cancel]']) header.insertBefore(mounted.dialog.querySelector(action)!, close);
  mounted.button.setAttribute('data-i18n-title', 'Créer une illustration de cette vue');
  mounted.button.title = translate('Créer une illustration de cette vue');
  // The top-bar Illustrate button is withdrawn from the V2 for now (2026-11-17); the workbench stays mounted.
  mounted.button.hidden = true;
  mounted.button.style.display = 'none';
  return mounted;
}
