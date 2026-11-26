# Magna Urbis V2 · web and installable app

**Desktop alpha 0.3 and newer:** the [maintained desktop release guide](../../docs/DESKTOP_RELEASE.md)
documents the included native neural service, verified model downloads and repeatable GitHub Actions releases.
The Python/CUDA instructions below describe separate optional modules.

This Tauri application is independent of the V1 launcher in `rust/desktop`.
It opens the new V2 interface and starts its native Rust engine on a free
loopback port. Its application identifier and its distribution are distinct.

The [desktop release preparation](../../docs/V2_RELEASE.md) specifies the
Windows/Linux scope, the optional AI installations and the distribution of the
original and distilled weights on Hugging Face. This preparation remains open to
change during the V2 project and does not freeze the engine interfaces.

## Using the Windows version

Two x64 formats are provided: the NSIS `.exe` installer, or a portable
`.zip` archive. For the archive, extract **all of its contents** into a folder,
then launch `magna-urbis-v2-desktop.exe` from that folder. Keep the files
and the `resources` folder together; do not launch the program directly
from the ZIP preview. The ZIP avoids installation, but settings, environments and
caches remain in the Windows user folders (`%LOCALAPPDATA%\MagnaUrbis`), shared
with the installed version; they are not automatically kept on a USB key.
Windows and the WebView2 runtime are required. The packages are unsigned and
Windows may display a warning.

The procedural engine is included; Python, CUDA, the neural weights and the
illustration dependencies are optional and are not included. They can be
configured or installed separately from the settings. Check the SHA-256
checksums provided with each distribution.

From `web/`:

```sh
npm ci
npm run prepare:v2                  # Terrain + houses Rust/WASM release
node scripts/v2.mjs dev             # Full web, http://127.0.0.1:5174/v2.html
node scripts/v2.mjs build           # Static distribution in web/dist-v2
node scripts/v2.mjs local           # Web V2 + native Rust + optional Python
npm run app:v2:dev                  # Desktop application in development
npm run app:v2:build                # Application and installer for this OS
```

The npm names are defined in `web/package.json`. `--no-build` reuses the existing
Rust release binary; `--no-neural` ignores Python for the browser launcher.
Services that are already open are reused without being stopped by the launcher.

## Application updates

At startup, the desktop version checks the public GitHub releases of
`dunkean/magna-urbis`, including pre-releases tagged `desktop-vX.Y.Z`.
If a higher version has an installer for the current platform,
a **Download installer** link appears in the header and in
**Settings & engines → Application updates**. This panel also shows the
installed version and lets you rerun the check. When offline or
if GitHub is unavailable, the application remains usable.

The link opens the download in the system browser. Close Magna Urbis,
then launch the new installer: it replaces the existing installation.
Windows uses the NSIS `.exe`; Linux offers the `.deb` or, failing that, the AppImage.
A downloaded AppImage must manually replace the old one. The portable ZIP
remains available in the releases; the update link offers the installer.
No compatibility check of projects, engines or modules, nor any data migration,
is performed. User data remains in its existing folder. The web edition does not
perform this check.

To distribute an update, align the versions in `Cargo.toml` and
`tauri.conf.json`, then publish the `desktop-v<version>` tag via the existing
desktop workflow. The published release with its installers is sufficient; no
update manifest or updater signature is needed.

Targeted checks from `web/`:

```sh
npx vitest run tests/v2DesktopUpdates.test.ts tests/v2Platform.test.ts
node scripts/v2_updates_check.mjs
```

The second check uses Edge headless and simulated releases, without downloading
or launching any installer. To verify the native commands, from `rust/`:
`cargo test --manifest-path desktop-v2/Cargo.toml updates::tests`.

## Preparing a fresh checkout

`rust/pkg` is deliberately ignored by Git. Install Node/npm, Rust/rustup
and `wasm-pack` (`cargo install wasm-pack --locked`), then run `npm ci` and
`npm run prepare:v2` from `web/`. The toolchain and the WASM target are defined
in `rust/rust-toolchain.toml`; rustup installs them on the first build.
The preparation compiles **only** the terrain and the houses in release mode,
without rebuilding or moving the V1 interface or benches. `build:v2` explains
the preparation command if a WASM package is missing.

The Python terrain also uses a small WASM module for CPU conditioning.
The desktop commands compile it automatically if `../infinite_map` contains
`native/neural-earth` and `tools/wasm`. It can also be prepared explicitly
with `node scripts/neural_wasm.mjs --conditioning-only` from `web/`: no browser
weights are needed. The release workflow fetches these sources
at revision `20fd8543b50da1d6ae839c01e0230cb8ee59ee8a`.

