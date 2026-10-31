# Neural Earth model assets

These complete inference files are copied into this repository from Neural Earth,
after updating its `main` and fetching `origin/distill`. Every weight file is
strictly smaller than **100,000,000 bytes**; the nine files total **99,783,839
bytes**. They contain no optimizer or duplicate EMA state.

`model-inventory.json` records exact sizes, SHA-256, training selection and source
revisions. `catalog.json` supplies the selectable model IDs and compatibility
rules. The Python service verifies local weight files before loading them.

| Stage | Bundled options |
| --- | --- |
| Coarse | Original; one/two-step EMA200k; four-step EMA50k; eight-step EMA25k; legacy eight-step EMA22.5k |
| Base | Finite residual-altitude TimeFlow, width48, raw8k |
| Decoder | Width64 EMA200k; width16 EMA10k |

The latest width64 export contains exactly the same tensor values as the previous
`main` export. Its serialization and provenance metadata changed, so it is stored
once. Original base (1,014,772,076 bytes), original decoder (111,709,108 bytes), and
NF4 B75 (149,604,748 bytes) remain external and are not copied here.

The residual base requires the exact Coarse2 artifact named by its training
contract and either bundled decoder. It runs Neural Earth's genuine finite-tile
flow at four midpoint intervals, followed by the neural decoder and guided
physical reconstruction. It does not replace the original base inside the
continuous-world pipeline. The local adapter supplies Magna Urbis's retained
regional conditioning and local relief masks. This model remains experimental;
its separate latent domain currently uses deterministic subpixel refinement
without another decoder pass. The original base retains continuous-world
decoder refinement.

The browser WASM source still uses its prepared Coarse4/NF4 B75/Decoder64 runtime.
These PyTorch model options belong to the Python source. No browser compatibility
is implied by a model appearing here.

### Browser downloads and retention

V2 exposes **Downloaded neural models** in **Settings & engines**, with a shortcut
in the neural base stage. It lists the current manifest's files and sizes, saved
models, and other cached versions. Users can download one or all missing models
before generating, cancel, remove files and request persistent browser storage.
Manual downloads report quota/storage failures instead of claiming a save.
Generation consumes the same cache and checks model size and SHA-256 on reuse.
Partial or corrupt downloads are never committed; corrupt cached weights are
removed and downloaded again. A saved catalogue allows inspection when the
model host is unreachable. This does not provide full offline application use.

The prepared browser manifest at the time of this change contains:

| File | Bytes | Decimal MB |
| --- | ---: | ---: |
| `coarse.safetensors` | 5,946,824 | 5.95 |
| `base.nf4` | 149,638,301 | 149.64 |
| `decoder.safetensors` | 6,679,980 | 6.68 |
| Total weights (excluding JS/WASM) | 162,265,105 | 162.27 |

Build output is `rust/pkg/neural-web/models/`, served under `./neural/models/`.
The browser stores verified weights in Cache Storage
`magna-urbis-neural-models-v1`, keyed by model URL and SHA-256, within the site's
browser profile. This is separate from the PyTorch weights above. Retention is
subject to browser storage policy and explicit user deletion; requesting
persistence is not a guarantee the browser will grant it.

`nf4_b75` identifies release `base-nf4-b75-v1`: branch B EMA at 75,000 training
steps, with 253,688,037 parameters and the native two-step solver. The raw release
payload is 149,604,748 bytes; the browser `base.nf4` adds its manifest header.
NF4 is a storage format here. GPU inference decodes weights into FP16/FP32 and
retains the network's computation cost; file size is not GPU memory usage.

The upstream release evaluation compares seven scenes against the original BF16
base: mean absolute difference 24.06 m at LOD3 and 22.15 m at LOD0 (natural
FP32/BF16 variation: 22.43 m / 21.10 m). Fine grain in plains and coast pixels
remain limitations. These are model-agreement measurements on CUDA, not error
against real geography or certified browser parity. No B75-specific WebGPU speed
benchmark or minimum hardware configuration is certified. See the
[release evaluation](https://github.com/dunkean/neural-earth/blob/main/distill/BASE_COMPACT_RELEASE.md).

Validation: `cd web && npx vitest run tests/neuralModels.test.ts`, and with the V2
development server running, `node scripts/v2_neural_models_check.mjs` (defaults to
port 5174). The browser check exercises failure/cancellation states and also
downloads, verifies and rediscovers the actual prepared 162.27 MB profile.

Upstream also documents an experimental native mixed3/4-bit base99.22MB delivery
at `origin/distill` revision9195504. Its weights live outside upstream Git and no
public release download was present when this import was made. It is recorded
as unavailable, rather than presenting an uninstalled model as usable.

Sources: [Neural Earth](https://github.com/dunkean/neural-earth),
[curated weights and contracts](https://github.com/dunkean/neural-earth/tree/919550498b3fd7c9d4c53e575f6a2d5475f9be2d/distill),
[Terrain Diffusion checkpoint](https://huggingface.co/xandergos/terrain-diffusion-30m/tree/9ef8030cb805b433b98ec25c5dddefbac07a9e26).
The original checkpoint/code attribution and MIT text are retained in
`LICENSE-TEACHER.txt`; local inference adapters remain part of Magna Urbis.
