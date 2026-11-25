import { importOsm, type OsmImportInput } from './osmImport';
import { validateSettings, validateWorld } from '../project';
import { resultTransferBuffers } from '../transfer';

const ctx = self as unknown as Worker;
ctx.onmessage = ({ data }: MessageEvent<OsmImportInput>) => {
  try {
    const result = importOsm(data);
    validateSettings(result.settings);
    validateWorld(result.world);
    ctx.postMessage({ result }, resultTransferBuffers(result));
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
