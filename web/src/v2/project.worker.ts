import { parseProjectInput, serializeProjectChunks } from './project';
import { parseProjectBinary, serializeProjectBinary } from './projectBinary';
import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { resultTransferBuffers } from './transfer';
const ctx = self as unknown as Worker;
type ProjectRequest = { action: 'parse'; text: string } | { action: 'parse-binary'; buffer: ArrayBuffer } | { action: 'serialize' | 'serialize-binary'; settings: V2Settings; world?: World; mods: unknown[] };
ctx.onmessage = async ({ data }: MessageEvent<ProjectRequest>) => {
  try {
    if (data.action === 'parse' || data.action === 'parse-binary') {
      const result = data.action === 'parse' ? parseProjectInput(data.text) : await parseProjectBinary(data.buffer);
      ctx.postMessage({ result }, resultTransferBuffers(result));
    } else if (data.action === 'serialize-binary') {
      const result = await (await serializeProjectBinary(data.settings, data.world, data.mods)).arrayBuffer();
      ctx.postMessage({ result }, [result]);
    } else ctx.postMessage({ result: new Blob(serializeProjectChunks(data.settings, data.world, data.mods), { type: 'application/json' }) });
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
