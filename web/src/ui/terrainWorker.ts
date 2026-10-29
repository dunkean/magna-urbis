import { seaDistanceSurface, type WaterSurface } from '../render/terrainWater';
import { sampleRustTerrain, type TerrainData, type TerrainRequest, type TerrainResponse, type TerrainPipelineCommand } from '../../../rust/bridge/terrain';
import { TerrainPipelineSession, pipelinePreview } from './terrainPipelineSession';
import { renderRustTerrain } from '../../../rust/bridge/terrainRender';
import { MaterialRasterUnavailableError } from '../../../rust/bridge/terrainMaterialContext';

let latestGeneration = 0;
const transfers = (t: TerrainData): ArrayBuffer[] => [...new Set([t.height.buffer, t.caveMask.buffer, t.normalX.buffer, t.normalY.buffer, t.normalZ.buffer,
  ...(t.field ? [t.field.data.buffer, ...(t.field.cave ? [t.field.cave.buffer] : [])] : [])])] as ArrayBuffer[];
let pending: TerrainRequest | undefined;
let running = false;
let pipelineSession:TerrainPipelineSession|undefined;
self.onmessage = (event: MessageEvent<TerrainRequest|TerrainPipelineCommand>) => {
  if(event.data.kind==='pipeline'){if(event.data.generation===pipelineSession?.request.generation)pipelineSession.command(event.data.command);return;}
  const { generation } = event.data;
  if (generation < latestGeneration) return;
  latestGeneration = generation;
  if(event.data.kind==='overview')pipelineSession?.command('cancel');
  pending = event.data;
  if (!running) void drain();
};
let materialSurface: WaterSurface | undefined;
async function drain(): Promise<void> {
  running = true;
  try {
    while (pending) {
      const request = pending; pending = undefined;
      const { id, generation, kind } = request;
      try {
        pipelineSession=request.inspection?new TerrainPipelineSession(request,stage=>{
          if(generation!==latestGeneration)return;
          const preview=stage.height?pipelinePreview(stage.height,request):undefined;
          const {height:_height,...info}=stage;
          self.postMessage({id,generation,kind,stage:info,preview} satisfies TerrainResponse,{transfer:preview?transfers(preview):[]});
        }):undefined;
        const terrain = await sampleRustTerrain(request, relief => {
          if (generation === latestGeneration) self.postMessage({ id, generation, kind, terrain: relief, partial: true } satisfies TerrainResponse, { transfer: transfers(relief) });
        }, progress => {
          if (generation === latestGeneration) self.postMessage({ id, generation, kind, progress } satisfies TerrainResponse);
        },pipelineSession?.control);
        if(pipelineSession){await pipelineSession.control.before('render');await pipelineSession.control.after('render');}
        const waiting = pending as TerrainRequest | undefined;
        // A newer camera region replaces a region; nothing but a new generation replaces an overview.
        if (generation !== latestGeneration || (waiting && waiting.id > id && waiting.kind === kind)) continue;
        const started = performance.now();
        if (kind === 'overview') materialSurface = seaDistanceSurface(terrain, request.settings.width);
        const displayTerrain = { ...terrain, waterSurface: materialSurface };
        let scene: ReturnType<typeof renderRustTerrain> | undefined;
        try {
          scene = request.scene ? renderRustTerrain(displayTerrain, request.scene.style, kind === 'overview', request.settings, request.scene.showContours, `worker-${generation}-${id}`, request.scene.lighting, request.scene.layers, undefined, true, request.scene.waterStyle) : undefined;
        } catch (error) {
          // Keep the sampled terrain: the page may support HTMLCanvasElement
          // WebGL2 even when this worker has no OffscreenCanvas WebGL2 context.
          if (!(error instanceof MaterialRasterUnavailableError)) throw error;
        }
        const scenePreparationMs = scene ? performance.now() - started : undefined;
        self.postMessage({ id, generation, kind, terrain, scene, scenePreparationMs } satisfies TerrainResponse, { transfer: transfers(terrain) });
      } catch (error) {
        if (generation === latestGeneration) self.postMessage({ id, generation, kind, error: error instanceof Error ? error.message : String(error) } satisfies TerrainResponse);
      } finally {pipelineSession=undefined;}
    }
  } finally { running = false; }
}
