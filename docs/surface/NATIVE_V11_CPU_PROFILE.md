# Native V11 CPU attribution

The strict V11 campaign on `176e774` failed: its first fresh preview arrived too
late to finish native preparation inside the nominal 20-second motion window.
The failed result is preserved. The separate CPU replay below does not qualify
navigation or replace the campaign's concurrent measurements.

The producer reconstructed previews 21, 204 and 253 using the existing source
registration, with original terrain hashes, parent diagnostics, world IDs,
versions and layer descriptors checked. These are retained replay packets, not
archived byte-exact network BODYs. No new generation or registration was used.

The [recorded profile](evidence/native-v11-cpu-replay.json) loads the saved initial
context, warms canonical layer images, accepts those packets through the native
consumer, and profiles private instrumented copies of the unchanged adapters.
All six production adapter hashes match the frozen runtime. No GPU was used.
The TOP camera is reconstructed from recorded focus/width and prior origin;
the complete preceding camera/atlas history is not replayed.

| Component | Recorded live V11 | Headless replay, first preview21 |
|---|---:|---:|
| Data total | 1508 ms | 3778 ms |
| Height images within Data | not separately timed | 3591 ms |
| Layer images within Data | not separately timed | 0.038 ms, warm cache |
| Base scene geometry within Data | not separately timed | 187 ms |
| Population total | 1226 ms | 2318 ms |
| Crown raster within Population | not separately timed | 1418 ms |
| Atlas image copying/hash/metadata | not separately timed | 805 ms |
| Atlas mips | not separately timed | 54 ms |
| Fixed hydrology | 555 ms | 938 ms |

Absolute headless times differ substantially from concurrent runtime times.
They attribute work; they are not measurements of the original job's latency.
The near204 replay atlas hash exactly matches the runtime atlas. Case253's
reconstructed camera rejects its canopy reference plane, so its Population
measurement is explicitly **not equivalent** to runtime g12. It must not be used
to claim an atlas speedup. Earlier incorrect probe camera setups were discarded.

For the empty near water window, each baseline call still decodes the archived
geometry (~153–166 ms), validates 512² water classes (~123–136 ms), translates and
clips 157,220 points in 703 groups (~325–348 ms), reconstructs the sea union
(~211–226 ms), then builds metadata/class image (~47–52 ms). Zero output vertices
does not mean the original source or these loops were empty.

An immediate identical-request second attempt exercises the existing atlas
cache, while all height pixels and hydrology are recomputed. This is not evidence
of atlas reuse at a different camera. No new atlas policy, preview representation,
source resolution, Terrain3D import size, geometry or acceptance criterion was
changed by this diagnostic.

Reproduction, with Godot class imports already initialized:

1. Run `python viewer-local/diagnostics/make_native_prepare_profile.py`. It creates
   ignored instrumented copies under `viewer-local/captures/native-v11-profile/`;
   anchors fail explicitly if source code changed.
2. Save the report's `config` object as a JSON file, adapting only input/output
   paths to the retained artifacts. The report records the exact measured inputs.
3. Run `Godot --headless --path viewer-local --script
   diagnostics/native_prepare_replay_profile.gd -- <config.json>`.

Only a cache of immutable source JSON decoding/class validation is proposed as a
bounded follow-up. There is no evidence here that such a change alone resolves
the browser/Worker delay or makes a future full campaign pass.
