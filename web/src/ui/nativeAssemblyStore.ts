/** One bounded experimental parent, separate from the applied Single city.
 * Only the native lossless archive is authoritative. Native unpack validates
 * every cold/import read before a projection is constructed. No city clone. */
import type { NativeAssemblyApi, NativeAssemblyArchive, RetainedNativeAssembly } from '../../../rust/bridge/nativeAssemblyContract';
export const ASSEMBLY_ARTIFACT_VERSION = 'native-assembly-proposal-1';
export const ASSEMBLY_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024;
export interface NativeAssemblyArtifact {
  version: typeof ASSEMBLY_ARTIFACT_VERSION; application: 'proposal_not_applied';
  parent_id: string; parcel_id: string; input_sha256: string; archive: NativeAssemblyArchive;
}
/** Observation at completion, never a persisted/current city binding. A
 * transaction may finish as history after its selected source was replaced. */
export interface NativeAssemblyCommitReceipt {
  application: 'proposal_not_applied';
  source_status: 'current_at_return' | 'historical_source_changed';
  archive_sha256: string; input_sha256: string;
}
export interface StoredNativeAssemblyArtifact { json: string; sha256: string; bytes: number }
export interface NativeAssemblyArtifactBackend {
  read(): Promise<StoredNativeAssemblyArtifact | undefined>;
  /** Atomic replacement, conditional on the previous artifact. */
  commit(value: StoredNativeAssemblyArtifact, expectedSha256: string | null, signal?: AbortSignal): Promise<void>;
}
const shaPattern = /^[a-f0-9]{64}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function check(ok: unknown, text: string): asserts ok { if (!ok) throw new Error(text); }
export async function assemblyInputFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  check(bytes.length <= ASSEMBLY_ARTIFACT_MAX_BYTES, 'Assembly input exceeds 32 MiB.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function parseAssemblyArtifact(json: string): NativeAssemblyArtifact {
  check(new TextEncoder().encode(json).byteLength <= ASSEMBLY_ARTIFACT_MAX_BYTES, 'Assembly artifact exceeds 32 MiB.');
  const value: unknown = JSON.parse(json);
  check(object(value) && value.version === ASSEMBLY_ARTIFACT_VERSION && value.application === 'proposal_not_applied'
    && typeof value.parent_id === 'string' && value.parent_id.length && typeof value.parcel_id === 'string' && value.parcel_id.length
    && typeof value.input_sha256 === 'string' && shaPattern.test(value.input_sha256)
    && Object.keys(value).length === 6, 'Invalid or unsupported native assembly proposal.');
  const archive = value.archive;
  check(object(archive) && archive.format === 'native-assembly-archive-1' && typeof archive.sha256 === 'string' && shaPattern.test(archive.sha256)
    && 'payload' in archive && Object.keys(archive).length === 3, 'Invalid native assembly archive envelope.');
  // This constructs only the versioned wrapper. The opaque payload is NOT a
  // resolved plan, and its native checksum/canonical/ownership checks follow.
  return { version: ASSEMBLY_ARTIFACT_VERSION, application: 'proposal_not_applied', parent_id: value.parent_id,
    parcel_id: value.parcel_id, input_sha256: value.input_sha256,
    archive: { format: 'native-assembly-archive-1', sha256: archive.sha256, payload: archive.payload } };
}
async function validateArtifact(artifact: NativeAssemblyArtifact, api: NativeAssemblyApi): Promise<RetainedNativeAssembly> {
  const native = await api.unpack(artifact.archive);
  check(native.capability === 'native-assembly-pair-1' && native.id === artifact.parent_id && native.parcel_id === artifact.parcel_id
    && native.members.length === 2 && native.members[0].key !== native.members[1].key
    && native.members[0].plan.id !== native.members[1].plan.id, 'Native archive parent/member identity mismatch.');
  return native;
}
/** Stage/validate native authority before replacing the previous saved parent. */
export async function stageNativeAssembly(backend: NativeAssemblyArtifactBackend, artifact: NativeAssemblyArtifact,
  api: NativeAssemblyApi, options: { current(): boolean; signal?: AbortSignal }) {
  check(options.current(), 'Assembly proposal source is stale.'); options.signal?.throwIfAborted();
  await api.require();
  check(options.current(), 'Assembly proposal source is stale.'); options.signal?.throwIfAborted();
  const canonical = parseAssemblyArtifact(JSON.stringify(artifact)), before = await backend.read();
  const native = await validateArtifact(canonical, api);
  check(options.current(), 'Assembly proposal source is stale.'); options.signal?.throwIfAborted();
  const json = JSON.stringify(canonical), stored = { json, sha256: await assemblyInputFingerprint(canonical), bytes: new TextEncoder().encode(json).byteLength };
  let committed = false;
  return { native, artifact: canonical, async commit(): Promise<NativeAssemblyCommitReceipt> {
    check(!committed && options.current(), 'Assembly stage already committed or stale.'); options.signal?.throwIfAborted();
    await backend.commit(stored, before?.sha256 ?? null, options.signal); committed = true;
    // No compensating deletion: a later proposal must never be erased. The
    // archive keeps its exact original identity and is always NON APPLIED.
    return { application: 'proposal_not_applied', source_status: options.current() ? 'current_at_return' : 'historical_source_changed',
      archive_sha256: canonical.archive.sha256, input_sha256: canonical.input_sha256 };
  } };
}
export async function readNativeAssemblyArtifact(backend: NativeAssemblyArtifactBackend, api: NativeAssemblyApi) {
  await api.require(); // Before even reading the opaque saved archive.
  const stored = await backend.read(); if (!stored) return undefined;
  const artifact = parseAssemblyArtifact(stored.json);
  check(stored.bytes === new TextEncoder().encode(stored.json).byteLength && stored.sha256 === await assemblyInputFingerprint(artifact), 'Stored assembly integrity mismatch.');
  return { artifact, native: await validateArtifact(artifact, api) };
}
/** One record only, a proposal store, never an alternative city scene authority. */
export async function openNativeAssemblyArtifactBackend(): Promise<NativeAssemblyArtifactBackend & { close(): void }> {
  check(typeof indexedDB !== 'undefined', 'IndexedDB unavailable for native assembly proposal.');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('magna-native-assembly-proposal-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('proposal');
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('Assembly proposal store is blocked.'));
  });
  return { close: () => db.close(), read: () => new Promise<StoredNativeAssemblyArtifact | undefined>((resolve, reject) => {
    const tx = db.transaction('proposal', 'readonly'), req = tx.objectStore('proposal').get('current');
    let value: StoredNativeAssemblyArtifact | undefined; req.onsuccess = () => { value = req.result; };
    tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(tx.error);
  }), commit: (value, expected, signal) => new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted(); const tx = db.transaction('proposal', 'readwrite'), store = tx.objectStore('proposal'), req = store.get('current');
    let reason: unknown;
    const abort = () => { reason = signal?.reason; try { tx.abort(); } catch { /* Transaction may already be terminal. */ } };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    req.onsuccess = () => { if ((req.result?.sha256 ?? null) !== expected) { reason = new Error('Saved assembly proposal was replaced.'); tx.abort(); }
      else store.put(value, 'current'); };
    tx.oncomplete = () => { cleanup(); resolve(); }; tx.onerror = tx.onabort = () => { cleanup(); reject(reason ?? tx.error); };
  }) };
}
