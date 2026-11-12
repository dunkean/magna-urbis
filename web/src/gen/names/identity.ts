/** Compact deterministic ids; retained feature metadata survives moves and project serialization. */
export function nameHash(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
export function featureNameKey(feature: object, kind: string, fallback: string): string {
  const record = feature as { nameKey?: string; nativeId?: string; id?: string | number };
  return record.nameKey ??= `${kind}:${record.nativeId ?? record.id ?? nameHash(fallback)}`;
}
