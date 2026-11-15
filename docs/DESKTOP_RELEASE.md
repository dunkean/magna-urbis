# Desktop alpha releases

The supported release targets are Windows x64 (NSIS installer and portable ZIP) and Linux x64 (DEB and AppImage). The app includes both native Rust executables. Users install neither Rust nor Python for procedural or native neural terrain generation.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Release each version with GitHub Actions

From a clean checkout, choose the next version and update its release notes:

```sh
node web/scripts/v2_version.mjs 0.3.1
# Edit docs/DESKTOP_RELEASE_NOTES.md for this version.
node web/scripts/v2_version.mjs --check
git add rust/desktop-v2/Cargo.toml rust/desktop-v2/Cargo.lock rust/desktop-v2/tauri.conf.json docs/DESKTOP_RELEASE_NOTES.md
git commit -m "chore(release): desktop 0.3.1"
git push origin HEAD
git tag desktop-v0.3.1
git push origin desktop-v0.3.1
```

The `Desktop V2 release` workflow validates that the tag matches Tauri, Cargo and Cargo.lock, builds on each target OS, tests the native commands and web integrations, recreates the model files from immutable upstream inputs, and checks the packaged resources. It publishes a GitHub prerelease only after both platforms succeed and all artifact checksums pass. A draft is used while uploading, so incomplete uploads are not advertised. The app's existing update checker includes these prereleases.

To build a candidate without publishing, select **Actions → Desktop V2 release → Run workflow**, select the candidate branch, and run it. Download its three artifacts: Windows, Linux and neural models. Manual runs do not publish a release or tag. The committed workflow must be on the default branch before it appears in the Actions menu.

Keep release tags immutable. If a build fails before publication, fix the branch, bump the version and push a new tag. Re-running a failed job is appropriate for a transient infrastructure error. If draft publication was interrupted after creating the draft, delete only that incomplete draft before rerunning the release job; do not overwrite a published release.

No signing secrets are needed for the unsigned alpha. The workflow uses GitHub's repository-scoped token; only the publication job has `contents: write`. The checked-in Rust toolchain, Cargo and npm lockfiles, Tauri CLI version, upstream source commit, uv checksum and model hashes pin the release inputs. CI records the source commit in each platform's metadata.

## Neural models

`rust/models/neural-earth/desktop-profile.json` specifies the exact supported runtime source commit and the three model files. `web/scripts/v2_neural_release.mjs` downloads the pinned coarse4 and decoder64 checkpoints from the existing Hugging Face distribution, prepares them in Rust, assembles the original packed B75 release bytes, and refuses any output that differs from the supported SHA-256 hashes. Model preparation needs neither a GPU nor Python.

CI attaches `coarse.safetensors`, `base.nf4` and `decoder.safetensors` to the same release as the installers, alongside the model profile, checksums and teacher license. The app downloads them over HTTPS from its own version's release. Each file is streamed to a temporary file, checked for exact size and SHA-256, then committed to the persistent user data directory. An interrupted or corrupt file is downloaded again; completed verified files are reused. Existing models are reverified before inference starts. Sharing the profile directory across app versions avoids downloading unchanged weights again.

The app does not download models at startup. Users can select **Settings → Native neural terrain → Download terrain models**, or start a native neural terrain generation. Progress and errors appear in Settings and generation progress. The service starts on a dynamically allocated loopback port and is stopped with the application. Missing models do not prevent procedural generation.

The 99 MB native climatic base (`native3-base99m-v1`) uses `native-mp-gaussian3-4-v1`, which the current packed-base Rust loader does not understand. Do not advertise it as an installable profile until loading and actual terrain generation pass with its required coarse and decoder networks. Browser caches, Python checkpoints and native model directories are distinct.

## Verification

GitHub-hosted runners have no qualified inference GPU. CI verifies compilation, input validation, transfer integrity, packaging and the Windows app's procedural startup/shutdown. A successful CI run alone does not certify GPU inference or every Linux distribution. Record the actual hardware and package checks in the release notes when qualifying a release.

Useful local checks:

```sh
cd web
npm run typecheck
npx vitest run tests/v2/desktopNeural.test.ts tests/neuralModels.test.ts tests/v2DesktopUpdates.test.ts tests/v2Platform.test.ts
node scripts/v2_portable_test.mjs
node scripts/v2_version.mjs --check
```

After building on Windows, `node scripts/v2_desktop_check.mjs --binary=<absolute-path-to-exe>` opens only that packaged executable with isolated user data, verifies the native procedural backend and optional-module absence, and checks that the owned service stops after closing the window. Run it against the extracted portable package as well when qualifying that package.

For a fresh native neural test, use a separate `MAGNA_RUNTIME_DATA` directory. Download the three model files from the app, generate terrain, close the app, disable network access, reopen with the same directory and generate again. A new generation must have finite heights and valid physical resolution/extent metadata. Test save/reopen and exports using this same candidate app. Preserve user projects and environments during upgrade and uninstallation tests.

## Local packaging

Follow `rust/desktop-v2/README.md` for the general build prerequisites. The sibling `../infinite_map` checkout must contain `native/neural-earth` and `tools/wasm` at the commit in `desktop-profile.json`. CI retrieves this commit automatically. Run `npm ci`, `npm run prepare:v2` and `npm run app:v2:build` from `web/` on the target OS. Models are separate release assets and are intentionally excluded from the desktop frontend bundle.

The Windows installer embeds the offline WebView2 installer. The portable ZIP requires an existing WebView2 runtime and stores data in the user's profile. Linux packages retain an OS/library compatibility baseline; AppImage is not a guarantee of compatibility with every Linux system.
