/** Immutable array identity is the revision; wrappers and display preferences are not. */
export const DISPLAY_PRODUCT_VERSION = 3;
const revisions = new WeakMap<object, number>();
let nextRevision = 0;
export function productRevision(value: object | undefined | null): number {
  if (!value) return 0;
  let revision = revisions.get(value);
  if (revision === undefined) { revision = ++nextRevision; revisions.set(value, revision); }
  return revision;
}
export function productKey(...parts: (number | string)[]): string { return `${DISPLAY_PRODUCT_VERSION}:${parts.join(':')}`; }
export function measureDisplayProduct<T>(product: string, build: () => T): T {
  const start = performance.now();
  try { return build(); }
  finally { performance.measure(`displayprep:${product}:build`, { start }); }
}
