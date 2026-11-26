# Desktop 0.3.4 and web verification — 2026-11-16

Desktop source: `cc44f99fd7aa7aa9a0d69f8b7ccb508ffbdca4b2`, tag `desktop-v0.3.4`.
Release workflow: [Windows and Linux builds](https://github.com/dunkean/magna-urbis/actions/runs/43788552693).
Web source: `f3b3e6224f55ce70b3c3702bc038d2527b361ce9`, published to `gh-pages` as `57023d49614a930bb9e8648a9d31119fcad863f8`.
Subsequent source commits update qualification scripts and this record; they do not change the packaged application.

## Source and editing contract

- 688 Rust urban tests passed; 25 diagnostic tests were ignored.
- 208 targeted TypeScript tests passed, covering hierarchy, block identity, descendant resets, culture inheritance, compatible building choices, share-code reconstruction, rendering, scene controls, small-place scheduling and desktop integrations.
- TypeScript, production frontend build, version alignment, portable archive and public-filename/checksum regression checks passed.
- A browser test used the actual newly built native engine to edit and reroll a retained block, check its saved configuration, retain rendering settings, inspect localized populated controls and remove map selection outlines.
- Nine real native farmsteads completed as two background groups of eight and one, with one installed world per group. Cancellation, stale results and isolation of a failed batch are covered by scheduler tests.
- The 10,000-inhabitant automatic allocation retains its population while limiting historical and dispersed profiles to five farmsteads and ten hamlets. Explicit counts and the capacity needed by cultures without large settlements remain respected.

The user-facing hierarchy and propagation contract is documented in [Urban editing](../../URBAN_EDITING_FR.md).

## Published website

The production build passed the static subpath test: actual Rust/WASM CPU terrain generation, standalone workers, documentation and all referenced assets. This software-rendered gate uses the parchment style; material rendering was qualified separately on hardware.

The public site's `version.json` matches the web source above. A fresh Edge test profile on Windows 11, NVIDIA driver 591.86 and an explicitly selected NVIDIA GeForce RTX 5090 passed:

- rejection of neural CPU generation before downloading weights;
- verified same-origin model download and actual browser WebGPU terrain inference;
- complete generation while in 3D, including visible buildings;
- independent global and local naming choices;
- a selected house's roof edit with an unchanged footprint and physical terrain;
- project export/reopen with exact terrain and buildings;
- 3D, style and interface-language changes;
- cancellation during GPU inference, subsequent generation and model-cache reuse with model URLs blocked.

The complete live scenario reports no page errors. The first fresh download/inference completed in 43.5 seconds; a subsequent complete-map run took 11.7 seconds. These are observations from this machine, not performance guarantees. A separate public-page check imported the generated project, displayed the minimal renderer and verified that enabling contour lines changes its actual canvas output.

## Linux packages

The actual CI AppImage was launched directly through FUSE. The DEB was independently extracted and its packaged application launched. Neither package's resources or binaries were modified. Both used isolated application data and cache directories on Ubuntu 22.04.5 under WSL2, WebKitGTK and an Xvfb desktop.

Both passed native-window and embedded-interface startup, missing optional modules, procedural generation through the interface using parchment, exact project save/reopen, a native API result containing 4,096 finite heights, no model download at startup and normal close stopping the owned native service. Both report application version 0.3.4.

This qualifies the packaged applications, not DEB installation hooks or every Linux distribution. Native Rust GPU inference and optional Python/CUDA generation are not newly qualified on Linux by this run; the 0.3.3 report describes the previous Python/CUDA hardware qualification.

## Windows packages

The actual portable ZIP and independently extracted NSIS payload passed isolated-profile startup, embedded-interface boot, missing optional modules, invalid-input rejection, a native procedural API result containing 4,096 finite heights and normal window/service shutdown. The installer contains the 215,116,512-byte offline WebView2 installer. The installer wizard, registry changes and uninstallation were not exercised; WebView2 was already installed.

The portable application's procedural interface passed with the default WebView2 graphics configuration and in a separate Vulkan run. Project export/reopen retained exact terrain heights. A complete native regional/city generation and the 3D view passed with visible buildings and the shared scene controls. Qualification uses `?test=1` only to suppress automatic recipe restoration; it does not replace the generators or renderer.

Native neural qualification used a fresh application model directory on Windows 11, an NVIDIA GeForce RTX 5090 and NVIDIA driver 591.86, with the Vulkan backend. The application's download action fetched and verified the three published model files. Requests to its owned native inference service then produced 1,600 finite FP32 heights over 40 km, with native resolution 1,334 at 30 m. After normal shutdown, external HTTP/HTTPS was blocked, the same verified weights were reused and a second inference produced the identical buffer. Both owned services stopped after each close.

The two generation times were 2,578.9 ms and 1,938.6 ms, excluding initialization. Both output buffers had SHA-256:

`fd46e53111f5186f01f20eca845e9d713a2d7ae29ad4f87746231adf41b7674c`

These are results from this hardware and runtime, not a guarantee of bit-identical inference on other GPUs.

## Public integrity

The workflow completed successfully on both operating systems and published the [0.3.4 prerelease](https://github.com/dunkean/magna-urbis/releases/tag/desktop-v0.3.4). All 14 public downloads returned HTTP 200 with the expected size. Their GitHub SHA-256 digests match locally hashed CI artifacts; both platform metadata files identify version 0.3.4 and the desktop source commit above. Published older tags and binaries were left unchanged.

| Public package | SHA-256 |
| --- | --- |
| `Magna.Urbis.V2_0.3.4_amd64.AppImage` | `b766b96a0ca2a1c4ed9624ade662047e4a0e2edfff3f32d8d0378dbc208241e8` |
| `Magna.Urbis.V2_0.3.4_amd64.deb` | `04d3005e5635f8e8eeacc0a11bf208cf9521207a17ec1159003e21f9674360d3` |
| `Magna.Urbis.V2_0.3.4_x64-portable.zip` | `89b7052df380bf2f2a16c2b03233fe5ad8da0de16d702c20f369dcd4d121cb6e` |
| `Magna.Urbis.V2_0.3.4_x64-setup.exe` | `5f96f8ec541f859712e686af3519cffd098c6524f58a4e573b0fb4f84585fcdc` |

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.
