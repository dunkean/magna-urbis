# V15: fresh native campaign, technical PASS

The campaign on frozen runtime `c53cd7e6de1b8efa8b7ea8d5d747505b87e6f237` finishes with `complete` status, supervisor exit code 0: nominal 20 s navigation, seven TOP views from 40 km to 10 m, then two five-image probes at 10 km and 160 m. Durations: **425.603 s for the driver**, **439.214 s for the supervisor**. This result concerns measured technical contracts; it does not pronounce artistic acceptance, oblique quality or a production guarantee.

[Compact evidence](native-e2e-v15.json) contains V15-specific figures, hashes and references under `ROOT/web/out/surface/native-e2e-40km-v15/`. The raw report is 3,289,391 bytes, SHA256 `e7514e650de47f11958ce0db15cbea0373fb2d1520b1b64db3818eacf3051d11`. Clean before/after snapshots are identical for **945 runtime files**. Explicit profile `surface-v2` retains its **82 files** and effective hash `fcdb21fd9bd34d26023b4c3da8fe5adde74da1bcf10877ee010a0e10aacb66ce`. Archiving rereads and verifies recorded files; it runs no test, new render, benchmark, profile or neural call.

## Movement and actual resolution

The nominal window remains strictly 20 s, ticks 57,883 to 77,883. Actual end is tick 77,896, or 20.013 s. Largest input interval is 0.507 s, terminal interval 0.050 s. Ten responses are accepted. **Two display events correspond to two distinct fresh worlds**, each inside the nominal window, with source actually contributing at the observed point:

| Appearance after start | Serial / world | Delivered grid | Native support | Decoder |
| --- | --- | --- | --- | --- |
| 15.059 s | 62 / `0ad40452b4103adc210defca2145c686` | 128², spacing 66.277133 m | 30 m | no |
| 18.995 s | 276 / `ee30a8bbe0d44c55f339addb5eba5177` | 129², spacing 0.534224 m | 0.46875 m | yes |

The first world is a new view response reconstructed from the parent, not fresh fine neural detail. The second supplies learned refinement within 20 s. Final render requested with `preview=false`, requested resolution 512, is delivered at **140² with 0.465669 m spacing**, native support 0.46875 m: the source limit takes precedence over the requested count. It is applied at tick 84,301, after the window; it does not count as a third world during movement. Warmup: 35.337 s; drain: 6.461 s. Canonical context is built once with one environmental version. Visual retention after failure was requested but not used.

`navigationFrameWallMs` covers every frame after `ready`, including warmup and drain: max 708.222 ms, p50 16.666 ms, p95 16.916 ms, p99 17.224 ms. It does not measure only the 20 s and does not prove 60 FPS. Worker/logger markers remain wall durations, without automatic attribution to CPU, GPU, network or system pauses.

## Source, archives and height budget

Source is freshly generated on Python/CUDA bf16, `coarse4/original/original`, with a new token and registration. The raw 1024² heightfield over 40 km retains SHA256 `3c7c2f32e37844842f058208e21522543bcec69125348e115390f83d5b814159`. Magna canonical context is 512² at 78.125 m spacing; registered parents remain actual B-spline controls. `tilted-strata-v1` is an explicitly requested geological scenario, not observed geology. Fresh source contains **0 buildings**, without crop or frame translation.

Strict restoration is PASS for both packets and their **six archives each**, without clearing, repairing or replacing a slot:

| Packet | Bytes | SHA256 |
| --- | ---: | --- |
| `fresh-source.surfacebin` | 91,626,097 | `70c05ed7e3177d154e44090d29b8a80c3b16ac8c40bbca0a12e74e66ca9b4ed7` |
| `live-refinement.surfacebin` | 76,589,841 | `f9bdb75671c21ceb402a817cc244a076487f7b88c267773b785f4de942055874` |

