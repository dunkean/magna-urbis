## Alpha 0.3.3

- Include the Python/CUDA service's `neural_sampling.py` dependency in both desktop packages. Staging and package validation now share the service-module inventory, with a regression check for adjacent imports.
- Clear inherited `PYTHONHOME` and `PYTHONPATH` when launching optional Python environments. AppImage launchers can otherwise redirect an existing venv to the bundle's incomplete Python library tree.

Pre-release validation: a corrected AppImage resource tree and an equivalent subprocess-environment reset successfully generated terrain through the packaged interface using an existing WSL Ubuntu 22.04 venv, PyTorch 2.11.0+cu128 and an NVIDIA GeForce RTX 5090. Cached model files were reused with Hugging Face offline mode enabled; exact project save/reopen and owned-service shutdown passed. Final CI package validation is recorded separately after the versioned artifacts are available.

## Alpha 0.3.2

Known optional-module issue: the published Python/CUDA service omits `neural_sampling.py`, and the AppImage launcher can override a configured venv's Python paths. Alpha 0.3.3 addresses these packaging and launch issues. The source and published package files for 0.3.2 remain unchanged.

- Edit architectural styles, packs and generation parameters independently for quarters, parcels and individual buildings. Reroll a selected scope or its descendants while retaining local style choices.
- Procedural roof and storey edits retain the existing footprint. Failed architectural changes keep the previous scene. Selected buildings have a red outline.
- Show fewer map names by default. The top toolbar's Advanced panel provides category toggles, a detail slider and individual name visibility. Selection titles use the current name locale without translating proper names.
- Browser neural generation asks before downloading models, verifies same-origin model chunks and reuses verified model and runtime caches. Native desktop and optional Python model downloads remain separate.
- Improve desktop download links, map relief controls and small-settlement generation.

Source validation: 683 Rust urban tests and 156 TypeScript integration tests passed. Packaged Windows 11 tests cover procedural generation, exact save/reopen, verified model download, real native inference on an NVIDIA GeForce RTX 4090, deterministic offline restart and owned-service shutdown. Ubuntu 22.04.5 under WSL2 passes the DEB and AppImage tests, including direct FUSE launch, procedural generation, exact save/reopen and shutdown. Native Rust/Vulkan GPU inference on Linux is not qualified: this WSL installation exposes only a software Vulkan adapter. This limitation does not describe the separate Python/CUDA runtime. All 14 public downloads match their SHA-256 digests and expected sizes. See the [release verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.2_VERIFICATION.md) for methods and limits. GitHub-hosted runners do not validate GPU inference or every Linux distribution.

Magna Urbis V2 is an experimental alpha for Windows x64 and Linux x64.

- Includes the procedural Rust engine and a native Rust GPU inference service. Users do not need Rust, Node.js, Python or CUDA for these engines.
- Native neural terrain uses the same coarse4 / NF4 B75 / distilled decoder profile as browser V2. On first use, the app downloads and verifies approximately 162 MB of model weights. Settings also provides an explicit download button. Verified files are reused after restarting the app, including offline.
- Native inference needs a compatible GPU and driver. A smaller download does not imply equally small GPU memory usage. Procedural CPU generation remains available.
- The experimental 99 MB native climatic base uses a different mixed 3/4-bit format and is not supported by this Rust loader. It is not offered as an installable desktop profile.
- Optional Python/CUDA terrain and illustration modules remain separate downloads.

**Windows:** use the setup EXE for installation, including offline WebView2 setup if required. Alternatively, extract the complete portable ZIP and run `magna-urbis-v2-desktop.exe`; keep its resources alongside it. The portable edition requires WebView2 already installed. Packages are unsigned and Windows may display a warning.

**Linux:** AppImage and DEB are built on Ubuntu 22.04 (glibc 2.35). Compatibility also depends on your distribution, graphical environment and GPU drivers. Make the AppImage executable before running it. GitHub-hosted build runners do not validate GPU inference; see the release verification record for hardware actually tested.

**macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.**

Application updates are announced in Settings and downloaded through the system browser. Close the app before installing an update. Back up projects before upgrading; alpha project formats and generated results may change.

SHA-256 checksums, the supported model profile and build commit metadata accompany the downloads. Model weights retain the MIT teacher attribution in `LICENSE-NEURAL-MODELS.txt`.
