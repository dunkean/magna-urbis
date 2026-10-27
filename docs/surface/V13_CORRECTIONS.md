# Corrections after the V12 review

24 October 2026. The [Opus V12 review](reviews/phase06-followup-v12.md) accepts the technical campaign on `bc6579f`, but refuses artistic quality and production release. The following changes are not validated by that campaign and require their own evidence. V12 results remain frozen.

## Distinguishing producer delays

`surface_page_timing.mjs` version 2 adds milestones on the page clock: SSE receipt of the native request, start/headers/end of the actual Infinite Generation download, then existing Worker and upload milestones. Numeric coordinates and bounded IDs allow stages to be joined without retaining heights or large registration bodies in diagnostics.

The wrapper reads no body before its consumer and returns its original buffer. It preserves events, arguments, responses, errors and transfer ownership. Flows without instrumentation keep their ordinary path. The five instrumentation tests and log/retention checks pass.

This instrumentation targets the still-unattributed V12 preview delay; it does not demonstrate its cause or accelerate generation by itself. `processorTiming.synchronousMs` and milestones remain wall durations, not CPU-time measurements.

The [three-journey diagnostic](evidence/navigation-repeat-v13.json) on `d195068` retains a fresh source and shared session. Each nominal 20 s window displays two new worlds: native 30 m parent after 11.720 / 11.727 / 12.290 s, then 0.9375 / 1.875 / 0.9375 m neural refinement after 17.111 / 16.899 / 17.334 s. All three timing/source checks pass. **All three strict phases remain failed**: two WASAPI audio-initialisation errors occur at each startup. The collector exits zero because it collected three results; this is not a successful global qualification.

The new milestones measure SSE receipt → accepted upload at 914–1,039 ms for first worlds and 429–452 ms for displayed refinements. These are durations of those journeys, not a retrospective explanation of V12's 8.28 s HTTP time. Order and caches are shared, host load differs, and 1.12–3.20 s frame freezes persist. No causal gain or 60 FPS is inferred.

The cartographic launcher now explicitly uses `--audio-driver Dummy`: there is no audio scene here, so rendering must not depend on a Windows device, especially in a remote session. Errors in older measurements remain preserved; this configuration requires its own run. The driver also passes the vegetation manifest via `--viewer-vegetation-assets` to each phase, with separate initial/final hashes.

## Integration and targeted next steps

- Lightweight CC0 grasses: ingestion and rendering integrated; 52 native assertions and [six GPU A/B comparisons](evidence/vegetation-grass-v13/README.md) pass within their limits. The [tree consumer](evidence/vegetation-tree-v13/GPU.md) is integrated optionally, with TOP controls, oblique urban rendering and declared limits.
- Ground: [continuous physical response](GROUND_RESPONSE.md) is integrated and checked numerically/on GPU; physical fields remain those of canonical context. No blurred texture replaces missing fine observations.
- Water: [six isolated channels and tint A/B](HYDROLOGY_V13_DIAGNOSTIC.md) distinguish alluvial support from composite. Uniform mode passes GPU checks without changing alpha, classes or geometry; the default is unchanged.
- Edge: the [40 km capture](evidence/source-edge-v13/40000m.png) checks a two-pixel sky strip consistent with the actual domain, without extending source heights.

The [complete V13 campaign](evidence/NATIVE_V13.md) technically qualifies these changes together on `6ef8d3c`: 624 identical files, fresh source, nominal 20 s navigation, seven zoom levels, two layer probes and strict archive restoration. Artistic review remains separate. [Views of 419 buildings](NATIVE_CITY419_V13.md) use a retained legacy source, without GR or fresh generation.

Shared oblique scheduling (atlas/resident/envelope of the same heights) and high-LOD selection by support rather than centre are prepared in other worktrees. The phase-0 oblique counterexample and 10 m tour without high geometry remain retained; no future fix is credited to V13.

[Original French version](V13_CORRECTIONS_FR.md).