The ROOT executable actually applied is `c77ca0d0b2a4409832e068d0862c760a995cc846e76b838493d2c9a2843ad104`. The new `height-source-chain-2` contract retains at most seven layers, 7,340,032 samples, a 512 MiB input and the same ordered interpolation. At 40 m, **seven layers and 1,618,660 samples** actually pass: `used=true`, 8.3754 ms measured native processing, 504.590 ms total. Estimated native buffers are 55,596,232 bytes in this view, with bounded allocation and allowance; this is neither process RSS nor VRAM. No parent is removed, resampled or replaced to meet the budget. **V14 remains FAILED** under the old cap; its report is not requalified.

## Images, layers and presentation

Seven PNGs and ten isolation images are archived with their SHA256. The tour submits the following geometry:

| Width | High-geometry trees | Impostors | Alpha-positive tree centres |
| --- | ---: | ---: | ---: |
| 40 km | 0 | 0 | 0, phase 0 |
| 10 km | 0 | 0 | 0, phase 0 |
| 2,560 m | 0 | 10,000 | 3,951 |
| 640 m | 0 | 2,680 | 983 |
| 160 m | 0 | 402 | 64 |
| 40 m | 6 | 20 | 4 |
| 10 m | 1 | 25 | 0 |

A tree whose support intersects the image can be submitted with its centre outside the frustum; zero centres at 10 m therefore proves neither absence nor occlusion. These numbers describe buffers/ALPHA and do not claim to measure actual GPU cover. The 10 m/2048 screen pixel is 4.8828 mm; the source is not observed at millimetre scale. The corrected tree digest is `74edf966059a17fd44df22d24f4ee055f780d84196ee9c54703fa3b9e46ecbe9`. Experimental tree assets and grasses are actually enabled.

At 160 m, `all` contains 402 submitted trees, including 64 alpha-positive centres, plus 288 grasses, 17 shrubs, 61 debris items and 31 alpha-positive rocks. Hiding low cover drops visible grass/shrubs/debris to zero without hiding rocks. Hiding trees drops their visibility to zero and disables residual canopy and optical shadow. Allocations and physical footprints of context, terrain, ground, inventory and buffers remain identical across the four toggles of each view. Pages at the two widths are not assumed identical. The fifth image is mean unlit ground; it is not a new physical simulation.

`groundResponse` is available and validated: regional parameters are interpolated before recipe, without claiming newly observed fine soils. Ground, low cover and trees remain three separate layers. All 17 images retain complete vector-water coverage, zero omitted area, zero triangles without level and no budget limitation. The 51 boundary requests of the 40 km view remain within representation tolerance, at most 0.122 mm. Bed/water-level conflicts, up to 58.165 m in the bounded diagnostic, are retained and declared; they are not corrected to obtain zero. `source-map` mode, uniform tint and 1.25 px bank symbol are explicit: this symbol claims no physical width and changes neither contours nor levels.

All four native processes use the prepared PBR cache: 15 hits, zero misses, zero writes, loading in 2.379–2.864 s. The threaded logger records 62/62, 45/45, 12/12 and 12/12 accepted/written messages, zero rejections and zero pending at snapshot. The snapshot excludes its own later line. TOP projection export reports actual camera geometry; no oblique result is attributed to this campaign.

## Concurrency and cleanup

An OWN CPU diagnostic ran during source startup: one 0.73 s attempt around 08:54:11 UTC, then an 8.665 s retained-control test between 08:54:26.249 and 08:54:34.693 UTC. It is declared in [HEIGHT_SOURCE_CHAIN_BUDGET.md](HEIGHT_SOURCE_CHAIN_BUDGET.md). Tick/Unix correlation of an adjacent native event approximately places movement start at **08:55:37.754 UTC**, 63.061 s after that calculation ended. This is not a synchronised CPU trace or a claim of a globally idle machine. No other benchmark/test is launched for this archiving.

At 09:01:55 UTC, ROOT control finds no survivors among the seven recorded PIDs and no exact command belonging to V15. Vite and the neural service are deliberately excluded from this check; no external process is killed. CITY419 V14 views remain separate mapper-compatibility evidence: retained source, 15.625 m parent and unknown LOD, not a fresh V15 city. Artistic decision and product qualification remain for the separate review.

[Original French version](NATIVE_V15_FR.md).
