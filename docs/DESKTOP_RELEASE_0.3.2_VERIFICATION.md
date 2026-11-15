# Desktop 0.3.2 verification — 2026-11-15

Release: [desktop-v0.3.2](https://github.com/dunkean/magna-urbis/releases/tag/desktop-v0.3.2). Source commit: `daf35ba18e2ab4831f039393707f4c2bd1e7fba5`.

The [release workflow](https://github.com/dunkean/magna-urbis/actions/runs/43697300435) completed successfully on Windows and Linux. Tests below used its actual package files. All 14 published files were downloaded from the matching CI artifacts, hashed locally and compared with GitHub's public asset SHA-256 digests. Every public download link returned HTTP 200 and its expected size. Platform metadata identifies version 0.3.2 and the source commit above. There is one normalized portable ZIP filename.

## Windows

Host: Windows 11 Pro, build 26200; NVIDIA GeForce RTX 4090, Vulkan backend, NVIDIA driver 591.86.

| Package or scenario | Result |
| --- | --- |
| Extracted portable ZIP, new application data and WebView2 profile | Pass |
| Extracted NSIS application payload, new profile | Pass |
| Current splash image, embedded interface, native procedural service | Pass |
| Terrain API: 4,096 finite heights; procedural map through the interface | Pass |
| Terrain and illustration modules absent from the test profile | Pass |
| Original-model download control present; invalid module configuration rejected | Pass |
| Complete project export and reopen: exact terrain height data | Pass |
| Models absent before explicit download; no startup weight download | Pass |
| Public release models downloaded and verified by the packaged app's native command | Pass |
| Real inference through the app-owned packaged native neural service | Pass |
| Restart with the same cache, external HTTP/HTTPS blocked, repeat inference | Pass |
| Closing the native window stops its owned procedural and neural services | Pass |

The neural test used `coarse4-nf4-b75-t2-decoder`, a 40 km extent and 1,000 m output spacing. Both runs produced 1,600 finite FP32 heights with native resolution 1,334 at 30 m. Generation took 2,371.4 ms and 2,617.8 ms, excluding startup and download. Both output buffers had SHA-256:

`a9eceb0b90f0e750df3ca0b5ee63f0c11a4865f97fbd404703d2ccfd892da34e`

The NSIS archive contains the 215,116,512-byte offline WebView2 installer. Its application payload was extracted and launched independently; the NSIS installation, registry changes and uninstallation were not exercised. WebView2 was already installed on this host.

## Linux under WSL

Host: Ubuntu 22.04.5 LTS, WSL2 kernel `6.18.54.1-microsoft-standard-WSL2`, WebKitGTK 2.50.4. Tests used isolated data/cache directories and an Xvfb desktop.

| Package or scenario | Result |
| --- | --- |
| DEB installed with dpkg as package `magna-urbis-v2` version 0.3.2 | Pass |
| AppImage extracted and launched through its bundled AppRun | Pass |
| AppImage launched directly using FUSE | Pass |
| Native window, embedded interface and native procedural backend | Pass in all three launches |
| Map generated through the interface; terrain API returns 4,096 finite heights | Pass |
| Complete project export and reopen: exact terrain heights | Pass |
| Identical saved terrain height data across DEB and both AppImage launch methods | Pass |
| Optional modules absent; no startup model download | Pass |
| Normal window-close protocol and owned native-service shutdown | Pass |

The DEB remains installed in this WSL distribution. Test profiles are separate from normal user data. Tests closed their own applications and services.

Vulkan enumeration exposed only `llvmpipe (LLVM 15.0.7, 256 bits)`, a CPU adapter. These results qualify procedural use on this WSL installation; Linux native GPU inference and other distributions remain unqualified.

## Web

The production artifact passed `test:v2:static`, including procedural WASM generation, worker/resource loading and scientific documentation assets. GitHub Pages completed deployment, and the public `version.json` identifies web source `5217ceec69a003bda3ec034ec1a159f565bd7560` (the desktop source plus a publication-path fix). The public neural manifest, all six chunk sizes and both runtime file hashes were checked.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.
