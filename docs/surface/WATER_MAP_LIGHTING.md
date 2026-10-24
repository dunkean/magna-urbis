# Source-map lighting prototype

`--water-map-lighting terrain|flat-map` is an opt-in renderer display policy.
The default `terrain` preserves the existing terrain-lit Decal. `flat-map`
requires retained fixed source-map polygons; physical `source-levels` and generic
water fallback are rejected. This is a cartographic colour projection onto the
terrain, not a measured water surface, reflection or bathymetry result.

The projection source RGBA, retained contours, levels, sea partition and symbolic
bank width are unchanged. Flat-map uses the original premultiplied RGB texture
as emission (energy 1), and a renderer-private black-RGB texture with exactly the
same alpha as albedo (mix 1). Decal modulation stays white. Receiver layer 1 is
unchanged; buildings on layer 2 remain excluded. Godot Forward+ adds the sampled
emission RGB without another texture-alpha multiplication, so the already
premultiplied RGB must not be multiplied by alpha again.

The derived image uses Image's C++ `adjust_bcs(0, 1, 1)` and the same C++ mip
reconstruction, rather than a GDScript per-pixel loop. RGBA8 images are required.
The extra image has an explicit 96 MiB limit (a 4096² RGBA8 mip chain is about
85.3 MiB). The derived Texture2D is cached in the projection dictionary, keyed by
its source texture resource; a repeated Decal does not read back or clone it.
The existing three-projection cache bounds retained derived textures; this is
not a total process/RSS or GPU Decal-atlas memory bound. Construction temporarily
holds source and derived CPU images as well as texture resources.

CPU validation: `surface_water_map_lighting_test.gd` passes 2,826 assertions,
including all 256 alpha values, every mip alpha byte, source RGBA preservation,
cache identity, budgets, legacy texture properties and incompatible mode refusal.
The initial report-path setup error was corrected before this successful run.
No GPU validation has been performed for this prototype yet. In particular,
zero-specular albedo/emission isolation does not certify arbitrary PBR bed
specular response, shadows or a complete artistic result.

Run the CPU test with Godot headless and an absolute writable report path:

```text
Godot --headless --path viewer-local --script res://tests/surface_water_map_lighting_test.gd -- ABSOLUTE/cpu.json
```

The separately scheduled GPU oracle is
`viewer-local/diagnostics/water_map_lighting_probe.gd`: inclined terrain, two sun
directions, alpha 0/.25/.5/1, default/explicit legacy byte parity, single-alpha
compositing and a layer-2 roof occluder. It is an authored diagnostic, not a new
hydrology source or a full city qualification.

Primary renderer references:
[Godot 4.7 Decal](https://docs.godotengine.org/en/4.7/classes/class_decal.html),
[Forward+ source, albedo/emission branches](https://github.com/godotengine/godot/blob/4.7-stable/servers/rendering/renderer_rd/shaders/forward_clustered/scene_forward_clustered.glsl).
