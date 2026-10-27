# V13 fresh native campaign: technical PASS

The campaign on frozen runtime `6ef8d3c6f2b88f884a2ad199c7b305dfaf3649c1` passes nominal 20-second navigation, seven views from 40 km to 10 m and two five-image probes at 10 km and 160 m. Driver and supervisor exit with code 0. Clean before/after snapshots preserve 624 runtime hashes. Total durations: 538.502 s for the driver and 555.058 s for the supervisor.

The [JSON evidence](native-e2e-v13.json) references files under `ROOT/web/out/surface/native-e2e-40km-v13/`. The original report is 3,000,695 bytes, SHA256 `b6614643b985cbd88c4e3816b47476b0ae3b6b1d5b9b53385b4295e6dca793c3`. Archiving checks sources, images and logs, then replays timing, displayed-world, four logger-snapshot and 17 tree-asset capture validators. No new rendering is launched. No survivor is found among the six recorded launch PIDs at the CIM check; the parent also reports zero campaign-owned survivors.

## Navigation and actual resolution

Nominal motion lasts 20 s; actual duration is 20.015 s. The maximum input gap is 0.376 s and the terminal gap 0.017 s. Ten responses are accepted and four geometric preparations applied, but two distinct physical worlds are displayed within the nominal window:

| Appearance after start | World | Delivered grid | Native support | Learned decoder |
| --- | --- | --- | --- | --- |
| 12.808 s | `9a1ace8ca5313922bf5c9adce65df630` | 128² at 66.277 m spacing | 30 m | no |
| 19.602 s | `00ba16bbda7a8015fbec477bbdcdb5d7` | 128² at 1.37075 m spacing | 0.9375 m | yes |

The final render at 0.46875 m native, a 140² grid delivered at 0.46567 m spacing, arrives after motion during the 12.85 s drain. It does not count as a third application within 20 s. Warmup lasts 50.811 s. Canonical context is built only once, with one environment version. Retention of visuals after failure was requested but not used: navigation passes normally.

Frame times after `ready` cover warmup, motion and drain: maximum 699.89 ms, p50 16.665 ms, p95 16.882 ms, p99 17.154 ms. This is neither an FPS statistic for the 20 seconds alone nor proof of 60 FPS. Internal Worker markers measure wall time; CDP/Node timestamps remain observations without automatic attribution to CPU or a cause of pauses.

Fresh generation uses Python/CUDA, `coarse4/original/original`, numeric seed `2814899424497554030`. The raw 1024², 4 MiB response has SHA256 `3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159`. Magna's canonical context has 78.125 m spacing; recorded refinement preserves the parent as B-spline controls and descends to 0.46875 m native support. A screen pixel at 10 m/2048 is 4.8828 mm: this is neither millimeter source resolution nor newly observed terrain.

## Sources, layers and assets

`strict-source-restoration.json` confirms restoration of two packets and six archives per packet without clearing, replacing or repairing slots. Typed water layers and presentation archives are preserved. Packets use `surface-1.6.0`, with available and validated `groundResponse`. Ground uses regional physical parameters interpolated before the recipe; it does not describe newly observed fine-scale soils. Ground, low cover and trees remain three explicit, separable layers.

All 17 images pass the gates. All retain zero water triangles without levels and zero omitted vector area, with complete coverage and budgets respected. At 40 km, 51 boundary level queries are resolved within representation tolerance, at most 0.122 mm; source levels remain unchanged. Hydrology remains Magna's. Terrain projection, uniform tint and a 1.25 px shoreline symbol are declared and do not change physical contours.

Grass and tree assets are actually applied, and manifests are identical before and after. The tour submits:

| Width | High geometry | Impostors | Alpha-positive tree centers in frustum |
| --- | ---: | ---: | ---: |
| 40 km | 0 | 0 | 0 — phase 0 |
| 10 km | 0 | 0 | 0 — phase 0 |
| 2,560 m | 0 | 10,000 | 3,951 |
| 640 m | 0 | 2,680 | 983 |
| 160 m | 0 | 402 | 64 |
| 40 m | 2 | 24 | 4 |
| 10 m | 0 | 26 | 0 |

At 10 m, zero alpha-positive centers remains a known centered-LOD limitation; no future correction is qualified here. The tour's visible-geometry gate applies at 160 m. In the 160 m “all” probe, alpha counts are: trees 64, separate trunks 0, grass 288, shrubs 17, debris 61, rocks 31. Impostors already represent the tree; V12's 64 procedural trunks must not be reused as a V13 measurement. These counts concern buffers, centers and ALPHA, not GPU occlusion or measured crown area.

The logger uses threaded v2 mode in all four phases: zero rejections, zero outstanding, identical accepted and written counts. Snapshots exclude their own later metrics line. No script or shader errors appear; Terrain3D deprecation warnings remain preserved. Parent-reported preliminary checks: 246 Surface tests in 45 files, TypeScript and 445-module build PASS, 28 Node tests followed by eight targeted tests including four new ones (union 32), Godot parse PASS. They are not rerun for this archive.

## Product scope and limitations

The [CITY V13 views](native-city419-v13.json), evidence commit `0ea1841`, are separate: a retained city with 419 authentic realizations, 81 refusals and a 15.625 m parent, legacy ground 1.5.3 without groundResponse. They show compatibility of native volumes and blueprint style; they are neither the fresh city nor validation of GR.

This technical PASS does not constitute artistic acceptance, engine adoption or validation of universal asset rendering. V9–V11 failures, V12 artistic limitations and negative evidence from old sources remain preserved. The V13 artistic review remains separate from these technical gates.
