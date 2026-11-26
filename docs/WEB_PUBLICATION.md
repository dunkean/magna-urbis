# Web Publishing

The sources for both versions remain in `dunkean/magna-urbis`.

| Version | Address | Publishing repository | Branch |
| --- | --- | --- | --- |
| V2 | https://magna-urbis.org/ | `dunkean/magna-urbis` | `gh-pages` |
| V1 | https://v1.magna-urbis.org/ | `dunkean/magna-urbis-v1` | `gh-pages` |
| Experimental | https://magna-urbis.org/next/ | `dunkean/magna-urbis` | `gh-pages`, folder `next/` |

The experimental version is the V2 application built from the committed `HEAD`
of the checkout where the command is run, whatever its branch:
`node scripts/deploy_site.mjs next`. It only replaces the `next/` folder, and a
V2 publication keeps it. It shares the `publish-v2` worktree, so its Rust target
and WASM packages are shared too. Same origin as V2: the neural model cache and
the browser's local storage are shared between the two.

`www.magna-urbis.org` redirects to the main domain. The domains are configured
in Settings → Pages for each repository, with HTTPS enforced.
The DNS records remain at Namecheap.

From `web/`, after committing the changes to publish:

```sh
node scripts/deploy_site.mjs v2
node scripts/deploy_site.mjs v1
```

The Bash launchers `scripts/deploy_pages.sh` and `scripts/deploy_v1.sh` are
also available. Each command builds `HEAD` in a persistent worktree
(`../_worktrees/publish-v2`, `publish-v1`), reset to exactly the published commit
each time, then publishes the entire output folder. Uncommitted changes in the
main checkout are preserved and are not used for the build.

The worktree keeps `node_modules`, `rust/target` and the WASM packages between
publications. `npm ci` is only rerun if `package-lock.json` has changed;
`prepare:v2` is only rerun if `rust/`, `web/scripts/` or the lockfile have
changed (compared using the Git object IDs of the commit), and cargo then
recompiles incrementally. A publication that only touches TypeScript therefore
takes a few minutes. `node scripts/deploy_site.mjs v2 --fresh` deletes the
worktree and rebuilds everything, for an occasional full verification. The
desktop installer is still published separately, by tag, via GitHub Actions
(`DESKTOP_RELEASE.md`).

A page opened before a publication still loads on demand the files of its own
build. The hashed files in `assets/` that are no longer part of the build
therefore remain published for 3 days after their removal
(`ASSET_RETENTION_DAYS`); `assets-retained.json`, on `gh-pages`, records the
removal date of each one.

The current interfaces require Rust, the WASM target and `wasm-pack`:
`prepare:v2` compiles the procedural engines and the houses before the build.
It also always compiles the multithreaded package `rust/pkg/wasm-threads`
(shared memory, rayon pool; `rust-src` component of the pinned toolchain,
`-Z build-std`). The site publishes both engines: the browser loads the
multithreaded one when the page is cross-origin isolated (`coi-serviceworker.js`
on GitHub Pages), otherwise the single-threaded package. The deployment fails if
the multithreaded package is missing from `dist-v2/assets`. `--no-threads`
(desktop CI) omits it.
For V2, the browser check `test:v2:static` must pass before publication;
Microsoft Edge is used by default, or the Playwright channel given by
`MAGNA_BROWSER_CHANNEL`.
The Python/CUDA services and their models remain optional local components,
separate from static hosting.
The V2 publication also includes the JS/WASM neural runtime and the manifest
`neural/models/manifest.json`. Before publishing, prepare the browser profile in
the main checkout with `npm run prepare:v2 -- --neural` (the complete
`../infinite_map` checkout is only needed for this preparation).
The deployment takes `rust/pkg/neural-web` from the main checkout into the
temporary worktree: it does not look for `../infinite_map` from that worktree.
It refuses to publish if the SHA-256 of the WASM differs from `runtimeSha256`, or
if the size or SHA-256 of a weight differs from the manifest. The generated files
must therefore be prepared from the pinned neural sources before publishing the
committed snapshot. No neural Rust build is run at this step.

The weights are hosted **on the same origin**, in chunks of at most 40,000,000
bytes (`neural/models/base.nf4.part0`, and so on, also for coarse and decoder).
The published manifest keeps the hash of the complete file and adds a `chunks`
list with the name, size and SHA-256 of each chunk. No 150 MB `base.nf4` file is
added to `gh-pages`. The JS also receives `runtimeJsSha256`.
The licenses of the prepared weights and of the teacher are included under
`neural/`. The raw weight files in the main checkout remain unchanged.

