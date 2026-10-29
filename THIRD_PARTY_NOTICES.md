# Magna Urbis — third-party credits and licenses

Audit date: 2026-10-30. Magna Urbis code uses **AGPL-3.0-only**, with the full text
in [LICENSE](LICENSE). Third-party components keep their own terms. This file
records provenance and scope; it does not relicense those components.

Third-party GPL v3 portions retain their GPL terms. Their combination with the
AGPL-covered project follows section 13 of GPL v3 / AGPL v3, including the
network-source requirements for the combination. The original
[GPL v3 text](licenses/GPL-3.0.txt) is retained for these portions and historical
versions; this change does not revoke earlier GPL grants.

## Locked software dependencies

[dependency-inventory.json](licenses/dependency-inventory.json) enumerates every
unique registry package/version in the committed npm lockfile and six Cargo
lockfiles, with its original license expression, registry URL, integrity value,
lockfile membership and retained notice hashes. It includes build/test tools,
optional features and packages for other platforms, whether or not a particular
release uses them. It is an inventory of locked possibilities, not a claim that
all these packages ship in every binary.

[DEPENDENCY_LICENSES.txt](licenses/DEPENDENCY_LICENSES.txt) retains the available
upstream license, copyright and notice files, deduplicated by content. `OR`
indicates alternative licenses; `AND` indicates cumulative terms. Historical
Cargo expressions containing `/` are preserved as declared, not silently
rewritten. A `licenseFile` entry must be read together with its retained text.
Packages without a supplied text are explicitly flagged with `review`; a
license identifier is not a replacement for a missing copyright/notice file.

Browser runtime dependencies:

