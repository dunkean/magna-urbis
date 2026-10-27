# V4 forest-cover CPU diagnostic

These reports examine the actual `native-e2e-40km-v4/fresh-source.surfacebin` packet read-only. They are neither a new generation nor GPU evidence. The script uses production modules from the integration worktree; its absolute paths describe the measurement environment. Artifact and packet hashes are in [SHA256.json](SHA256.json).

Canonical context is a 512² raster at 78.125 m spacing, whose first sample is at (39.0625, 39.0625) m. Its `treeCover` field is identical in the initial packet and the context of the examined refinement packet.

Outside the central 480 m square, mean canonical cover is 24.3903% in the 640 m window (28 samples) and 24.3507% in the 2,560 m window (988 samples). All samples are nonzero. Visual disappearance outside the square is therefore not disappearance of the source field.

| Window | Actual trees | Expected mean count | Target cover | Crown union |
| --- | ---: | ---: | ---: | ---: |
| 320 m | 476 | 466.46 | 29.1866% | 29.4632% |
| 480 m | 963 | 996.22 | 27.8722% | 26.6891% |
| 512 m | 1,096 | 1,118.55 | 27.5440% | 26.3840% |

The 320 m request exactly reproduces the initial packet's 476 trees. Cover values are unions of discs with physical `crownRadiusM`, measured over 256² deterministic probes; summing disc areas overestimates coverage when crowns overlap. Maximum measured difference is 1.1831 percentage points. This control covers these three specific windows, without claiming validation of all biomes or rendered appearance.

The worker bounds local inventory with `radius = min(240, extent / 2)`: the 480 m window, supplemented by the display halo, explains a boundary near 512 m. A distant representation must use the canonical field outside this inventory without presenting approximate patterns as trees with source identities. This dossier includes no rendering change.

## Historical references consulted without modification

In Magna `bf3ccc7`, `rust/bridge/terrainRenderV2.ts:90–126` filters the forest field at the physical footprint, constructs ground/litter/canopy weights and blends responses in linear light. `rust/bridge/terrainForest.ts:720–800` contains the stand-pattern / grain / resolved-crown transition.

In Neural Earth `ce7f8cb`, `web/terrain_render3d.js:540–638` contains `applyForest`, and `web/terrain_render_v2.js:309–346` the mean BRDF correction `v2CanopyMeanRatio`. The corresponding technical control is `tools/verification/verify_render_v2_canopy_mean.cjs:1–36`. These references describe representation methods; they do not authorise replacing current canonical fields with a new procedural environment.

[Original French version](README_FR.md).