The browser neural terrain remains optional. To embed it:

```sh
npm run prepare:v2 -- --neural
npm run build:v2
```

The existing neural preparer expects the `../infinite_map` checkout next to
this repository, with `native/neural-earth`, `terrain-diffusion` and the initialised submodules,
along with its dependencies and access to the Terrain Diffusion weights.
It builds the runtime and copies the models into `rust/pkg/neural-web`.
These external models are not needed for the procedural application.
The Python neural code uses a separate environment, described below; the
two preparations do not replace each other.
## Web Distribution

Publish **the contents of `web/dist-v2`** at the root of https://magna-urbis.org/. It keeps the relative links, workers, WASM binaries and the scientific documentation under `scientific/`. `index.html` and `v2.html` open the same application. No local API is contacted in the Web profile.

`web/dist-v2` is the static artifact ready to host. V1 is published separately at https://v1.magna-urbis.org/; see the [publication guide](../../docs/WEB_PUBLICATION.md). Building does not publish anything. The check `node scripts/v2_static_check.mjs` serves exactly this artifact under `/magna-urbis/v2/` and verifies the workers, a real generation, and the illustrated documentation resources.

The CPU remains available without a GPU. WebGPU is only offered after a device has been successfully created; the engine reports the backend it actually uses. A forced GPU choice fails explicitly if the device is no longer usable. The existing neural engines use **WebGPU** or **Python/CUDA**: they do not currently provide CPU inference. The procedural engine provides the CPU path.

## Optional Python Modules

The package includes the Rust service, the Python scripts and `uv` 0.13.6; it does not contain a Python interpreter, a CUDA driver or external weights. The build downloads the `uv` archive for the platform and verifies its SHA-256. The procedural engine works without installing Python. In the installed application, open **Settings & engines → Optional modules for desktop** to configure an existing interpreter, separately install the terrain or illustration dependencies, check their environment and start the service. An empty Python path selects the managed environment; the Neural Earth path is optional.

Assisted installation downloads Python and dependencies that may amount to several GB; for terrain, it also fetches Neural Earth source archives at fixed revisions if no path is provided. It does not download weights. The model download buttons are separate: the originals use the revision indicated in the inventory; the fields for the distilled models propose the published Hugging Face repository and its commit, both editable. No weights are downloaded at startup. After a service starts, the reload button reruns detection in the interface. Logs and data/cache folders are shown in the panel. The availability of CUDA and of the models depends on the machine.

The [manual Python procedure](../../python_runtime/README.md) also describes the `uv` commands, paths and environment variables. Model operations and their possible publication are detailed in the [Hugging Face guide](../../docs/models-release/README.md). Optional environments remain independent, and their absence does not block the procedural engine. A compatible service that is already running can be reused even if no local interpreter is configured. The panel distinguishes its state from that of the environment; detection is refreshed during startup. A targeted test also covers the switch from procedural terrain to Python.

The system prerequisites and package limitations remain those of [Tauri 2](https://v2.tauri.app/start/prerequisites/). Build each installer on its target OS. Outputs are in the Cargo directory indicated by Tauri, under `release/bundle/`. Optional browser models are copied only if they exist in `rust/pkg/neural-web`, without copying local neural caches. The [desktop V2 workflow](../../.github/workflows/desktop-v2-release.yml) prepares unsigned Windows x64 and Linux x64 packages; its manual launch does not publish a release. Under WSL2 Ubuntu 22.04, the `.deb` extracted from the latest build and the AppImage extracted from an earlier build displayed the interface under WSLg and closed their Rust service normally; a Rust procedural computation produced 4,096 finite heights. The AppImage build required preloading the tools from Tauri's official URLs after a timeout of its internal download. Tests on clean machines remain to be done; see the details and GPU limitations in the [release preparation](../../docs/V2_RELEASE.md).
The package icon is generated from [`app-icon-v2.png`](assets/app-icon-v2.png).

On Windows, the portable ZIP archive is an alternative to the installer: extract the whole folder, then run `magna-urbis-v2-desktop.exe`, keeping `resources` next to it. The application requires no installation or administrator rights to run; the Microsoft Edge WebView2 runtime is required. Settings, optional Python environments and caches remain in the user's data folder, shared with the installed edition; they are not portable with the extracted folder.
