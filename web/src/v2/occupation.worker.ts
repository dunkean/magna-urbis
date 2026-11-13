import { OccupationPreparation } from '../ui/occupationPreparation';
import { OccupationQueue } from '../ui/occupationQueue';
import { floatPyramid } from '../render/floatPyramid';
import { shoreRingFor } from '../../../rust/bridge/terrainForestBeach';
import { lakeDistances, seaDistanceSurface, planningWaterDistances } from '../render/terrainWater';
import { loadRenderGeometry } from '../../../rust/bridge/renderGeometry';
import { buildForestField } from '../../../rust/bridge/terrainForest';
import type { DisplayPrepRequest, TerrainPrepResult } from './displayPrep';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
// Serialize bridge scratch arrays; optional detail yields to an occupation-to-merge message round trip.
const queue = new OccupationQueue(), occupation = new OccupationPreparation();
ctx.onmessage = ({ data }: MessageEvent<DisplayPrepRequest>) => {
  queue.enqueue(data.kind, async () => {
    const start = performance.now();
    try {
      let result: unknown;
      switch (data.kind) {
        case 'terrain': {
          await loadRenderGeometry();
          const timings: TerrainPrepResult['timings'] = [];
          const timed = <T>(product: string, build: () => T): T => { const t = performance.now(); const value = build(); timings.push({ product, ms: performance.now() - t }); return value; };
          const layer = data.input.layer;
          const lakes = data.input.lakes.map(v => timed('lake', () => lakeDistances(v.field, v.n, v.width, v.referenceWidth)));
          result = { sea: data.input.sea ?? timed('sea', () => seaDistanceSurface({ height: layer.data, resolution: layer.n, width: layer.width, x: layer.x, y: layer.y })),
            shore: timed('shore', () => shoreRingFor(layer)),
            lakes,
            planning: timed('planning-water', () => planningWaterDistances(data.input.planning.water, data.input.planning.n, data.input.planning.width)),
            heightMips: timed('height-mips', () => floatPyramid(layer.data, layer.n).slice(1)),
            lakeMips: data.input.lakes.map((v, i) => timed('lake-mips', () => ({ field: floatPyramid(v.field, v.n).slice(1), distance: floatPyramid(lakes[i], v.n).slice(1) }))), timings };
          break;
        }
        case 'register': occupation.register(data.input.revision, data.input.packed); break;
        case 'release': occupation.release(data.input.revision); break;
        case 'occupation': result = occupation.occupation(data.input.landuseRevision, data.input.revision, data.input.corridors); break;
        case 'detail': result = occupation.detail(data.input.landuseRevision); break;
        case 'merge': result = occupation.merge(data.input.shapes, data.input.source, data.input.retained); break;
        // Forest retains its beach/base caches for slider edits; never detach those cached planes.
        case 'forest': result = structuredClone(await buildForestField(data.input.input, data.input.settings, data.input.runtime)); break;
      }
      // Results have one owner after the reply; live input buffers are never transferred.
      const buffers = new Set<ArrayBuffer>();
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer); }
        else for (const child of Object.values(value)) visit(child);
      };
      visit(result);
      ctx.postMessage({ id: data.id, result, ms: performance.now() - start }, [...buffers]);
    } catch (error) { ctx.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error), ms: performance.now() - start }); }
  });
};
