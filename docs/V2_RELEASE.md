# Preparing the desktop V2 release

Scope confirmed on 2 November 2026: open-source hobby project, Windows x64 and Linux x64, with the Rust engine included and AI optional. macOS is postponed. Distribution preparation proceeds during the V2 work without freezing the APIs, project formats or engine interfaces. This document distinguishes the prepared features from the tests and releases still required.

## Installation and budget

The base installation targets procedural generation with Rust, without Python, Node, Cargo or models to install on the user's machine. The Tauri workflow prepares an NSIS installer for Windows and `.deb` and AppImage packages for Linux. Only announce the operating systems actually tested: installation on a clean machine remains to be validated.

For Windows x64, a portable ZIP accompanies the NSIS installer: extract the entire archive before launching `magna-urbis-v2-desktop.exe`, and keep the `resources` folder alongside it. Running it requires WebView2; it avoids a system installation but keeps data, settings and caches in the Windows profile (`%LOCALAPPDATA%\MagnaUrbis`), as the installed version does. Python, CUDA, AI models and illustration dependencies remain optional and separate.

The **Optional modules for computer** panel lets you configure an existing Python or request a separate assisted installation for terrain and illustration, then verify and start the services. `uv` 0.13.6 is bundled; its archive is downloaded at build time and verified by SHA-256. Explicit installations may download several GB; the terrain one also fetches the pinned Neural Earth sources if no path is configured. The weights are a separate download and are not downloaded at startup. A compatible service that is already running can be reused without a configured interpreter; the panel displays the service state and the environment state separately. A targeted test covers Python selection after procedural mode.

The NVIDIA/CUDA driver is a prerequisite for the local profile. A real run of the `decoder16` model was verified on the Windows GPU with PyTorch 2.11; under WSL, an existing PyTorch 2.7 environment succeeded in a CUDA tensor computation. These tests validate neither the complete installation of a new environment nor a full neural terrain generation. See the [manual procedure](../python_runtime/README.md).

No GPU server to fund. Computations stay on the user's machine; any optional external API uses its own key. The public Hugging Face Hub offers free storage on a best-effort basis, subject to limits and usage policy: the current distilled exports represent about 100 MB, a good starting point without a paid plan. Do not keep all training checkpoints there. The main cost to control is maintenance time, particularly for GPU installations.

