/**
 * Native building detail demand, realization and swaps, called by city controls/camera callbacks.
 * Reads/writes: Reads source identity and shared detail service; writes detail caches, pending swaps, timers and display sectors on the supplied context.
 */
import { TERRAIN_3D_FOV } from '../terrain3d';
import { city3dDisplayKind, compactBuilding, projectionDetailMatches, seatPlan } from '../../render/city3dMeshes';
import { isBuildingProjection, type Building3dVisual } from '../../render/urbanBuildingGeometry';
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { executionRuntime } from '../executionProfile';
import { urbanText } from '../urbanPanelLocale';
import type { City3dContext } from './cityContext';
/** The 3D camera drives the shared controller: ground footprint around the target. */
export function driveDetails(cityContext: City3dContext): void {
  const t = cityContext.terrain,
    service = cityContext.options.details;
  if (!t || !service || !cityContext.active) return;
  const c = t.getCamera(),
    half = c.distance * Math.tan(TERRAIN_3D_FOV / 2),
    aspect = Math.max(1, cityContext.viewWidth / Math.max(1, cityContext.viewHeight));
  service.update({ viewport: { minX: c.x - half * aspect, minY: c.y - half, maxX: c.x + half * aspect, maxY: c.y + half }, metresPerPixel: (2 * half) / Math.max(1, cityContext.canvas.clientHeight), selectedId: cityContext.options.getSelected?.(), enabled: true });
}

/** Exteriors the shared controller holds are swapped into the display in place. */
export function applyServiceDetails(cityContext: City3dContext): void {
  const service = cityContext.options.details;
  if (!service) return;
  const cached = service.cached(),
    held = new Set(cached.map(d => d.id));
  // Exteriors the shared cache evicted go back to their compact plan (one rebuild).
  for (const id of [...cityContext.details.keys()])
    if (!held.has(id)) {
      cityContext.details.delete(id);
      cityContext.detailBases.delete(id);
      cityContext.restoreCompact(id);
    }
  for (const d of cached)
    if (cityContext.details.get(d.id) !== d) {
      const base = cityContext.byId.get(d.id);
      if (!base || (isBuildingProjection(base) && !projectionDetailMatches(base, d))) continue;
      cityContext.details.set(d.id, d);
      cityContext.detailBases.set(d.id, base);
      cityContext.swapDetail(d.id, d);
    }
  cityContext.updateInfo();
}

/** Swap a realized exterior into the displayed batch in place, and back:
 * only the touched building sectors rebuild (Terrain3d.replaceBuildings);
 * relief, material tiles, bridges and walls stay as they are. */
export function slotOf(cityContext: City3dContext, id: string): number {
  if (cityContext.indexOf !== cityContext.display) {
    cityContext.displayIndex = new Map(cityContext.display?.buildings.map((b, i) => [b.id, i]));
    cityContext.indexOf = cityContext.display;
  }
  return cityContext.displayIndex.get(id) ?? -1;
}

export function queueSwap(cityContext: City3dContext, id: string, building: Building3dVisual): void {
  cityContext.pendingSwaps.set(id, building);
  clearTimeout(cityContext.detailTimer);
  cityContext.detailTimer = setTimeout(() => {
    if (!cityContext.terrain || !cityContext.display) return;
    cityContext.terrain.replaceBuildings([...cityContext.pendingSwaps.values()]);
    cityContext.pendingSwaps.clear();
    cityContext.updateInfo();
  }, 200);
}

export function swapDetail(cityContext: City3dContext, id: string, detail: PlacedBuilding): void {
  const i = cityContext.slotOf(id);
  if (!cityContext.display || i < 0) return;
  // Display volumes of compact plans carry lofted roofs: count by the source kind.
  if (!cityContext.realized.has(cityContext.display.buildings[i])) {
    cityContext.display.kinds.compact--;
    cityContext.display.kinds.detailed++;
  }
  // Seated on the displayed terrain like its compact plan (city3dScene); projections keep their recorded heights.
  const seated = cityContext.sceneOf && 'projection' in cityContext.sceneOf ? detail : seatPlan(detail, cityContext.heightAt);
  cityContext.realized.add(seated);
  cityContext.display.buildings[i] = seated;
  cityContext.queueSwap(id, seated);
}