| Component | License | Role / copyright provenance |
| --- | --- | --- |
| [d3-delaunay](https://github.com/d3/d3-delaunay) | ISC | Voronoi/Delaunay geometry; Observable, Inc. and Mapbox; includes Delaunator. |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Compression; Arjun Barrett. |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | MIT | Polygon operations; Mike Fogel, Alexander Milevski and credited upstream portions. |
| [delaunator](https://github.com/mapbox/delaunator) | ISC | Transitive triangulation dependency. |
| [robust-predicates](https://github.com/mourner/robust-predicates) | Unlicense | Transitive geometric predicates. |
| [splaytree](https://github.com/w8r/splay-tree) | MIT | Transitive polygon-clipping dependency; archive omits a standalone notice file, flagged in the inventory. |

Direct web development tools are Vite, vite-plugin-singlefile, Vitest, tsx,
@types/node and @types/d3-delaunay (MIT), TypeScript and Playwright (Apache-2.0),
@webgpu/types (BSD-3-Clause), and @resvg/resvg-js (MPL-2.0). Exact versions and transitive/native package terms are
in the inventory, including Rollup, esbuild and resvg native variants. Native
resvg binaries may contain additional Rust components beyond this npm lockfile;
the publisher's complete binary notices/source must accompany redistribution.

The direct Rust crates declared by the core, WASM, houses, neural, local, desktop
and height helper manifests are covered as follows; exact versions, alternatives
and transitive terms are recorded individually in the inventory:

| Crates | Declared license family |
| --- | --- |
| delaunator | ISC |
| serde, serde_json, geo, i_overlay, rayon, half, png, env_logger, num-bigint, num-rational, num-traits, sha2, burn, tauri, tauri-build, wasm-bindgen, wasm-bindgen-futures, js-sys, console_error_panic_hook | MIT OR Apache-2.0 (upstream order/spelling varies) |
| libm, rmp-serde, zip | MIT |
| wasm-bindgen-rayon | Apache-2.0 |
| pollster | Apache-2.0/MIT as declared upstream |

The seven local workspace crates, two Tauri wrappers, neural WASM adapter,
height helper and native-realization fixture runner declare AGPL-3.0-only for
Magna Urbis, subject to the retained terms of any third-party portions.
The optional `neural-earth-wasm` dependency is a **local path into the sibling
Neural Earth checkout**, not a registry package; its manifest declares
GPL-3.0-only. That checkout and any prepared `rust/pkg` binary must retain their
own provenance and notices. A lockfile does not pin the contents of a path dependency.

## Copied code and adaptations

| Component / local location | License and provenance |
| --- | --- |
| Watabou, TownGeneratorOS / Medieval Fantasy City Generator | Historical starting point and continuing reference; [upstream GPL v3](https://github.com/watabou/TownGeneratorOS/blob/master/LICENSE). The old Python port is absent from the working tree, but remains in Git history. Preserve applicable credits/GPL when distributing that history or surviving adaptations. |
| `web/src/vendor/polygonClipping.ts` | Adapted polygon-clipping 0.15.7; [exact MIT notice](web/src/vendor/polygonClipping.LICENSE.md) and [version/hash/change record](web/src/vendor/polygonClipping.PROVENANCE.md). |
| `web/src/render/cityGlEarcut.ts` | TypeScript port of [Mapbox Earcut 2.2.4](https://github.com/mapbox/earcut/tree/v2.2.4), ISC, copyright 2016 Mapbox; [full notice](licenses/earcut-2.2.4-ISC.txt), also retained inline. |
| `inscribed` in `web/src/gen/geo/poly.ts` | Credits the polylabel method / Garcia-Castellanos & Lombardo / Mapbox. Exact source revision of this local implementation is unrecorded; [ISC reference notice](licenses/polylabel-ISC.txt) retained conservatively, without claiming a byte-identical port or a known revision. |
| `web/src/ui/public/coi-serviceworker.js` | coi-serviceworker 0.1.7 by Guido Zuidhof and contributors, MIT; local configuration precedes the copied worker; [full upstream notice](licenses/coi-serviceworker-0.1.7-MIT.txt), also retained inline. |
| `web/scripts/neural_earth_tile40/` | Seven files adapted from Neural Earth revision `919550498b3fd7c9d4c53e575f6a2d5475f9be2d`; [local modifications](web/scripts/neural_earth_tile40/PROVENANCE.md), [upstream third-party credits](web/scripts/neural_earth_tile40/THIRD_PARTY_NOTICES.md). The prior GPL provenance is retained; the adaptation is now combined with Magna Urbis under AGPL v3, with original third-party terms preserved. This does not establish a blanket license for all Neural Earth files or weights. |
| Terrain Diffusion algorithms / `rust/crates/neural/` and external Python runtime | Alexander Goslin's [Terrain Diffusion](https://github.com/xandergos/terrain-diffusion); MIT, copyright 2025 Alexander Goslin. [Full retained license](rust/models/neural-earth/LICENSE-TEACHER.txt). |

## Python software

The declared illustration dependencies are in
[illustration/requirements.txt](illustration/requirements.txt); ground preparation
has separate [requirements](godot-render/tools/requirements-ground.txt). Python
geometry, plots and canopy experiments additionally import the packages below.
Version ranges are not complete environment locks. These are upstream project
licenses, not a complete inventory of bundled third-party libraries in every
wheel (NumPy/SciPy, rasterio, OpenCV and PyTorch in particular).

| Package | Upstream license / source |
| --- | --- |
| torch / PyTorch | BSD-3-Clause; [license and bundled notices](https://github.com/pytorch/pytorch/blob/main/LICENSE). |
| diffusers, transformers, accelerate, safetensors, huggingface-hub | Apache-2.0; [Hugging Face repositories](https://github.com/huggingface). |
| Pillow | HPND, with additional bundled notices; [license](https://github.com/python-pillow/Pillow/blob/main/LICENSE). |
| NumPy | BSD-3-Clause; [license and bundled components](https://github.com/numpy/numpy/blob/main/LICENSE.txt). |
| SciPy | BSD-3-Clause; [license](https://github.com/scipy/scipy/blob/main/LICENSE.txt). |
| numba | BSD-2-Clause; [license](https://github.com/numba/numba/blob/main/LICENSE). |
| opencv-python-headless | Apache-2.0 for current OpenCV, MIT for the packaging scripts, additional bundled components; [packaging license and notices](https://github.com/opencv/opencv-python). |
| sentencepiece | Apache-2.0; [license](https://github.com/google/sentencepiece/blob/master/LICENSE). |
| shapely | BSD-3-Clause; [license](https://github.com/shapely/shapely/blob/main/LICENSE.txt). GEOS is separately LGPL-2.1; retain the wheel's bundled notices. |
| rasterio | BSD-3-Clause; [license](https://github.com/rasterio/rasterio/blob/main/LICENSE.txt). GDAL and other bundled libraries have separate terms. |
| pyproj | MIT for pyproj and PROJ, plus bundled data terms; [license](https://github.com/pyproj4/pyproj/blob/main/LICENSE). |
| requests | Apache-2.0; [license](https://github.com/psf/requests/blob/main/LICENSE). |
| matplotlib | Matplotlib license based on PSF, plus bundled components; [license](https://github.com/matplotlib/matplotlib/blob/main/LICENSE/LICENSE). |

The neural service imports `terrain_app`, `terrain_inference`, `distill` and
`terrain_diffusion` from the external sibling checkout, selected through
`MAGNA_NEURAL_EARTH` / `MAGNA_NEURAL_PYTHON`. Its actual environment, sources and
dependencies must be inventoried separately when shipping that optional runtime;
the presence of the teacher's MIT license does not cover every imported module.

## Textures, vegetation and data

| Resource | License, attribution and inventory |
| --- | --- |
| Poly Haven building textures | CC0-1.0; individual asset names, artists, URLs and file hashes in [building catalog](assets/materials/buildings/catalog.json) and each adjacent `material.json`. [Provider terms](https://polyhaven.com/license). |
| ambientCG building textures | CC0-1.0; Lennart Demes / ambientCG, individual assets in the same building catalog; [provider terms](https://docs.ambientcg.com/license/). |
| Natural surface materials | CC0-1.0; all 15 Poly Haven asset IDs in [surface catalogue](surface/materials/catalogue.json). Prepared maps retain the source provenance; no new ownership of the CC0 source is claimed. |
| Godot ground candidates | Poly Haven / ambientCG, CC0-1.0; 142 candidates in [ground catalogue](godot-render/ground_texture_catalogue.json). The catalogue is a study/selection, not proof that every candidate is downloaded or shipped. Prepared source URLs/hashes are written by `prepare_ground_textures.py`. |
| Grass Medium 01 | Poly Haven; Rob Tuytel and Rico Cilliers; CC0-1.0. [Exact sources and changes](surface/vegetation/catalogue.json), [usage](surface/vegetation/README.md). |
| Tree Small 02 | Poly Haven; Rico Cilliers; CC0-1.0. [Source files, hashes and preparation tool](surface/vegetation/tree-offline-source.json). |
| Packed building material atlases | Derived from the CC0 sets above; [render asset provenance](web/src/render/assets/PROVENANCE.md), `web/src/render/assets/materials/materials.json`. |
| CHMv2 canopy statistics | Meta and World Resources Institute (WRI), 2026, Version 2 High Resolution Canopy Height Maps; source imagery for CHM © 2016 Vantor. Data CC BY 4.0. Source [AWS data registry](https://registry.opendata.aws/dataforgood-fb-forestsv2/); [local sampling/transformation record](rust/experiments/forest-chm/README.md), `chm_reference.json`. The stored results are resampled/windowed statistics from model estimates, not raw imagery or field measurements. See the local experiment for sampled sites; audit/source verification 2026-10-30. |

Full [CC0-1.0](licenses/CC0-1.0.txt) and [CC BY 4.0](licenses/CC-BY-4.0.txt)
texts are retained separately. CC0 assets allow commercial reuse and require no attribution. The live Poly Haven
API has [separate service terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md),
including application identification and a visible provider credit when surfacing
live content. The tools identify Magna Urbis in their requests. This service
condition is separate from the rights in downloaded CC0 files.

The 2D painted brushes, UI icon atlases, favicon and fantasy assets have local
ImageGen/user-reference provenance; see [render assets](web/src/render/assets/PROVENANCE.md),
[rail icons](web/src/ui/assets/PROVENANCE.md) and
[V2 icons](web/src/v2/assets/icons/PROVENANCE.md). They are not Poly Haven assets.
Original project artwork is covered by the repository license to the extent the
contributors hold applicable rights; AI generation does not guarantee exclusive
copyright. User-supplied reference material retains any pre-existing rights.
The six [heightmap library entries](web/src/v2/assets/heightmaps/library.json)
are generated locally by the project's terrain engine, not imported geographic
datasets. Generation provenance is not itself a distinct license grant.

## Models and external services

Model weights, inference code, training data and generated outputs have different
legal scopes. Do not describe an entire optional AI pipeline as GPL or MIT merely
because its adapter uses that license.

| Model / integration | Terms and pinned source |
| --- | --- |
| Terrain Diffusion teacher checkpoint | `xandergos/terrain-diffusion-30m`, revision `9ef8030cb805b433b98ec25c5dddefbac07a9e26`; [model card](https://huggingface.co/xandergos/terrain-diffusion-30m), MIT; [retained teacher text](rust/models/neural-earth/LICENSE-TEACHER.txt). |
| Bundled Neural Earth distilled weights | Nine local artifacts, source revisions and hashes in [model-inventory.json](rust/models/neural-earth/model-inventory.json). Teacher attribution is retained. **A separate, explicit license grant for the imported student weights has not been established by the files audited here.** Clarify it with the upstream rights holder before claiming unrestricted redistribution/commercial rights in those artifacts; do not infer it from the teacher's MIT grant. |
| SDXL base | Stability AI, `stabilityai/stable-diffusion-xl-base-1.0`, revision `462165984030d82259a11f4367a4eed129e94a7b`; CreativeML Open RAIL++-M, with use restrictions; [license](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/462165984030d82259a11f4367a4eed129e94a7b/LICENSE.md). Downloaded on demand, not committed weights. |
| SDXL-Lightning | ByteDance, revision `c9a24f48e1c025556787b0c58dd67a091ece2e44`; [OpenRAIL++ model card](https://huggingface.co/ByteDance/SDXL-Lightning/blob/c9a24f48e1c025556787b0c58dd67a091ece2e44/README.md), distilled from SDXL. External download. |
| ControlNet Union SDXL 1.0 | xinsir, revision `801a4a3fa3d4c936f4feea95b98607bc6726f80c`; [Apache-2.0 model card](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/blob/801a4a3fa3d4c936f4feea95b98607bc6726f80c/README.md). External download; it does not remove SDXL's terms. |
| FLUX.2 Klein 4B and Klein base 4B | Black Forest Labs; revisions `e7b7dc27f91deacad38e78976d1f2b499d76a294` and `a3b4f4849157f664bdbc776fd7453c2783562f4d`; [distilled model](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B), [base model](https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B), Apache-2.0. External downloads. These terms must not be generalized to other FLUX variants. |
| OpenAI / Gemini image APIs | Remote commercial services used with the user's credentials; their service/output terms apply separately. No model license is conveyed by the local AGPL adapters. |
| GoatCounter `count.js` | Remote analytics script, loaded only on the public GitHub Pages hostname; Martin Tournoij, ISC for the integration script. [Upstream notices](https://github.com/arp242/goatcounter/blob/main/LICENSE) distinguish it from the server's modified EUPL terms. The script is not pinned or committed here. |

The imported Neural Earth notices also mention World Orogen (GPL), World Builder
(MIT), ETOPO and WorldClim as upstream dependencies/data provenance. They do not
prove that those components or datasets are directly bundled in Magna Urbis;
see the retained upstream notice for their role. Retain their terms if shipping
a prepared external runtime that includes them.

## Toolchains and redistribution scope

Node.js (MIT with bundled notices), npm (Artistic-2.0), TypeScript (Apache-2.0),
Rust (MIT/Apache-2.0), Python (PSF license and bundled notices), Godot (MIT and
its third-party notices), Blender (`bpy`, `bmesh`, `mathutils`; GPL and bundled
notices), and optional CUDA/cuDNN drivers/libraries are external tools/runtimes.
Their installation/use does not assign their license to generated files.
Redistributing their binaries, system WebViews, GTK/WebKit, GPU libraries, fonts
or codecs requires the corresponding distribution's actual notices and terms.

Before distributing a build, include `LICENSE`, this file, the relevant retained
texts and notices, source provenance for assets, and the AGPL/GPL corresponding-source
delivery required for that exact build. Respect MPL/LGPL/CC BY obligations for
components actually included. Keep the inline Earcut, polygon-clipping and
service-worker notices in minified/offline artifacts.

Remaining boundaries are explicit: unresolved `review` entries, the student
weight grant, unpinned/local Neural Earth code, Python transitive environments,
and dependencies embedded inside prebuilt native binaries are not certified by
this source-tree inventory. Reconcile them against the actual release contents.
The generated inventory is maintained with:

```sh
python scripts/license_inventory.py --refresh
python scripts/license_inventory.py --check
```

The refresh reads installed package sources or downloads registry archives with
lockfile checksum verification, without installing or executing them. The check
is offline.
