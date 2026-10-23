/** Runtime-only reference to authoritative native urban geometry. Never store
 * it in a decor, situation code or portable scene archive. */
export interface UrbanSourceHandle {
  version: 1;
  session: string;
  terrainRevision: string;
  layoutsRevision: string;
  partitionsRevision: string;
}

export function validateUrbanSource(source: UrbanSourceHandle): void {
  if (source.version !== 1 || [source.session, source.terrainRevision, source.layoutsRevision, source.partitionsRevision]
    .some(value => typeof value !== 'string' || !value.length || value.length > 128)) {
    throw new Error('Invalid retained urban source.');
  }
}
