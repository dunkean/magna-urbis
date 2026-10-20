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

Upstream also documents an experimental native mixed3/4-bit base99.22MB delivery
at `origin/distill` revision9195504. Its weights live outside upstream Git and no
public release download was present when this import was made. It is recorded
as unavailable, rather than presenting an uninstalled model as usable.

Sources: [Neural Earth](https://github.com/dunkean/neural-earth),
[curated weights and contracts](https://github.com/dunkean/neural-earth/tree/919550498b3fd7c9d4c53e575f6a2d5475f9be2d/distill),
[Terrain Diffusion checkpoint](https://huggingface.co/xandergos/terrain-diffusion-30m/tree/9ef8030cb805b433b98ec25c5dddefbac07a9e26).
The original checkpoint/code attribution and MIT text are retained in
`LICENSE-TEACHER.txt`; local inference adapters remain part of Magna Urbis.
