export interface SurfaceSourceAttachment {
  path: Array<string | number>; encoding: 'utf8' | 'json-utf8' | 'base64'; bytes: Uint8Array;
}
export interface SurfaceSourceArchive { format: 'surface-source-archive-1'; attachments: SurfaceSourceAttachment[] }
const KEY = '$surfaceSourceArchive';
const LIMIT = 8192;
const utf8 = new TextEncoder();
const safe = (key: string | number) => !['__proto__', 'prototype', 'constructor'].includes(String(key));
const base64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
};

/** Binary-packet metadata projection. Small identities remain directly visible;
 * large source-only records become null slots with explicit attachment paths.
 * Use restoreSurfaceSource before accessing archived fields. No source or save
 * record is modified, and arbitrary opaque keys are never interpreted as tags. */
export function archiveSurfaceSource<T extends Record<string, unknown>>(source: T): T & { $surfaceSourceArchive?: SurfaceSourceArchive } {
  if (Object.hasOwn(source, KEY)) throw new Error('Source already has the reserved archive field.');
  const attachments: SurfaceSourceAttachment[] = [], parents = new Set<object>();
  const attach = (path: Array<string | number>, encoding: SurfaceSourceAttachment['encoding'], bytes: Uint8Array) => {
    attachments.push({ path, encoding, bytes }); return { value: null, size: 4, typed: false };
  };
  const walk = (value: unknown, path: Array<string | number>): { value: unknown; size: number; typed: boolean } => {
    if (ArrayBuffer.isView(value)) return { value: structuredClone(value), size: 32, typed: true };
    if (typeof value === 'string') {
      if (value.length <= LIMIT) return { value, size: value.length * 3 + 2, typed: false };
      const last = path.at(-1), waterField = (last === 'field' || last === 'distance') && path.includes('waterMaterial');
      if (waterField) {
        try { const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); if (base64(bytes) === value) return attach(path, 'base64', bytes); }
        catch { /* Non-base64 legacy strings are retained byte-exactly as UTF-8. */ }
      }
      return attach(path, 'utf8', utf8.encode(value));
    }
    if (!value || typeof value !== 'object') return { value, size: 32, typed: false };
    if (parents.has(value)) throw new Error('Cyclic surface source metadata.');
    if (['scene', 'layouts', 'partitions', 'geometry'].includes(String(path.at(-1)))) {
      const json = JSON.stringify(value);
      if (json.length > LIMIT) return attach(path, 'json-utf8', utf8.encode(json));
    }
    parents.add(value);
    const start = attachments.length;
    let size = 2, typed = false;
    const out: any = Array.isArray(value) ? [] : {};
    for (const [key, entry] of Object.entries(value)) {
      if (!safe(key)) throw new Error('Unsafe source metadata key.');
      const segment = Array.isArray(value) ? Number(key) : key, child = walk(entry, [...path, segment]);
      out[key] = child.value; size += key.length * 3 + child.size + 4; typed ||= child.typed;
    }
    parents.delete(value);
    if (path.length && !(path.length === 1 && path[0] === 'meta') && !typed && size > LIMIT) {
      attachments.splice(start);
      return attach(path, 'json-utf8', utf8.encode(JSON.stringify(value)));
    }
    return { value: out, size, typed };
  };
  const projected = walk(source, []).value as T & { $surfaceSourceArchive?: SurfaceSourceArchive };
  if (attachments.length) projected[KEY] = { format: 'surface-source-archive-1', attachments };
  return projected;
}

/** Restore only explicitly registered paths; a native/feature object containing
 * `arrayType`, `format` or `bytes` is never treated as an attachment by accident. */
export function restoreSurfaceSource<T extends Record<string, unknown>>(source: T): T {
  const result = structuredClone(source), archive = result[KEY] as SurfaceSourceArchive | undefined;
  if (!archive) return result;
  if (archive.format !== 'surface-source-archive-1' || !Array.isArray(archive.attachments)) throw new Error('Unsupported source archive.');
  const paths = new Set<string>();
  for (const item of archive.attachments) {
    if (!item || !Array.isArray(item.path) || !item.path.length || !item.path.every(safe) || !(item.bytes instanceof Uint8Array)) throw new Error('Invalid source attachment.');
    const id = JSON.stringify(item.path);
    if (paths.has(id)) throw new Error('Duplicate source attachment path.'); paths.add(id);
    let parent: any = result;
    for (const part of item.path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) throw new Error('Missing source attachment parent.');
      parent = parent[part];
    }
    const last = item.path.at(-1)!;
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, last) || parent[last] !== null) throw new Error('Source attachment target is not an empty slot.');
    if (item.encoding === 'base64') parent[last] = base64(item.bytes);
    else if (item.encoding === 'utf8' || item.encoding === 'json-utf8') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(item.bytes);
      parent[last] = item.encoding === 'json-utf8' ? JSON.parse(text) : text;
    } else throw new Error('Unsupported source attachment encoding.');
  }
  delete result[KEY]; return result;
}
