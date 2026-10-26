# Canopy r4: physical filtering and production instance normals

This is a renderer-only replay of retained V7 source. The exact binary is identified in `manifest.json`; canonical terrain, climate, soil, layer arrays, hydrology, urban data and accepted candidate IDs are unchanged. It is not a fresh neural/live-generation proof. Ground, low cover and canopy remain independent layers.

The production MultiMesh path was the main illumination mismatch. With the same nonuniform transform, sphere, material and lighting, the old shader differed from MeshInstance by up to 34 RGB byte levels. The explicit inverse-transpose of the complete instance MODEL_MATRIX makes the two rendered images identical. See `brdf-before.json` and `brdf-after.json`. The independent crown-normal atlas then differs from either actual sphere by 0.587 byte on average, maximum 6, over the inner 85 percent radius. This excludes silhouette tessellation and is a flat-receiver illumination test, not forest photorealism.

The [Godot 4.7.2 Forward+ source](https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/servers/rendering/renderer_rd/shaders/forward_clustered/scene_forward_clustered.glsl) computes the node normal transform before adding the MultiMesh instance transform. This explains why the shader explicitly corrects the complete transform.

Optical detail uses the physical, area-weighted source-family crown spectrum at 1.25–3 pixels across a crown. Exact atlas coverage/normals and approximate canopy use the same filter. Geometry requires 3–8 pixels; the exact selected-count transfer and instance shader share that function. The approximate layout retains one jittered site per 16 m cell and depends only on the canonical seed and double-precision world phase. It never creates candidate IDs. `meso-gpu.json` covers 90 seed/cover/footprint cases: maximum coverage error 0.345 percentage point, rebase/source-ID/LOD changes at 20 Mm and 1e9 m give zero byte error. `page-gpu.json` uses the real 480 m page: 1004 exact trees, 447 selected, seven footprints; combined C/V error is at most 0.096 percentage point.

For the mapper, approximate optical shadows use the entire canopy C, both inside and outside the inventory page. Only tree crowns and trunks have engine shadow casting disabled. Terrain and building shadow settings are unchanged. The declared transmission remains [.25,.34,.50]; the reference crown centre is the area-weighted authored-family value, 9.804 m. The proxy is not a geometric forest-shadow claim, particularly on slopes or receivers at other heights. `shadow-gpu.json` verifies direction and main-camera LOD behaviour separately, including an invisible caster control. It does not validate shadow energy or penumbra.

`manifest.json` identifies three final production TOP screenshots (10 km, 2560 m, 640 m) and a separate 2560 m OBLIQUE screenshot, at 2048 square pixels. The two comparison thumbnails preserve full source frames and label their cameras. Earlier experimental `normals-fixed`/`shared-filter` directories used an unrecognised `--view top` argument and are oblique; they are not the final top-camera evidence. Final commands use `--top` explicitly. Stylized sphere crowns and approximate distant morphology remain limitations.

Reproduce the final top set with the pinned Godot executable and:

```powershell
& $godot --path viewer-local --rendering-method forward_plus --gpu-index 0 --script res://diagnostics/forest_page_probe.gd -- --world $packet --assets $assets --x 20000 --z 20000 --width 10000 --resolution 2048x2048 --top --page-widths 10000,2560,640 --page-dir res://captures/f1-r4-final-top
```

The standalone probes are `canopy_brdf_gpu_probe.gd`, `canopy_meso_gpu_probe.gd`, `canopy_page_gpu_probe.gd` and `canopy_shadow_gpu_probe.gd`. Their reports state their narrower scopes. The final integrated live campaign and visual review remain separate qualification steps.
