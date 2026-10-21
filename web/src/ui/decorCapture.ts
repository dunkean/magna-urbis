import { terrainGeography } from '../../../rust/bridge/urbanGeography';
import { settlementRaster, type RoadConfig, type RoadOutput, type SettlementOutput } from '../../../rust/bridge/settlements';
import { COAST_DIRECTIONS, type TerrainData, type TerrainSettings } from '../../../rust/bridge/terrain';
import { DEFAULT_HYDROLOGY, riverAreaFor } from '../../../rust/bridge/hydrology';
import { renderHydrology } from '../../../rust/bridge/hydrologyRender';
import { vectorWaterSvg, lakeShores } from './vectorWaterRender';
import { lakeField } from './lakeGeometry';
import { encodeWaterField, seaDistanceSurface } from '../render/terrainWater';
import { hydrologyLakePath } from '../../../rust/bridge/hydrologyRender';
import { encodeDecor, rasterStats, type Decor, type DecorMeta } from './decor';

/** Default classification of a Terrain Bench map; the batch exporter adds its own tags. */
function tagsOf(settings: TerrainSettings, output: SettlementOutput, roadConfig: RoadConfig | null): Record<string, string> {
  const mask = settings.coastMask ?? 0, coasts = COAST_DIRECTIONS.filter((_, i) => mask & (1 << i));
  const h = settings.hydrology ?? DEFAULT_HYDROLOGY, main = output.settlements.slice().sort((a, b) => b.population - a.population)[0];
  return {
    source: settings.source ?? 'procedural', hydrology: h.engine,
    relief: settings.relief, coast: mask === 255 ? settings.islandMode ?? 'island' : coasts.length ? coasts.join('+') : 'inland',
    river: h.enabled ? h.main : 'none', meanders: h.meanders, lakes: h.lakes,
    roads: roadConfig ? `${roadConfig.level}/${roadConfig.culture}` : 'none', culture: main?.culture ?? '',
  };
}

/** Length of the Rust hydrology network (x, y, width, z per vertex). */
function riverKm(t: TerrainData): number {
  const h = t.hydrology; if (!h) return 0;
  let m = 0;
  for (let id = 0; id < h.riverOffsets.length - 1; id++) for (let j = h.riverOffsets[id] + 1; j < h.riverOffsets[id + 1]; j++) {
    m += Math.hypot(h.riverPoints[j * 4] - h.riverPoints[j * 4 - 4], h.riverPoints[j * 4 + 1] - h.riverPoints[j * 4 - 3]);
  }
  return m / 1000;
}

/** Retained layers for an in-memory transfer; encoding belongs at the file boundary. */
export function captureDecorData(t: TerrainData, settings: TerrainSettings, output: SettlementOutput, roads: RoadOutput | undefined, roadConfig: RoadConfig | null,
  extra: { id?: string; label?: string; tags?: Record<string, string>; query?: string; pipeline?: DecorMeta['pipeline'] } = {}): Decor {
  if (t.hydrologyError) throw new Error(`Cannot export decor: ${t.hydrologyError}`);
  const raster = { ...settlementRaster(t, 1024), geometry: terrainGeography(t) }, h = settings.hydrology ?? DEFAULT_HYDROLOGY;
  const waterSvg = t.water
    ? vectorWaterSvg(t.water, { style: 'atlas', showLakes: true, showOxbows: true, riverArea: riverAreaFor(h, settings.width), riverMode: h.riverMode ?? 'vector', overlay: 'none' }, false)
    : t.hydrology ? renderHydrology(t.hydrology, 'none', true, 'atlas', false) : '';
  const sea = seaDistanceSurface(t, settings.width);
  const retainedSea = { distance: encodeWaterField(sea.distance), n: sea.n };
  const relief = settings.relief, id = extra.id ?? `${relief}-${settings.seed}`.replace(/[^\w.-]+/g, '_');
  const decor: Decor = {
    meta: {
      format: 'magna-decor', version: 1, id, label: extra.label ?? `${relief} · seed ${settings.seed}`,
      tags: { ...tagsOf(settings, output, roadConfig), ...extra.tags, source: settings.source ?? 'procedural', hydrology: h.engine },
      seed: settings.seed, width: t.width, query: extra.query ?? location.search.replace(/^\?/, ''), created: new Date().toISOString(),
      settlements: output.settlements, roadConfig, roads: roads ?? null, waterSvg, pipeline: extra.pipeline,
      waterMaterial: t.water ? { field: encodeWaterField(lakeField(t.water.lake, t.water.hydro.n).values), n: t.water.hydro.n, width: t.width, referenceWidth: t.width, sea: retainedSea, path: lakeShores(t.water) }
        : t.hydrology ? { field: encodeWaterField(t.hydrology.waterField), n: t.hydrology.resolution, width: t.width, referenceWidth: t.width, sea: retainedSea, path: hydrologyLakePath(t.hydrology) } : { field: '', n: 0, width: t.width, referenceWidth: t.width, sea: retainedSea, path: '' },
      terrainDisplay: { referenceWidth: t.width, floor: t.field?.floor ?? 0, sourceCell: settings.width / 1024, refine: !!settings.refine,
        globalMinHeight: t.globalMinHeight, globalMaxHeight: t.globalMaxHeight, motifSize: t.motifSize },
      stats: { ...rasterStats(raster), riverKm: t.water?.rivers?.lengthKm ?? riverKm(t), roadKm: (roads?.segments.reduce((s, r) => s + r.length, 0) ?? 0) / 1000 },
    },
    raster,
  };
  return decor;
}

/** The same retained layers encoded once for a portable decor file. */
export function captureDecor(...args: Parameters<typeof captureDecorData>): { bytes: Uint8Array; meta: DecorMeta } {
  const decor = captureDecorData(...args);
  return { bytes: encodeDecor(decor), meta: decor.meta };
}

export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
