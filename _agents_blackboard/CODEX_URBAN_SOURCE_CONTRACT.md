# Retained urban source — agreed wire contract

Agreed with Opus and integrated for `buildingSites` reads. Paging is specified below and remains pending the A3 handoff.

`UrbanSourceHandle = { version: 1, session: string, terrainRevision: string, layoutsRevision: string, partitionsRevision: string }`.

Revision strings are opaque native tokens, distinct from worker request IDs and unique across session eviction/recreation or server restart. A handle identifies one authoritative full-precision terrain/layout/partition snapshot. The `parcels` (and later programme/reconciliation) response may include `urbanSource`. This is runtime state only: never serialize it into MU1/decor/share URLs. The UI keeps the handle only while the exact layouts/partitions identities represented by that response remain applied. A selected subset is passed as explicit layout keys, not inferred from display geometry.

Read requests use `source: handle`; the server looks up the existing session without creating it, validates every revision and rejects stale/missing sources explicitly. Reading another worker's source never uploads or replaces its raster. Legacy explicit geometry calls remain supported, including WASM. Failure does not silently rebuild a different city.

Next paging contract: `kind: buildingSitesBegin`, `source`, `keys?: string[]`, `seed`, `architectureCulture?` returns `{sourceId: string, total: number}`. `kind: buildingSitesPage`, `source`, `sourceId`, `offset`, `limit <= 64`, `maxBytes <= 24 MiB` returns `{placementRequests, offset, next, total}`. The page may be smaller due to the remaining byte budget. An empty nonterminal page at a reduced budget tells the adapter to publish its pending prefix and retry the same offset at the full budget; an empty page at the full budget fails explicitly. `sourceId` binds selection, seed, culture and source revisions. Native preparation builds indices once; it must not build all site payloads and then slice, nor rescan the whole city per page.

The bridge consumes these pages in a single placement context, preserving cross-page neighbours, input order, per-site seeds, ACK backpressure and cancellation. The native source is invalidated when terrain, layouts or partitions/programme are replaced. Expired handles require explicit controlled rehydration/regeneration. A future selected-ID lookup will support editing without keeping every original site in the UI.

Ownership: Codex native sessions / bridge / scene; building_sites pagination after A3 handoff. Opus urban generation, lightweight display projections and their UI integration. Display rounding never changes authoritative constraints.

Validation: focused native route test compares 23 nonempty sites from fractional-coordinate blocks and a real prepared programme, with strict JSON equality against the explicit path. It also checks stale revisions, existing-session-only lookup and key selection. Bridge and worker tests verify no raster or geometry upload, with explicit errors instead of a silent fallback. Live City Bench 03 on :8811 uses a 515-byte source request, no architecture raster upload, and completes 8 plans / 4 refusals / 1 open. This proves the retained read integration; it does not certify pagination, million-city memory or visual quality.