A Windows commercial signature and automatic updates can wait: document the warnings for an unsigned package and first offer manual download of new releases. The desktop version now checks GitHub releases at startup and displays a link to the new installer in the header and settings. The download opens in the browser; closing the application and then running the installer replaces the installation, without compatibility checks or migration. The panel also lets you re-run the check. `desktop-v<version>` pre-releases are included. See the [how updates work](../rust/desktop-v2/README.md#mises-à-jour-de-lapplication). A single qualified AI platform (NVIDIA/CUDA) is sufficient at the start.

Sources: [Hugging Face storage](https://huggingface.co/docs/hub/storage-limits),
[Python managed by uv](https://docs.astral.sh/uv/guides/install-python/),
[Tauri distribution](https://v2.tauri.app/distribute/).

## Original terrain and distilled weights

Reuse the existing files [`catalog.json`](../rust/models/neural-earth/catalog.json) and [`model-inventory.json`](../rust/models/neural-earth/model-inventory.json), without introducing a new layer of contracts. Keep the Python, Native Rust and browser exports distinct: they are not automatically interchangeable.

- [x] Prepare the download of the **original** weights from [`xandergos/terrain-diffusion-30m`](https://huggingface.co/xandergos/terrain-diffusion-30m). Use the revision fixed in the inventory and also download the configurations needed for loading.
  Do not republish a copy of the originals in the distillations repository.
- [ ] Display the required files, their size and their state; reuse the Hugging Face cache when possible. Allow a folder of already downloaded weights. Plan for resuming after interruption and for an integrity check before use.
- [x] Publish the distilled inference exports, configurations, inventory and licences in [dunkean/neural-earth-distilled](https://huggingface.co/dunkean/neural-earth-distilled), tag `v0.1.0`, commit `b1782a3f80f5001de5ac701c1ff37128f128b9d7` (MIT). The eight weights were downloaded anonymously and verified by SHA-256.
- [x] Prepare a first model card with the origins, licences and limitations.
- [ ] Complete the model card with loading examples and the hardware actually tested.
- [ ] Distinguish the continuous Terrain Diffusion models from the finite-window residual model: the latter does not replace the original base in the continuous pipeline. Only offer for download as usable the combinations supported by the selected engine.
- [x] Carry the repository and commit of the first selection over into the catalogue. No write token in the distributed application.
- [ ] Test a real generation with the downloaded weights before announcing the available GPU profile.

The [models guide](models-release/README.md) describes verification and the explicit download and publication commands. The panel offers the published repository and its immutable commit, which remain editable. The browser profile already has its own download/cache; link it to the appropriate public exports at release time, without removing the weights tracked in Git prematurely.
## Illustration of 3D views

Reuse the `illustration/` service and the colour/depth/contour capture from
V2. The initial goal is an image synthesised from a 3D view; generated geometry or
perfectly consistent views would require different work.

- [ ] Hook the illustration action into V2 and start the configured Python service on demand. Check generation, error reporting and export.
- [x] Provide the manual Python procedure and prepare the assisted installation;
  validation on a clean machine remains to be done.
- [ ] ComfyUI remains an alternative for a user who already owns it.
  Its connector and an example workflow would need to be added if this path is retained;
  do not install or maintain ComfyUI and its extensions automatically.
  ComfyUI does not directly replace the relief runtime.

## Minimum to complete before publishing

- [x] Prepare the neural package resources: catalogues, configurations and
  Python scripts; the external Neural Earth sources are fetched on demand
  or configured by path. Verify that the installed package works.
- [ ] Verify the launch of the installed application, the Rust engine actually
  used, the shutdown of services and an understandable error if a module is missing.
- [x] Prepare simple automation on tag.
- [ ] Produce and verify the packages of a release candidate from a clean checkout
  on each target OS.
- [ ] Test on a machine without development tools: installation, generation,
  save/reopen, AI module absent and empty model cache. Then test an available AI
  profile and its offline reuse after a complete download.
- [ ] Publish packages, SHA-256 checksums, prerequisites and known limitations. A
  documented manual installation of the AI is acceptable for this first release; its
  assisted installer must not block the delivery of V2 with Rust.

## Package workflow

The [Desktop V2 release](../.github/workflows/desktop-v2-release.yml) workflow
builds on Windows 2022 and Ubuntu 22.04 x64. Linux uses glibc 2.35 as its
build base; compatibility also depends on the libraries of the distribution. A
manual run keeps the CI artifacts without publishing. A
`desktop-v<version>` tag matching the Tauri version triggers, after both
builds, a GitHub pre-release with installers, SHA-256 checksums and
metadata. These packages are unsigned and have no automatic updates; Windows
may display a warning. Downloading later versions is manual.
The workflow is prepared: its mere presence implies no publication and no validation on a clean machine. On the Windows development machine, the
binary was launched with an isolated profile: the Rust service produced 4,096 finite heights
and stopped on closing. This check validates neither a clean-machine
installation nor a complete neural generation. Under WSL2 Ubuntu 22.04,
the `.deb` extracted from the latest build and the AppImage extracted from an
earlier build opened the full interface under WSLg;
the Rust service computed 4,096 finite heights and stopped when the
window was closed normally. This is not a global installation test nor a test on a
clean Linux machine. Both packages were built and their SHA-256 checksums generated.

During this WSL test, Tauri's internal download of AppRun timed out. The tools were
retrieved separately from the official URLs indicated by Tauri
2.11.4, placed in its cache, and then the AppImage build succeeded. This workaround does not
prove that the CI download will work everywhere.
The current packages use the `app-icon-v2.png` icon; the latest version
of the AppImage was built and verified by checksum, without a new graphical test.

The conditioning WASM module alone was compiled on Windows without downloading the browser weights. Its `conditioning_json` export produced 20,480 finite values for a grid of size 64. This check does not validate a complete neural generation nor a CI build on a clean machine.
