/**
 * One-shot workers for project files: parse and serialize (JSON or binary .muproj) and compose a file with the current
 * project. Used by the import dialog (projects.ts) and the export dialog (exports.ts); each call starts and ends a worker.
 */
import type { V2Settings } from '../contracts';
import type { World } from '../../gen/types';
import { runtimeWorkerOptions } from '../platform';
import { resultTransferBuffers } from '../transfer';
import ProjectWorker from '../project.worker?worker';
import ComposeWorker from '../compose.worker?worker';

export function projectJob<T>(request: unknown, transfer: Transferable[] = []): Promise<T> {
  if ((request as { action?: string }).action === 'serialize-binary') {
    request = structuredClone(request);
    transfer = resultTransferBuffers(request);
  }
  const worker = new ProjectWorker(runtimeWorkerOptions());
  return new Promise<T>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(request, transfer);
  });
}

export function composeJob(request: unknown, transfer: Transferable[] = []): Promise<{ settings: V2Settings; world?: World; mods: unknown[] }> {
  const worker = new ComposeWorker(runtimeWorkerOptions());
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(request, transfer);
  });
}
