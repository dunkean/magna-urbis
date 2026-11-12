/** Connect the existing illustration client to the current V2 view. */
import { captureViewport, mountIllustration } from '../../../illustration/web/index.mjs';
import { battlemapCamera } from '../../../illustration/web/framing.mjs';
import type { World } from '../gen/types';
import type { View } from '../render/view';
import { illustrationContext } from '../ui/illustrationContext';
import type { V2Settings } from './contracts';
import type { V2Urban3d } from './urban3d';
import { nativeCitiesOf } from './nativeProducts';
import { registerMessages, setText, translate } from './i18n';

export interface V2IllustrationOptions {
  host: Element;
  getWorld(): World | undefined;
  getSettings(): V2Settings;
  get3d(): V2Urban3d | undefined;
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
  const mounted = mountIllustration({ host: options.host, navigation: options.navigation,
    prepareBattlemap: ({ pixels, cellMetres }) => {
      const view = options.get3d(), camera = view?.getCamera(), { element } = options.getViewport();
      if (!view?.active || !camera) throw new Error('Ouvrez la vue 3D avant de la cadrer.');
      view.setCamera(battlemapCamera(camera, { width: element.clientWidth, height: element.clientHeight }, pixels, cellMetres));
    }, capture: async () => {
    const world = options.getWorld();
    if (!world) throw new Error(translate('Créez d’abord une carte avant de capturer la vue.'));
    const settings = options.getSettings(), { element, view } = options.getViewport(), city3d = options.get3d();
    const captured = city3d?.active ? await city3d.captureIllustration() : undefined;
    const scenes = nativeCitiesOf(world).map(city => city.scene).filter(scene => scene !== undefined);
    const context = illustrationContext({
      sourceStyle: settings.appearance?.composition?.ground.variant ?? settings.options.style,
      seed: world.seed, view: { ...view }, camera: captured?.camera,
      width: element.clientWidth, height: element.clientHeight,
      terrain: { relief: settings.terrain?.relief ?? settings.options.relief, climate: settings.terrain?.climate,
        environment: settings.terrain?.environment, biome: settings.options.biome,
        temperature: settings.terrain?.climateValues?.temperature, precipitation: settings.terrain?.climateValues?.precipitation,
        ambience: settings.appearance?.composition?.effects.ambience },
      settlements: world.settlements,
      terrainLayer: world.terrain,
      buildings: { buildings: scenes.flatMap(scene => scene.buildings), materials: scenes.flatMap(scene => scene.materials ?? []) },
      architecture: settings.urban?.houses,
      generation: { culture: settings.options.culture, population: settings.options.population, size: settings.options.size,
        workflow: settings.options.workflow, coast: settings.options.coast, river: settings.options.river, biome: settings.options.biome },
    });
    if (captured) return { image: captured.image, guides: { depth: captured.depth }, context };
    // Freeze the GPU ground before captureViewport composites the visible layers.
    options.beforeCapture2d?.();
    return { image: await captureViewport(element), guides: {}, context };
  } });
  setText(mounted.button, '✦ Illustrer');
  mounted.button.setAttribute('data-i18n-title', 'Créer une illustration de cette vue');
  mounted.button.title = translate('Créer une illustration de cette vue');
  return mounted;
}
