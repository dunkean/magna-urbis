/**
 * Mounted City 3D API, captures, statistics and teardown, created by cityMount.
 * Reads/writes: Reads the supplied per-mount context; changes visibility/activity/camera, composites captures, reports state and releases owned observers/resources.
 */
import { TERRAIN_3D_FOV, type Terrain3d, type Terrain3dCamera } from '../terrain3d';
import type { Point } from '../../../../rust/bridge/housesContract';
import { City3d } from './cityTypes';
import type { City3dContext } from './cityContext';
export function createCityApi(cityContext: City3dContext): City3d {
  return {
    get active() {
      return cityContext.active;
    },
    async prepare(): Promise<void> {
      const t = cityContext.ensureTerrain();
      if (!t) throw new Error(cityContext.error ?? 'The 3D renderer is unavailable.');
      cityContext.sync();
      await (t as Terrain3d & { prepareVariant?(): Promise<void> }).prepareVariant?.();
    },
    show(): void {
      if (cityContext.disposed) return;
      cityContext.root.hidden = false;
      cityContext.active = true;
      if (cityContext.options.toolbarHost) cityContext.toolbar.hidden = false;
      cityContext.externalControls.hidden = false;
      const started = performance.now(),
        t = cityContext.ensureTerrain();
      if (!t) return;
      cityContext.timings.engine = cityContext.timings.engine ?? Math.round(performance.now() - started);
      t.resize(cityContext.root.clientWidth, cityContext.root.clientHeight);
      t.setActive(true);
      cityContext.sync();
      cityContext.canvas.focus({ preventScroll: true });
      // Load the realization modules before the first pick, not during busy frames.
      if (cityContext.display?.kinds.compact && cityContext.sceneOf && !('projection' in cityContext.sceneOf) && !cityContext.options.details)
        void cityContext.detailModules().catch(() => {
          cityContext.modules = undefined;
        });
      if (cityContext.options.details) {
        cityContext.options.details.setActiveView('3d');
        cityContext.unsubscribeDetails ??= cityContext.options.details.subscribe(cityContext.applyServiceDetails);
        cityContext.applyServiceDetails();
        cityContext.driveDetails();
      }
    },
    hide(): void {
      cityContext.active = false;
      cityContext.root.hidden = true;
      if (cityContext.options.toolbarHost) cityContext.toolbar.hidden = true;
      cityContext.externalControls.hidden = true;
      cityContext.terrain?.setActive(false);
      cancelAnimationFrame(cityContext.detailFrame);
      cityContext.detailFrame = 0;
      cityContext.unsubscribeDetails?.();
      cityContext.unsubscribeDetails = undefined;
      cityContext.options.details?.setActiveView('2d');
    },
    refresh(): void {
      if (cityContext.active) cityContext.sync();
    },
    syncControls: cityContext.syncView,
    focus(point: Point, radius = 150): void {
      const t = cityContext.terrain;
      if (!t) return;
      const span = Math.max(120, 2.4 * radius),
        distance = span / (2 * Math.tan(TERRAIN_3D_FOV / 2));
      t.setCamera({ ...t.getCamera(), navigation: 'orbit', ...t.framingView(point.x, point.y, distance) });
      cityContext.updateInfo();
    },
    getCamera: () => cityContext.terrain?.getCamera(),
    setCamera(camera: Terrain3dCamera): void {
      cityContext.terrain?.setCamera(camera);
      cityContext.focused = true;
      cityContext.updateInfo();
    },
    toMapView() {
      const c = cityContext.terrain?.getCamera(),
        h = cityContext.root.clientHeight;
      if (!c || !(h > 0) || !(c.distance > 0)) return undefined;
      return { cx: c.x, cy: c.y, scale: h / (2 * Math.tan(TERRAIN_3D_FOV / 2) * c.distance) };
    },
    fromMapView(view) {
      const t = cityContext.terrain,
        h = cityContext.root.clientHeight;
      if (!t || !(h > 0) || !(view.scale > 0)) return;
      t.setCamera({ ...t.getCamera(), navigation: 'orbit', x: view.cx, y: view.cy, distance: h / (2 * Math.tan(TERRAIN_3D_FOV / 2) * view.scale) });
      cityContext.focused = true;
      cityContext.updateInfo();
    },
    capture: async () => {
      if (!cityContext.terrain) throw new Error('Vue 3D inactive.');
      const request = await cityContext.captureReady();
      const image = await cityContext.textOverlay.composite(await cityContext.terrain.capture());
      request.mark('capture-complete');
      return image;
    },
    captureIllustration: async () => {
      if (!cityContext.terrain) throw new Error('Vue 3D inactive.');
      const request = await cityContext.captureReady();
      const result = await cityContext.terrain.captureIllustration(),
        image = await cityContext.textOverlay.composite(result.image);
      request.mark('capture-complete');
      return { ...result, image };
    },
    stats: () => ({
      programsReady: cityContext.programsReady(),
      buildings: (cityContext.display?.buildings.length ?? 0) - cityContext.bridgeStats.count - cityContext.wallStats.pieces - cityContext.quayCount - cityContext.stairStats.count,
      ...(cityContext.display?.kinds ?? { silhouette: 0, compact: 0, detailed: 0 }),
      displayMs: cityContext.displayMs,
      timings: { ...cityContext.timings },
      realizing: cityContext.converting.size,
      realizeError: cityContext.info.dataset.detailError || undefined,
      bridges: cityContext.bridgeStats,
      walls: cityContext.wallStats,
      stairs: cityContext.stairStats,
      lod: cityContext.terrain?.getLodInfo(),
      parentWindow:
        cityContext.sceneOf && 'projection' in cityContext.sceneOf && cityContext.sceneOf.projection === 'native-parent-window-3d-1'
          ? { complete: cityContext.sceneOf.complete, reason: cityContext.sceneOf.reason, parents: cityContext.sceneOf.parents, members: cityContext.sceneOf.buildings.length }
          : undefined,
    }),
    dispose(): void {
      cityContext.drapeTiles.clear();
      cityContext.tileWaterMask.dispose();
      cityContext.waterCells.dispose();
      cityContext.textOverlay.dispose();
      cityContext.disposed = true;
      cityContext.active = false;
      cityContext.sourceEpoch++;
      clearTimeout(cityContext.detailTimer);
      cancelAnimationFrame(cityContext.detailFrame);
      cityContext.unsubscribeDetails?.();
      cityContext.unsubscribeDetails = undefined;
      cityContext.options.details?.setActiveView('2d');
      window.removeEventListener('magna-locale-change', cityContext.localizeControls);
      cityContext.resize.disconnect();
      cityContext.terrain?.dispose();
      cityContext.terrain = undefined;
      cityContext.toolbar.remove();
      cityContext.externalControls.remove();
      cityContext.root.remove();
    },
  };
}
