import type { Decor } from './decor';
import { DECOR_FILE_MEMORY_LIMIT, exportDecorFile, type DecorFileOptions } from './decorFile';

/** Codes and automation need complete bytes; large cities must use the disk
 * streaming export. A caller may reserve framing space by lowering this bound. */
export async function encodeDecorFileBytes(decor: Decor, options: DecorFileOptions & { maxBytes?: number } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const limit = options.maxBytes ?? DECOR_FILE_MEMORY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > DECOR_FILE_MEMORY_LIMIT) throw new Error('Invalid portable decor byte budget.');
  const parts: Uint8Array[] = []; let size = 0;
  for await (const part of exportDecorFile(decor, options)) {
    options.signal?.throwIfAborted();
    size += part.byteLength;
    if (size > limit) throw new Error(`Contenu trop volumineux pour cet export en mémoire (budget ${Math.floor(limit / 1024 / 1024)} Mio). Utilisez le partage .decor avec enregistrement direct sur disque.`);
    parts.push(part);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
