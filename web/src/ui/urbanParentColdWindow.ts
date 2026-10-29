import { PARENT_VISUAL_VERSION, translateParentVisualRecords } from './urbanParentVisual';
/** Child-only native parent window. Both parent/context AND member indexes are
 * queried. No native archive/full projection is read on a valid cache hit. */
import type { Point, HouseMaterial } from '../../../rust/bridge/housesContract';
import { parentBoundsOverlap, surfaceBounds, type ParentBounds } from '../../../rust/bridge/nativeParentOccupation';
import { validateParentManifest, type ParentChunkBackend, type ParentSceneManifest, type ParentMemberIndex, type ParentSourceIndex } from './urbanParentChunkStore';
import { decodeParentVisual } from './urbanParentVisualCache';
import type { ParentMemberVisual, ParentContextVisual, ParentVisualSummary, ParentVisualRecords } from './urbanParentVisual';
import { coldVisualVertices } from './urbanColdVisualWindow';
import { buildingSurfaceContains } from '../render/urbanBuildingLod';
export const PARENT_WINDOW_LIMITS = Object.freeze({ maxTiles: 64, maxCandidates: 4096, maxMembers: 2048, maxParents: 2048,
  maxContexts: 4096, maxChunks: 64, maxEncodedBytes: 8 * 1024 * 1024, maxDecodeBytes: 8 * 1024 * 1024, maxVertices: 200000 });
export type ParentMapSelection = { kind: 'member'; parent_id: string; member_id: string; member_key: string | null }
  | { kind: 'context'; parent_id: string; context_key: string; context_kind: ParentContextVisual['kind'] };
export type ParentMapPick = { status: 'pending'; reason: string } | { status: 'exact'; selection?: ParentMapSelection };
export interface ParentWindowSnapshot extends ParentVisualRecords { sourceFingerprint: string; manifestFingerprint: string;
  viewport: ParentBounds; complete: boolean; reason: string; encodedBytes: number; vertices: number; candidates: number; chunks: number;
  maxDecodedChunkVertices: number }
