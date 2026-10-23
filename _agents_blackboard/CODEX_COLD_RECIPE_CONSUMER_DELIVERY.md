# Cold recipe / terrain export consumer delivery

The existing “Copier code” capture now transports complete cold native data. `portableRecipe` in `web/src/ui/recipeSharing.ts` detects retained cold references and fills `MapRecipe.decor` from the complete portable decor stream, bounded to **24 MiB** to reserve code framing. Existing `recipe.ts` remains unchanged: its decoded MU format cap is **32 MiB**, and the recipe file chooser remains **45 MiB**. Oversize errors explicitly direct users to `.decor` with direct disk recording; there is no partial export or local-reference fallback. The MU1 City Situation parameter code is unchanged.

`restoreRecipe` uses `readDecorFile(new Blob(bytes))`, covering both old gzip and cold containers. It validates the recipe/header artifact identity before native staging/publication, propagates dialog cancellation through the import commit signal, and saves only the rewritten local gzip metadata to history. It does not persist the portable NDJSON container as history gzip. A remaining cold draft also blocks the procedural-terrain shortcut, so a code cannot contain a stranded local cold reference.

`setExportDecor` in `web/src/ui/terrainSettlements.ts` now calls `downloadDecorFile` directly during button activation. `web/src/ui/terrainDecorExport.ts` preserves synchronous `capture` / `magnaDecor.export` for legacy snapshots and explicitly rejects cold snapshots with directions to the async API. New `captureAsync` / `magnaDecor.exportAsync` carry complete portable bytes, bounded at64MiB. `captureData` remains unchanged. Existing catalogue scripts rely on legacy gzip/header extraction; they stay on the compatible sync API. No script or codec cap was changed.

Shared additions: `web/src/ui/decorFileBytes.ts` collects a complete decor stream under an encoded-byte bound (hard ceiling64MiB; lower bounds allowed). `decorFile.ts` adds optional consumer header validation and `AbortSignal` handling before the atomic native commit. The dedicated file download retains its original64MiB Blob fallback and unrestricted total direct-disk stream with bounded individual header/native frames. These limits concern encoded payloads, not measured heap.

Validation, from `web`:

```powershell
npx vitest run tests/recipeSharingCold.test.ts tests/decorFile.test.ts tests/ui.recipe.test.ts tests/urban.snapshot.test.ts
```

**4 files /52 tests passed**. New tests cover actual standalone MU encode/decode/import/history transfer of all three exact C native chunks (six plans, three refusals), crop offset/cityKey preservation, artifact mismatch before staging, cancellation at an atomic commit gate, legacy byte compatibility, async cold automation hooks, bounded byte failure, an actually over-budget native frame (synthetic diagnostic padding; unchanged real C geometry/archives), and cold draft protection. Scoped diff check passed. Root centralizes final TypeScript verification. No native/Cargo/browser/server execution.
