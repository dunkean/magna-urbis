import { terrainFromDecor } from '../../ui/benchTerrainTransfer';
import { modelPreviewFixture, modelPreviewView } from '../../render/city3d/modelPreview';
import type { World } from '../../gen/types';
import { type RustTownSnapshot } from '../rustUrban';
import { projectEngineTerrain } from '../terrainProjection';
import type { PageActions, PageState } from './contract';
import { $ } from './dom';

/** Load retained display products through the ordinary V2 compositor without requesting a generation stage. */
export async function showModelPreview(id: string, overview: boolean, state: PageState, actions: PageActions): Promise<void> {
  const fixture = modelPreviewFixture(id),
    extent = fixture.decor.raster.width;
  const settings = { ...state.settings, extent, options: { ...state.settings.options, seed: fixture.decor.meta.seed, mapSize: extent, style: 'atlas' as const }, appearance: fixture.appearance };
  const town: RustTownSnapshot = { backend: 'rust-wasm-cpu', stage: 'buildings', layoutKey: 'model-preview', layouts: fixture.layouts, scene: fixture.scene, buildingIds: fixture.scene.buildings.map(building => building.id), warnings: [] };
  const world: World = { seed: settings.options.seed, options: settings.options, mapSize: extent, terrain: projectEngineTerrain(terrainFromDecor(fixture.decor)), roads: [], debug: { v2RustCities: { main: town } }, stats: {} };
  state.settings = settings;
  state.world = world;
  await actions.syncControls();
  await state.client.show(world);
  actions.updateWorld();
  state.client.viewer.setView(modelPreviewView(fixture, overview, $('#map').clientWidth));
  document.title = fixture.label;
  if (!document.querySelector('[data-camera="tilt"]')) actions.toast('The 3D model preview needs the graphics compositor.', true);
}