/** An exterior the shared cache evicted goes back to its compact plan. */
export function restoreCompact(cityContext: City3dContext, id: string): void {
  const i = cityContext.slotOf(id),
    base = cityContext.byId.get(id);
  if (!cityContext.display || i < 0 || !base || !cityContext.realized.has(cityContext.display.buildings[i])) return;
  const compact = isBuildingProjection(base) ? base : compactBuilding(seatPlan(base, cityContext.heightAt));
  cityContext.display.kinds.detailed--;
  cityContext.display.kinds[city3dDisplayKind(base)]++;
  cityContext.display.buildings[i] = compact;
  cityContext.queueSwap(id, compact);
}

/** Native exterior of compact plans, two at a time; the display swaps them in. */
export async function realize(cityContext: City3dContext, ids: string[]): Promise<void> {
  // With the shared controller, demand comes from the camera and the selection.
  if (cityContext.options.details) {
    cityContext.driveDetails();
    return;
  }
  const scene = cityContext.sceneOf,
    epoch = cityContext.sourceEpoch;
  // A projection is never a native realization input. Only the shared cold
  // loader/controller may resolve its actual retained record and archive.
  if (!scene || 'projection' in scene) return;
  const [{ realizeUrbanBuilding }, { nativeExteriorDetail }] = await cityContext.detailModules();
  if (cityContext.disposed || cityContext.sceneOf !== scene || cityContext.sourceEpoch !== epoch) return;
  const queue = ids.filter(id => !cityContext.details.has(id) && !cityContext.converting.has(id));
  for (const id of queue) cityContext.converting.add(id);
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (cityContext.disposed || cityContext.sourceEpoch !== epoch || cityContext.sceneOf !== scene) {
        cityContext.converting.delete(id);
        continue;
      }
      const base = cityContext.byId.get(id);
      if (!base || isBuildingProjection(base) || city3dDisplayKind(base) !== 'compact') {
        cityContext.converting.delete(id);
        continue;
      }
      try {
        const batch = await realizeUrbanBuilding(base, executionRuntime, false, scene);
        if (cityContext.disposed || cityContext.sourceEpoch !== epoch || !cityContext.samePlan(cityContext.byId.get(id), base)) continue;
        const detail = nativeExteriorDetail(base, batch).building;
        cityContext.details.set(id, detail);
        cityContext.detailBases.set(id, base);
        cityContext.swapDetail(id, detail);
      } catch (e) {
        if (!cityContext.disposed && cityContext.sourceEpoch === epoch) cityContext.info.dataset.detailError = String(e);
      } finally {
        cityContext.converting.delete(id);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  cityContext.updateInfo();
}

export function detailAround(cityContext: City3dContext): void {
  if (cityContext.options.details) {
    cityContext.driveDetails();
    return;
  }
  const t = cityContext.terrain,
    scene = cityContext.sceneOf;
  if (!t || !scene || 'projection' in scene) return;
  const c = t.getCamera(),
    radius = Math.max(60, Math.min(250, c.distance * 0.6));
  // Partial selection of the 24 nearest (earlier building wins ties, as with a stable sort).
  const best: { id: string; d: number }[] = [];
  for (const b of scene.buildings) {
    if (city3dDisplayKind(b) !== 'compact' || cityContext.details.has(b.id)) continue;
    const p = cityContext.center(b),
      d = Math.hypot(p.x - c.x, p.y - c.y);
    if (!(d < radius) || (best.length === 24 && d >= best[23].d)) continue;
    let at = best.length;
    while (at > 0 && best[at - 1].d > d) at--;
    best.splice(at, 0, { id: b.id, d });
    if (best.length > 24) best.pop();
  }
  const near = best.map(e => e.id);
  cityContext.info.dataset.detailError = '';
  if (!near.length) {
    cityContext.info.textContent = urbanText([
      'Aucun plan compact à détailler près du centre de la vue.',
      'No compact plans to detail near the centre of the view.',
      '视图中心附近没有可细化的紧凑平面。',
      'No hay planos compactos que detallar cerca del centro de la vista.',
      'Não há plantas compactas para detalhar perto do centro da vista.',
    ]);
    return;
  }
  void cityContext.realize(near);
}
