# House WASM boundary

[Français](README_FR.md)

Bundled bindings for the [house engine](../houses/README.md), with no terrain or rendering dependency. The generated package is in `rust/pkg/houses/`. The engine README describes the bench, its modes, replays and exports.

Three exports return a JSON string with a `{ok:true,data}` or `{ok:false,error:{code,field,message}}` envelope:

- `catalogue_json()` supplies the catalogue and source inventory.
- `preflight_json(config_json)` validates settings, filters recipes and estimates budgets before geometry.
- `generate_houses_json(config_json)` performs that preflight and then generates a batch.

The urban workflow adds `architecture_profiles_json()`, `place_buildings_json(batch_json)` and `enrich_placement_json(building_json)`. They use the same result envelope, with placement schema `1` independent of standalone house schema `2`. Urban inputs are limited to 32 MiB; responses retain the 64 MiB limit. The retained case contains the resolved plan for exact enrichment or an explicit refusal.

Configuration and scene use `schema_version: "2"`; the source inventory has its own versioned format. An expected error uses an explicit category in the envelope. A WASM trap remains a separate fatal error. Input is limited to 32 KiB and the response to 64 MiB. Validation and geometry rules belong to the native engine, not the bindings.

`HouseConfig.workshop`, absent for the Atlas, identifies a free-workshop preset and its optional dimensions/materials/supports. The workshop uses the same calls and envelopes. `catalogue.workshop_presets` remains separate from its 32 cultural packs.

From `web/`:

```sh
npm run wasm:houses    # Development WASM package only
npm run dev:houses     # Compile, watch Rust and open Vite
npm run build:houses   # Release WASM and standalone HTML
npm run check:houses   # Native, WASM and contract checks
```

The development page is `/housebench.html`. The build is `rust/out/houses/housebench.html`, with embedded WASM and no network request required for offline generation. The UI sends a configuration to a Worker and receives a complete batch; tickets discard stale responses. A fatal Worker is recreated before retrying.

`rust/bridge/housesContract.ts` supplies manual types and scene validation. `rust/bridge/houseRender.ts` is a temporary SVG adapter. Ordinary `web/` development, typecheck and build commands do not compile Rust and do not require the ignored package.

Contract: [native model](../houses/src/model.rs) and [TypeScript validator](../../bridge/housesContract.ts).
