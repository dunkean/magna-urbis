# River headwaters in the textured view

Retained vector lines start at the contributing-area threshold. Hydraulic width at that first point is already commonly 19–31 m. Bank rendering added a circular cap of that width, making the river appear immediately as a large tube or dot on the terrain.

`ground_water_masks.mjs` now builds an appearance footprint with a gradual emergence at genuine small network headwaters. Initial width is capped at 0.60 m, then joins the retained width using a smoothstep profile. The transition spans ten initial widths, bounded between 100 and 420 m and at most 60% of a short line's length. Initial segments are subdivided so the transition does not depend on an exceptionally long first segment.

This treatment excludes map-edge inflows, lake/sea outlets, connections to other lines and high initial flows (area exceeding twice the threshold). Branches, distributaries and abandoned meanders keep their widths. Topology, water levels, retained positions, downstream sections and hydrological sources remain unchanged. The profile is an appearance rule at the display threshold, not a measurement of the real width of a source. No pond is invented.

The local `surface-river-footprint.png` mask is used by the textured view and dependent N1–N4 information. Historical reference Render maps and SVGs remain unchanged. The neighbouring `.json` descriptor records the profile, network and image hashes, and treated headwaters. Preparation reuses the width and bank functions from the retained original Render worktree; it does not modify that reference.

```powershell
node --test godot-render/tools/test_river_headwaters.mjs
node godot-render/tools/ground_water_masks.mjs
python godot-render/tools/ground_surface.py --workers 8
node godot-render/tools/validate_river_headwaters.mjs
python godot-render/tools/validate_ground_surface.py
```

The preparer accepts `--tile mountains--temperate`. Tests cover width progression, preservation of lake outlets and connections, map-edge inflows and restoration of downstream width for short lines. The validator checks all 42 masks and their consistency with N1–N4.

[Original French version](RIVER_HEADWATERS_FR.md).
