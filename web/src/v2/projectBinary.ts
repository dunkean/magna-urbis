import type { World } from '../gen/types';
import type { V2Project, V2Settings } from './contracts';
import { V2_ENGINE_VERSION } from './cache';
import { parseProjectValue, validateSettings, validateWorld } from './project';

// All offsets (including block alignment) are relative to the decompressed payload.
const MAGIC = new Uint8Array([0x4d, 0x55, 0x50, 0x52, 0x4f, 0x4a, 0, 1]);
export const MAX_BINARY_PROJECT_BYTES = 2 * 1024 ** 3;
export const MAX_DECOMPRESSED_PROJECT_BYTES = 1.5 * 1024 ** 3;
const COMPRESSED_LIMIT = 'Binary project is too large (2 GiB compressed maximum).';
const DECOMPRESSED_LIMIT = 'Project is too large after decompression (1.5 GiB maximum).';
const ARRAY_ERROR = 'Invalid binary project array reference.';
const BLOCK_ERROR = 'Invalid or truncated binary project block.';
const arrayTypes = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, BigInt64Array, BigUint64Array };
type TypedArray = InstanceType<(typeof arrayTypes)[keyof typeof arrayTypes]>;
type ArrayType = keyof typeof arrayTypes;
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const aligned = (offset: number) => Math.ceil(offset / 8) * 8;

export function isBinaryProject(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((byte, index) => bytes[index] === byte);
}

/** Keep the size bound on the stream, before collecting or allocating its full output. */
function limited(stream: ReadableStream<Uint8Array>, maximum: number, message: string): ReadableStream<Uint8Array> {
  let size = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maximum) throw new Error(message);
        controller.enqueue(chunk);
      },
    }),
  );
}

function reverseElements(bytes: Uint8Array, width: number): void {
  for (let offset = 0; offset < bytes.length; offset += width) bytes.subarray(offset, offset + width).reverse();
}

export async function serializeProjectBinary(settings: V2Settings, world?: World, mods: unknown[] = []): Promise<Blob> {
  validateSettings(settings);
  if (world) validateWorld(world);
  if (typeof CompressionStream === 'undefined') throw new Error('Gzip compression is unavailable in this runtime.');
  const project: V2Project = { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, ...(world ? { world } : {}), mods };
  const indices = new Map<object, number>(),
    blocks: TypedArray[] = [];
  // Only the skeleton becomes JSON; raster elements never become decimal strings.
  const skeleton = new TextEncoder().encode(
    JSON.stringify(project, (_key, value: unknown) => {
      if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        const type = Object.prototype.toString.call(value).slice(8, -1);
        if (!Object.hasOwn(arrayTypes, type)) throw new Error('Unsupported binary project array type.');
        let index = indices.get(value);
        if (index === undefined) {
          index = blocks.length;
          indices.set(value, index);
          blocks.push(value as TypedArray);
        }
        return { $mub: index, type, length: (value as TypedArray).length };
      }
      if (typeof value === 'number' && !Number.isFinite(value)) return { $mu: 'number', value: String(value) };
      return value;
    }),
  );
  let offset = 4 + skeleton.byteLength;
  if (offset > MAX_DECOMPRESSED_PROJECT_BYTES) throw new Error(DECOMPRESSED_LIMIT);
  const header = new ArrayBuffer(4);
  new DataView(header).setUint32(0, skeleton.byteLength, true);
  const parts: BlobPart[] = [header, skeleton];
  for (const block of blocks) {
    const start = aligned(offset);
    if (start + block.byteLength > MAX_DECOMPRESSED_PROJECT_BYTES) throw new Error(DECOMPRESSED_LIMIT);
    if (start > offset) parts.push(new Uint8Array(start - offset));
    let bytes = new Uint8Array(block.buffer, block.byteOffset, block.byteLength);
    if (!littleEndian && block.BYTES_PER_ELEMENT > 1) {
      bytes = bytes.slice();
      reverseElements(bytes, block.BYTES_PER_ELEMENT);
    }
    parts.push(bytes);
    offset = start + block.byteLength;
  }
  const stream = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
  const gzip = await new Response(limited(stream, MAX_BINARY_PROJECT_BYTES - MAGIC.length, COMPRESSED_LIMIT)).blob();
  return new Blob([MAGIC, gzip], { type: 'application/octet-stream' });
}

export async function parseProjectBinary(buffer: ArrayBuffer): Promise<V2Project> {
  if (buffer.byteLength > MAX_BINARY_PROJECT_BYTES) throw new Error(COMPRESSED_LIMIT);
  if (!isBinaryProject(new Uint8Array(buffer))) throw new Error('Invalid binary project magic or unsupported format version.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Gzip decompression is unavailable in this runtime.');
  let payload: ArrayBuffer;
  try {
    const stream = new Blob([new Uint8Array(buffer, MAGIC.length)]).stream().pipeThrough(new DecompressionStream('gzip'));
    payload = await new Response(limited(stream, MAX_DECOMPRESSED_PROJECT_BYTES, DECOMPRESSED_LIMIT)).arrayBuffer();
  } catch (error) {
    if (error instanceof Error && error.message === DECOMPRESSED_LIMIT) throw error;
    throw new Error('Invalid or truncated gzip project data.');
  }
  const skeletonError = 'Invalid or truncated project skeleton.';
  if (payload.byteLength < 4) throw new Error(skeletonError);
  const length = new DataView(payload).getUint32(0, true);
  let offset = 4 + length;
  if (!length || offset > payload.byteLength) throw new Error(skeletonError);
  let skeleton: unknown;
  try {
    skeleton = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(payload, 4, length)));
  } catch {
    throw new Error(skeletonError);
  }
  const blocks: { type: ArrayType; length: number; array: TypedArray }[] = [];
  function restore(value: unknown, depth = 0): unknown {
    if (depth > 100) throw new Error('Project structure is too complex.');
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, '$mub')) {
      const index = record.$mub,
        type = record.type,
        count = record.length;
      if (Object.keys(record).length !== 3 || !Number.isSafeInteger(index) || Number(index) < 0 || Number(index) > blocks.length || typeof type !== 'string' || !Object.hasOwn(arrayTypes, type) || !Number.isSafeInteger(count) || Number(count) < 0) throw new Error(ARRAY_ERROR);
      const known = blocks[Number(index)];
      if (known) {
        if (known.type !== type || known.length !== count) throw new Error(ARRAY_ERROR);
        return known.array;
      }
      const constructor = arrayTypes[type as ArrayType],
        size = Number(count) * constructor.BYTES_PER_ELEMENT;
      const start = aligned(offset),
        end = start + size;
      if (!Number.isSafeInteger(end) || end > payload.byteLength) throw new Error(BLOCK_ERROR);
      for (let i = offset; i < start; i++) if (new Uint8Array(payload)[i] !== 0) throw new Error(BLOCK_ERROR);
      // Copy only this view's bytes into a fresh, aligned buffer, independent of the input.
      const bytes = new Uint8Array(payload.slice(start, end));
      if (!littleEndian && constructor.BYTES_PER_ELEMENT > 1) reverseElements(bytes, constructor.BYTES_PER_ELEMENT);
      const array = new constructor(bytes.buffer);
      blocks.push({ type: type as ArrayType, length: Number(count), array });
      offset = end;
      return array;
    }
    for (const key of Object.keys(record)) record[key] = restore(record[key], depth + 1);
    return value;
  }
  const project = restore(skeleton);
  if (offset !== payload.byteLength) throw new Error('Unexpected trailing binary project data.');
  return parseProjectValue(project);
}
