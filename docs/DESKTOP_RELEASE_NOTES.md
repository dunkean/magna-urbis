## Alpha 0.3.2

- Edit architectural styles, packs and generation parameters independently for quarters, parcels and individual buildings. Reroll a selected scope or its descendants while retaining local style choices.
- Procedural roof and storey edits retain the existing footprint. Failed architectural changes keep the previous scene. Selected buildings have a red outline.
- Show fewer map names by default. The top toolbar's Advanced panel provides category toggles, a detail slider and individual name visibility. Selection titles use the current name locale without translating proper names.
- Browser neural generation asks before downloading models, verifies same-origin model chunks and reuses verified model and runtime caches. Native desktop and optional Python model downloads remain separate.
- Improve desktop download links, map relief controls and small-settlement generation.

Source validation: 683 Rust urban tests passed; TypeScript integration tests and the native V2 browser editing scenario cover local roof changes, retained footprints and atomic refusals. CI qualifies packaging and procedural startup. This version has no new packaged-app GPU inference certification; GitHub-hosted runners do not validate GPU inference or every Linux distribution.

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
