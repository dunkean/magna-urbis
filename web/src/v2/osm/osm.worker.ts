import { importOsm, type OsmImportInput } from './osmImport';
import { validateSettings, validateWorld } from '../project';
import { resultTransferBuffers } from '../transfer';

const ctx = self as unknown as Worker;
ctx.onmessage = async ({ data }: MessageEvent<OsmImportInput>) => {
  try {
    const result = importOsm(data);
    if (data.options.importBuildings === false) {
      ctx.postMessage({ housing: 0 });
      const { generateOsmBuildings } = await import('./osmBuildings');
      await generateOsmBuildings(result, progress => ctx.postMessage({ housing: progress.completed / Math.max(1, progress.total) }));
    }
    validateSettings(result.settings);
    validateWorld(result.world);
    ctx.postMessage({ result }, resultTransferBuffers(result));
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