const inside = (b: ParentBounds, p: Point) => p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3];
function tiles(b: ParentBounds): string[] | undefined {
  const x0 = Math.floor(b[0] / 256), x1 = Math.floor(b[2] / 256), y0 = Math.floor(b[1] / 256), y1 = Math.floor(b[3] / 256);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > PARENT_WINDOW_LIMITS.maxTiles) return;
  const result = ['*']; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) result.push(`${x},${y}`); return result;
}
export function pickParentSnapshot(snapshot: ParentWindowSnapshot | undefined, point: Point): ParentMapPick {
  if (!snapshot || !inside(snapshot.viewport, point)) return { status: 'pending', reason: 'outside-current-window' };
  for (let i = snapshot.members.length - 1; i >= 0; i--) { const m = snapshot.members[i];
    if (buildingSurfaceContains(m.roof_footprint.length ? m.roof_footprint : m.footprint, point))
      return { status: 'exact', selection: { kind: 'member', parent_id: m.parent_id, member_id: m.member_id, member_key: m.member_key } };
  }
  for (let i = snapshot.contexts.length - 1; i >= 0; i--) { const c = snapshot.contexts[i]; if (buildingSurfaceContains(c.surface, point))
    return { status: 'exact', selection: { kind: 'context', parent_id: c.parent_id, context_key: c.key, context_kind: c.kind } };
  }
  // Never reuse modal's outside-everything => parent fallback.
  return snapshot.complete ? { status: 'exact' } : { status: 'pending', reason: snapshot.reason };
}
export async function openParentColdWindow(backend: ParentChunkBackend, sceneId: string, options: { offset?: Point; signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted(); const manifest = await backend.manifest(sceneId);
  if (!manifest || !backend.visualChunk || !backend.parentTile) throw new Error('Native parent child-window source/cache is unavailable.');
  await validateParentManifest(manifest); const m: ParentSceneManifest = manifest;
  const dx = options.offset?.x ?? 0, dy = options.offset?.y ?? 0;
  if (![dx, dy].every(Number.isFinite)) throw new Error('Invalid parent display offset.');
  let disposed = false, epoch = 0, snapshot: ParentWindowSnapshot | undefined;
  const check = (own: number) => { options.signal?.throwIfAborted(); if (disposed || own !== epoch) throw new DOMException('Parent visual window replaced', 'AbortError'); };
  async function query(viewport: ParentBounds): Promise<ParentWindowSnapshot> {
    const own = ++epoch; check(own);
    if (!viewport.every(Number.isFinite) || viewport[0] > viewport[2] || viewport[1] > viewport[3]) throw new Error('Invalid parent viewport.');
    const local: ParentBounds = [viewport[0] - dx, viewport[1] - dy, viewport[2] - dx, viewport[3] - dy], keys = tiles(local);
    const memberCandidates = new Map<string, ParentMemberIndex>(), parentCandidates = new Map<string, ParentSourceIndex>();
    let reason = keys ? 'complete' : 'tiles';
    if (keys) for (const key of keys) {
      check(own); const remaining = PARENT_WINDOW_LIMITS.maxCandidates - memberCandidates.size - parentCandidates.size;
      if (remaining <= 0) { reason = 'candidates'; break; }
      const parents = await backend.parentTile!(sceneId, key, remaining); check(own);
      for (const p of parents.entries) if (parentBoundsOverlap(local, p.bounds)) parentCandidates.set(p.id, p);
      if (parents.truncated) { reason = 'candidates'; break; }
      const left = PARENT_WINDOW_LIMITS.maxCandidates - parentCandidates.size - memberCandidates.size;
      if (left <= 0) { reason = 'candidates'; break; }
      const members = await backend.tile(sceneId, key, left); check(own);
      for (const member of members.entries) if (parentBoundsOverlap(local, member.bounds)) memberCandidates.set(member.id, member);
      if (members.truncated) { reason = 'candidates'; break; }
    }
    const chunkIds = [...new Set([...parentCandidates.values(), ...memberCandidates.values()].map(r => r.chunkIndex))].sort((a, b) => a - b);
    const members: ParentMemberVisual[] = [], contexts: ParentContextVisual[] = [], parents: ParentVisualSummary[] = [];
    const materials = new Map<string, HouseMaterial>(); let encodedBytes = 0, vertices = 0, chunks = 0, maxDecodedChunkVertices = 0;
    outer: for (const index of chunkIds) {
      check(own); if (chunks >= PARENT_WINDOW_LIMITS.maxChunks) { reason = 'chunks'; break; }
      const expected = m.chunks[index], cached = await backend.visualChunk!(sceneId, index); check(own);
      if (!expected || !cached) throw new Error(`Parent visual cache missing at chunk${index}; explicit bounded repair required.`);
      if (cached.bytes > PARENT_WINDOW_LIMITS.maxDecodeBytes || encodedBytes + cached.bytes > PARENT_WINDOW_LIMITS.maxEncodedBytes) { reason = 'bytes'; break; }
      const data = await decodeParentVisual(cached, expected.sha256); check(own); chunks++; encodedBytes += cached.bytes;
      if (data.members.length !== expected.counts.physical_members || data.parents.length !== expected.counts.admitted_parents) throw new Error('Parent child/native count mismatch.');
      maxDecodedChunkVertices = Math.max(maxDecodedChunkVertices, coldVisualVertices(data));
      for (const material of data.materials) {
        const old = materials.get(material.id); if (old && JSON.stringify(old) !== JSON.stringify(material)) throw new Error('Conflicting native parent visual material.');
        materials.set(material.id, material);
      }
      const ownParents = new Map(data.parents.map(p => [p.id, p]));
      const selectedMembers = [...memberCandidates.values()].filter(r => r.chunkIndex === index).sort((a, b) => a.rowIndex - b.rowIndex || a.memberOrdinal - b.memberOrdinal);
      const localMembers = new Map(data.members.map(member => [member.member_id, member]));
      for (const entry of selectedMembers) {
        const member = localMembers.get(entry.id), parent = ownParents.get(entry.parentId);
        if (!member || !parent || member.parent_id !== entry.parentId || member.member_key !== entry.memberKey || member.archive_sha256 !== parent.archive_sha256) throw new Error('Parent child/member index identity mismatch.');
        const n = coldVisualVertices(member);
        if (members.length >= PARENT_WINDOW_LIMITS.maxMembers) { reason = 'members'; break outer; }
        if (vertices + n > PARENT_WINDOW_LIMITS.maxVertices) { reason = 'vertices'; break outer; }
        members.push(member); vertices += n;
      }
      for (const entry of [...parentCandidates.values()].filter(r => r.chunkIndex === index).sort((a, b) => a.rowIndex - b.rowIndex)) {
        const parent = ownParents.get(entry.id); if (!parent || parent.parcel_id !== entry.parcelId) throw new Error('Parent context index identity mismatch.');
        if (parents.length >= PARENT_WINDOW_LIMITS.maxParents) { reason = 'parents'; break outer; } parents.push(parent);
        for (const c of data.contexts.filter(c => c.parent_id === entry.id && parentBoundsOverlap(local, surfaceBounds(c.surface)))) {
          const n = coldVisualVertices(c);
          if (contexts.length >= PARENT_WINDOW_LIMITS.maxContexts) { reason = 'contexts'; break outer; }
          if (vertices + n > PARENT_WINDOW_LIMITS.maxVertices) { reason = 'vertices'; break outer; } contexts.push(c); vertices += n;
        }
      }
    }
    const display = translateParentVisualRecords({ version: PARENT_VISUAL_VERSION, members, contexts, parents, materials: [...materials.values()] }, dx, dy);
    const value: ParentWindowSnapshot = { ...display, sourceFingerprint: m.sourceFingerprint, manifestFingerprint: m.fingerprint,
      viewport: [...viewport], complete: reason === 'complete', reason, encodedBytes, vertices,
      candidates: memberCandidates.size + parentCandidates.size, chunks, maxDecodedChunkVertices };
    check(own); snapshot = value; return value;
  }
  return { manifest: m, get snapshot() { return snapshot; }, query,
    pick(point: Point): ParentMapPick { return pickParentSnapshot(snapshot, point); },
    async pickAt(point: Point): Promise<ParentMapPick> { const result = await query([point.x, point.y, point.x, point.y]); return pickParentSnapshot(result, point); },
    dispose() { disposed = true; epoch++; snapshot = undefined; } };
}
export type ParentColdWindow = Awaited<ReturnType<typeof openParentColdWindow>>;
