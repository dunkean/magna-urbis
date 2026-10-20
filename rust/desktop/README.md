# Application Windows / Linux

This optional Tauri 2 shell reuses the bench interface and its WebView GPU
renderer. It starts an optimized native Rust engine on a free loopback port,
passes that address to the **local** profile, and stops its engine on exit.
It is independent of ordinary web/WASM builds.

From `web/`:

```sh
npm run dev:local   # Local Rust engine + browser, Windows or Linux; Ctrl+C stops both
npm run app:dev     # Same interface in a desktop window
npm run app:build   # Build the app and native installer for this operating system
```

Use `-- --no-neural` to skip the optional Python/CUDA service, `-- --no-open`
to leave the browser closed, or `-- --no-build` to reuse the current release
engine. `npm run build:local` builds that engine explicitly. The existing
`npm run dev:benches` remains the browser **web** profile with WASM/WebGPU.

The shared defaults live in [`config/execution.json`](../../config/execution.json).
The **Exécution** selector switches profiles in the shell or standalone workshops.
Web and local keep separate workshop contexts. For a CPU-only web default, set
`web.compute` to `wasm` and `web.generation` to `cpu`; the default uses available
browser GPU stages. Local defaults to native procedural generation and GPU
sampling/display, with the existing WebGPU generation choices still selectable.
The preferred neural backend is labelled in the source menu; existing links keep
their explicit model/backend choice.
`MAGNA_LOCAL_SERVER` overrides the browser launcher's local address, and
`MAGNA_LOCAL_BIN` overrides the native engine executable. Existing services
are reused and are never stopped by the launcher. Its own services run in the
foreground; use Ctrl+C in that terminal to stop them.

## Prerequisites

Node/npm, the pinned Rust toolchain and existing terrain/houses WASM packages
are required (`npm install`, `npm run wasm:terrain`, `npm run wasm:houses`).
Desktop additionally requires the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
and the CLI, downloaded automatically by npm on its first desktop launch.

Windows uses the MSVC build tools and WebView2. Debian/Ubuntu needs the GTK3,
WebKitGTK 4.1 and appindicator development libraries listed by Tauri. Build
installers on their target OS; Linux packaging cannot be validated on Windows.
The resulting bundles are in the Cargo target directory under `release/bundle/`;
the exact path is printed by Tauri. Existing Cargo `target-dir` settings and
`CARGO_TARGET_DIR` are respected. The local engine is
copied into the app resources; Node and Cargo are not needed to run the bundle.

Python/CUDA and model weights remain optional, external dependencies rather
than part of the installer. The local/dev launcher starts Neural Earth's venv
when available; select another checkout with `MAGNA_NEURAL_EARTH` or interpreter
with `MAGNA_NEURAL_PYTHON`. For an installed app, start `npm run neural:python`
separately when using that source. Native procedural terrain works without it.

The desktop window retains the current web renderer. GPU features depend on
the system WebView and graphics driver; CPU paths remain available. The app
does not imply a native Vulkan/DirectX renderer or a guaranteed speedup for
every workload.
