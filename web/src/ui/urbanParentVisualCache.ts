/** Child cache, never source authority or native realization input. Exported
 * native archives omit it; cache miss requires explicit bounded native repair. */
import { parentWire } from '../../../rust/bridge/nativeParentBudget';
import { parentDigest } from '../../../rust/bridge/nativeParentStream';
import { PARENT_VISUAL_VERSION, type ParentVisualRecords } from './urbanParentVisual';
export const PARENT_VISUAL_CHUNK_BYTES = 8 * 1024 * 1024;
export interface ParentVisualChunk { version: typeof PARENT_VISUAL_VERSION; index: number; sourceSha256: string;
  sha256: string; bytes: number; json: string }
export async function encodeParentVisual(index: number, sourceSha256: string, records: ParentVisualRecords): Promise<ParentVisualChunk> {
  const json = parentWire(records).json, bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > PARENT_VISUAL_CHUNK_BYTES) throw new Error('Native parent visual chunk exceeds cold decode budget.');
  return { version: PARENT_VISUAL_VERSION, index, sourceSha256, sha256: await parentDigest(json), bytes, json };
}
export async function decodeParentVisual(chunk: ParentVisualChunk, sourceSha256: string): Promise<ParentVisualRecords> {
  if (chunk?.version !== PARENT_VISUAL_VERSION || chunk.sourceSha256 !== sourceSha256 || !/^[a-f0-9]{64}$/.test(chunk.sha256)
    || chunk.bytes > PARENT_VISUAL_CHUNK_BYTES || new TextEncoder().encode(chunk.json).byteLength !== chunk.bytes
    || await parentDigest(chunk.json) !== chunk.sha256) throw new Error('Parent visual cache is missing/stale/corrupt; rebuild from exact native archives.');
  const data = JSON.parse(chunk.json) as ParentVisualRecords;
  if (data?.version !== PARENT_VISUAL_VERSION || !Array.isArray(data.members) || !Array.isArray(data.parents)
    || !Array.isArray(data.contexts) || !Array.isArray(data.materials)) throw new Error('Invalid parent visual cache.');
  for (const member of data.members) {
    if (member.projection !== PARENT_VISUAL_VERSION || member.nativeRealization !== false || !member.parent_id || !member.member_id
      || member.id !== member.member_id || !/^[a-f0-9]{64}$/.test(member.archive_sha256)
      || ['resolved', 'programme', 'programme_outcome', 'useful_area_m2', 'domestic_units'].some(key => key in member)) throw new Error('Parent visual member is not a child-only record.');
  }
  return data;
}