Choice verified on November 15, 2026:
`curl -sI -H "Origin: https://magna-urbis.org" -L https://github.com/dunkean/magna-urbis/releases/download/desktop-v0.3.1/base.nf4`
returns `302 Found`, then `200 OK` (`Content-Length: 149638301`), without
`Access-Control-Allow-Origin`, including on the final URL
`release-assets.githubusercontent.com`. These assets are therefore not suitable
for a browser `fetch` from the site; the chunks avoid this CORS dependency and
stay within GitHub's size limits.

The download is only triggered by a neural generation or by an explicit download
button in the settings, never when the page loads. Without a usable WebGPU, no
weights are downloaded. First use displays a remembered warning with
Continue / Cancel and a link to the desktop application (about 163 MB, a
powerful GPU recommended). The existing progress card displays MB, percentage
and cancellation. Each chunk, then the reassembled file, is verified before being
saved to the browser cache `magna-urbis-neural-models-v1`, separate from the
native and Python files.
The verified runtime uses `magna-urbis-neural-runtime-v1`. A persistent storage
request is made; the browser may refuse it, or the user may clear the data.
Valid weights are reused offline, without re-downloading on a new visit; the
saved manifest and the runtime can be reused when the server is unreachable.
This does not make the whole application available offline. A new hash downloads
the new files; a corrupted cache is repaired. Cancellation only keeps the
complete models already verified. Development mode always accepts the complete
files under `./neural/` without chunking.

Weight recognition relies on their SHA-256, their size and their stage
(coarse/base/decoder), regardless of the hosting path and file name. An update of
the application or the runtime therefore does not re-download unchanged weights.
Files already kept are recognised directly, without a second copy. If only the
saved catalogue is missing and weights are present, the selection retrieves the
small manifest before concluding that a download is needed; it downloads no
weights. The identified runtime is likewise reused across paths of the same site.
Storage remains specific to the browser profile and the origin (protocol,
domain, port): another browser, domain or port does not share this cache.
Sharing between browsers would require a local service or an explicitly chosen
folder; the site alone cannot read the models of the native application.
Choosing **Neural** checks whether the model set is present in local storage.
If a file is missing, **Settings → Download models** opens directly,
including when Neural is clicked again while already selected. This click downloads
no weights; the download button remains an explicit action. Browser models and
native application models are checked separately. If the
models are present but the GPU is unavailable, the runtime settings
open so the diagnostic can be reviewed. Detection tries the high-performance GPU,
then the browser's default choice; it does not bypass browser restrictions.

Git credentials must allow pushing to the target repository.
The `CNAME` file, `.nojekyll`, the licences and the source revision are
included in the publication. The gallery and the documentation already published
are kept; the application's generated files are replaced.
Publications do not rewrite the history of the `gh-pages` branch.

The script `deploy_gallery.sh` continues to publish the gallery at
https://magna-urbis.org/gallery/v2/.

## Real check after publication

From `web/`, `npm run test:v2:live` opens the public site in a test Edge
profile and uses the workshop's ordinary controls. It checks the refusal of CPU neural
generation before download, the verified download, a real WebGPU neural
generation, the full chain with cities from the 3D view, the selection of a
house and the switch to a different roof without changing its footprint, the export and
reopening of the project, the 3D view, the styles and the language. It also cancels a
GPU inference that has started, restarts the generation, then generates with the
model addresses blocked to verify the offline cache. No engine is simulated.
The run also sets the name profile before generation, then replaces
that of the main settlement, checking that the terrain, buildings and provenance
of regional names remain unchanged.
`?test=1` only disables the automatic restoration of the previous recipe;
the test does not use the generation hooks reserved for captures.

The report, projects and captures are in `web/out/v2-live/`. The machine
must have a real WebGPU device. The report identifies the site version and the GPU
architecture; it does not certify other hardware.
`MAGNA_V2_URL` selects a candidate instance, `MAGNA_V2_RECIPE` provides a
recipe or project file to reproduce, and `MAGNA_V2_LIVE_PROFILE` allows reusing a
test profile. On Windows, `MAGNA_TEST_ADAPTER_LUID` can force the test GPU without
changing the user's browser preferences.

Latest qualification: [15 November 2026](archive/releases/WEB_QUALIFICATION_2026-11-15.md).
