# Portable cold decor delivery

Production TypeScript only; no native/Cargo/browser/server execution. No geometry, recipe, seed or native-plan regeneration changes.

## Files and API

- `web/src/ui/decorFile.ts`: `exportDecorFile(decor,{backend?})` streams a portable file; `readDecorFile(blob,{backend?})` imports it; `downloadDecorFile(decorOrPromise,filename,{backend?,picker?,saveBlob?})` enters the browser picker before its first await. Backend defaults to the existing IndexedDB chunk database. Tests inject independent backends.
- `web/src/ui/decor.ts`: legacy gzip codecs accept explicit `{localReferences:true}` for same-origin history/header only. Default encode rejects cold references rather than emitting an incomplete portable file. `decodeDecorBounded` caps decompressed terrain and validates complete raster length.
- `web/src/ui/benchHistory.ts`: history stays local gzip metadata; downloads always route through portable export before awaiting history lookup. File imports use streaming `readDecorFile` and then persist rewritten local metadata.
- `web/src/ui/terrainDecorLibrary.ts`: catalogue/file imports use the same format detector/importer. Existing catalogue grouping behavior retained.
- `web/tests/decorFile.test.ts`, `web/tests/benchHistoryPortable.test.ts`: exact C chunk transfer, publication boundaries and history routing.

Root owns the City Bench download binding; no edits to City Bench, terrainUrban, snapshot, panel or architecture-only `urbanColdDownloads.ts` in this delivery.

## Format and guarantees

Legacy terrain/legacy-native decors remain gzip MUDC1. A cold decor starts with one NDJSON line `{format:"magna-cold-decor-1",decor:"<base64 legacy gzip>"}`, followed by existing `exportUrbanBuildingChunks` frames unchanged. Every chunk is exported; no archive inflation or complete native parent scene is constructed. The original exact stored chunk JSON, signed-zero metadata and payload hashes survive import unchanged.

The cold path calls only `Blob.slice(0,2).arrayBuffer()` for format detection; the full file is streamed. The header is capped at 64 MiB encoded, decompressed terrain/metadata at 128 MiB, native frames use the existing chunk import bounds. These are encoded/decompressed payload budgets, not measured JS heap limits. File System Access streams to disk; other browsers receive a complete Blob only up to 64 MiB, otherwise an explicit error. Writer failures abort the disk write.

Existing stage import authenticates chunks, checks footer and consumes true EOF before commit. A backend commit wrapper verifies every header cold reference against final manifest fingerprint, source fingerprint, schema/generator and building/refusal/open-space counts **before** the atomic active-scene switch. Corruption, truncation, trailing frames, header mismatch, invalid offset/cityKey or mixed embedded legacy scene leaves the previous active native scene intact and discards the uncommitted stage. After success, both urban/urbanDraft references receive the newly committed local sceneId; fingerprint, cityKey and offset remain intact.

The two defined snapshot slots may refer to the same exact native scene. Incompatible separate native scenes in one decor are explicitly rejected; no scene is silently omitted. Legacy gzip containing only cold references is rejected on file import as incomplete; internal history reads intentionally use the explicit local codec path.

## Validation

Run from `web`:

```powershell
npx vitest run tests/decorFile.test.ts tests/benchHistoryPortable.test.ts tests/urbanBuildingChunkStore.test.ts tests/urbanBuildingChunkIndexedDb.test.ts tests/urban.snapshot.test.ts tests/urbanGeography.test.ts
```

The fixture is `tests/fixtures/urban-building-chunks-c.json`: three exact retained chunks, six native plans and three refusals, imported into an independent store with a new sceneId. Tests also pause the stream after its footer and verify the previous active generation remains selected until actual EOF; forbid whole cold-file `arrayBuffer`; exercise both snapshot references, source/count/hash mismatch, native corruption, truncation, incomplete lines, trailing data, metadata rejection, legacy terrain compatibility, picker timing, writer abort, Blob fallback and internal-history routing. Root centralizes final TypeScript checking. A local check found only the generator-return argument issue, subsequently fixed.

Final run: **6 test files, 53 tests passed**. Scoped `git diff --check` passed.

No browser UI, real disk picker or large-city heap measurement is claimed.
