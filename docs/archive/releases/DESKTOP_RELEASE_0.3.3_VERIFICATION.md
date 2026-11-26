# Desktop 0.3.3 verification — 2026-11-15

Release: [desktop-v0.3.3](https://github.com/dunkean/magna-urbis/releases/tag/desktop-v0.3.3). Source commit: `9d0a0bd67b2a7fcc4807e52febb005cd7a32f700`.

The [release workflow](https://github.com/dunkean/magna-urbis/actions/runs/43703329734) completed successfully on both operating systems and published the prerelease. Qualification used its actual versioned packages. Their resources and binaries were not modified. All 14 public downloads returned HTTP 200 with the expected size, and their GitHub SHA-256 digests matched locally hashed CI artifacts. Unchanged model assets were compared with the previously downloaded, identical release artifacts. Both platform metadata files identify the source commit above and version 0.3.3. Published 0.3.2 files and tags remain unchanged.

## Linux: existing WSL Python/CUDA environment

Host: Ubuntu 22.04.5 LTS under WSL2, kernel `6.18.54.1-microsoft-standard-WSL2`, WebKitGTK 2.50.4, Xvfb test display. The existing interpreter was `/home/delete/self/neural-earth/.venv/bin/python`, with PyTorch 2.11.0+cu128 and CUDA 12.8. The selected GPU was the NVIDIA GeForce RTX 5090 (`CUDA_VISIBLE_DEVICES=1`). The existing Neural Earth source was commit `5e577c452672ae8a3646ea9d81f0b9063cba3af3`.

Each test started with isolated application data and cache directories. The app's configuration command selected the existing interpreter and source directory, then its optional-module action started the packaged Python service. No Python wrapper was used, and no packages were installed into or changed in the user's venv.

| Scenario | Direct FUSE AppImage | Installed DEB |
| --- | --- | --- |
| Packaged window and embedded interface boot | Pass | Pass |
| Configure and start the existing Python interpreter through the app | Pass | Pass |
| Real Python/CUDA terrain generation through the interface | Pass | Pass |
| Cached model reuse with Hugging Face offline mode enabled | Pass | Pass |
| Complete project export/reopen preserves exact terrain heights | Pass | Pass |
| Native procedural API returns 4,096 finite heights | Pass | Pass |
| No automatic native-model download on startup | Pass | Pass |
| Normal window close stops the owned Python and Rust services | Pass | Pass |

Both Python/CUDA runs generated a 40 km terrain (`wsl-cuda-package`), with native resolution 1,334 at 30 m and requested output spacing 1,000 m. Their service logs identify the RTX 5090 and a successful generation request. They used the verified existing Python coarse4/decoder64 checkpoints and cached original teacher weights, with `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`. These Python checkpoints are separate from the native Rust NF4 weights. The saved terrain height arrays were identical between AppImage and DEB; their compact JSON serialization had SHA-256:

`73c1d73b590cb5c7ff4d2b0782f062c4ed1d5154ef329b2bd9885796a5b37cbc`

The DEB was upgraded from 0.3.2 to 0.3.3 with `dpkg` and remains installed in the WSL distribution. Test configurations are separate from normal user profiles.

This qualifies the final packages' existing-venv CUDA path. Creating a new managed venv and downloading all original Python checkpoints from an empty cache were not exercised. Native Rust/Vulkan GPU inference is a separate path: this WSL installation exposes only the software Vulkan adapter llvmpipe, so it remains unqualified on Linux. WSL results do not certify every Linux distribution.

## Windows

Host: Windows 11 Pro build 26200, NVIDIA GeForce RTX 4090, Vulkan backend, NVIDIA driver 591.86.

The portable ZIP and independently extracted NSIS application payload both passed fresh-profile startup, embedded interface, native procedural API (4,096 finite heights), missing optional modules, invalid-configuration rejection and normal window/service shutdown. The NSIS contains the 215,116,512-byte offline WebView2 installer. Installation, registry changes and uninstallation were not exercised; WebView2 was already present.

The portable app also passed procedural generation through the interface and exact project save/reopen. With external HTTP/HTTPS blocked, it verified and reused the 0.3.2 app's cached native model profile (`coarse4-nf4-b75-t2-decoder`). Real inference through the app-owned native neural executable passed, followed by normal shutdown, offline restart and repeat inference. Both runs produced 1,600 finite FP32 heights over 40 km, with native resolution 1,334 at 30 m. Generation took 2,388.4 ms and 2,790.4 ms, excluding startup. Both buffers matched the previous version's result:

`a9eceb0b90f0e750df3ca0b5ee63f0c11a4865f97fbd404703d2ccfd892da34e`

The fresh native-model download itself was qualified in [0.3.2](DESKTOP_RELEASE_0.3.2_VERIFICATION.md); this release specifically verifies cache reuse across app versions and offline restarts. Both owned native services stopped after each close.

## Package integrity

| Public package | SHA-256 |
| --- | --- |
| `Magna.Urbis.V2_0.3.3_amd64.AppImage` | `fed6f574d9f44275b56a2d1bdca1e96df256afe2def993c54972d5cf2762d642` |
| `Magna.Urbis.V2_0.3.3_amd64.deb` | `ea46a9950d8212cbc97bdf62d62d31b7afc6e478dd6a3192f186e2b9b8f5772e` |
| `Magna.Urbis.V2_0.3.3_x64-portable.zip` | `fbd1a6f9837d6cd26b3251969b56fe66c297b98108f139973f741abfda79b908` |
| `Magna.Urbis.V2_0.3.3_x64-setup.exe` | `e45fba3fc69926dd9a97418084833f0451c95a562aaefb17a984674a790f53a4` |

CI passed version alignment, Python tests, TypeScript checks and integration tests, native service tests, resource validation and published checksum checks. Before tagging, the shared Python-resource inventory regression test, portable archive test, version check and WSL sampling tests also passed. CI success alone does not establish hardware inference support; the hardware results above come from the packaged apps.

The web deployment remains at `5217ceec69a003bda3ec034ec1a159f565bd7560`, already qualified in the 0.3.2 verification record. Version 0.3.3 changes desktop Python resource staging and subprocess environment handling.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.
