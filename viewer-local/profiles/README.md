# Explicit renderer profiles

With the prepared local artifacts installed, launch the current Surface configuration in one command:

```text
node web/scripts/surface_viewer.mjs --render-profile surface-v2 --world <packet.surfacebin> --godot <Godot4.7.2> --top
```

`GODOT` remains supported. Omitting `--top` keeps the viewer's existing presentation/camera behavior. For a map style, for example:

```text
node web/scripts/surface_viewer.mjs --render-profile surface-v2 --world <packet.surfacebin> --presentation cartographic --style blueprint --top
```

`surface-v2.json` explicitly selects the local PBR and grass manifests, **corrected** tree manifest under `web/out/vegetation-tree-v14`, native Rust height batch executable, aerial presentation, source-map water with uniform tint and declared 1.25 px symbols, and threaded native logging. The tree descriptor must have digest `74edf966059a17fd44df22d24f4ee055f780d84196ee9c54703fa3b9e46ecbe9` and the validated source-sRGB correction; its actual GLB hash is checked before engine startup.

Prepare/copy these local resources explicitly first:

- `web/out/surface-assets/resolved.json` and its four maps per material;
- `web/out/vegetation-assets/resolved.json`, prepared meshes and four runtime maps;
- `web/out/vegetation-tree-v14/resolved.json`, corrected GLB, mask, lookup and five packed color/normal view pairs;
- `viewer-local/native-height/target/release/magna-surface-height-batch.exe` on Windows (no `.exe` on other platforms), built from the isolated Cargo project;
- the pinned Terrain3D installation described in `viewer-local/README.md`.

Profiles never search asset caches, download resources or silently use the old tree product. A missing/empty required file, wrong corrected tree descriptor, or incompatible option fails before rendering. The explicit profile also disables the launcher's automatic Terrain3D bootstrap; run that setup separately. Godot's local resource import may still run.

Caller flags override individual defaults. Relative paths remain relative to the **caller's working directory**, as in the existing launcher. Unused default paths do not have to exist when an explicit replacement is supplied. Duplicate profile-controlled flags are rejected as ambiguous. Cartographic presentation remains allowed; assets are still loaded even when a style uses map glyphs.

Effective water mode, tint, width and logging/presentation enums are validated together. Physical `source-levels` requires `--water-vector-tint source-classes --water-symbol-width-px 0`; overriding only the mode is an error, not an automatic adjustment. Invocation without `--render-profile` retains its former defaults and bootstrap behavior.

## Shared Node API

`web/scripts/surface_render_profile.mjs` exports:

```javascript
const profile = loadSurfaceRenderProfile('surface-v2', { root, platform });
// profile.defaults: absolute default paths plus presentation/water/log options.
const effective = validateSurfaceRenderProfile(profile, {
  defaults: { ...profile.defaults, ...explicitCallerOptions }, cwd,
});
// effective.metadata: profileSha256, effectiveSha256, artifact SHA256 values,
// resolved effective defaults, corrected tree digest, runtime file count, overrides.
const expanded = applySurfaceRenderProfile(argv, { root, platform, cwd });
// {args, profile}; no selected profile => copied args and profile:null, no file probes.
```

Loading reads only the explicitly named JSON definition. Validate **after** applying caller overrides and before starting engine/source work. The launcher emits one compact `surface-render-profile` metadata event for the chosen effective configuration. Keep the JSON and module in runtime snapshots; executable and artifact hashes remain separate provenance. This configures rendering only: it does not regenerate physical context, upgrade old packets or qualify new content/hardware automatically.

CPU-only tests: `node --test web/scripts/surface_render_profile.test.mjs`.
