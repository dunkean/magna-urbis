# Hydrology icon v1

- Asset: `hydrology-icon-v1.png`
- Project: Magna Urbis V2
- Generated: 2026-10-29
- Method: built-in `image_gen.imagegen` image generation tool, single new-image generation with `transparent_background: true`. No CLI/API fallback.
- Style reference inspected: `coast-icons-v1.png` (not passed as an image input; the final generation used the descriptive prompt below).
- Original source: `C:\Users\U108-N257\.codex\generated_images\01a184a4-a211-7f01-86a9-59dcddf45565\exec-5857ef99-6c47-4362-ae18-7ccb45306fba.png`
- Saved to the workspace by an unchanged file copy. No image resize, recoloring, cropping, alpha cleanup or other retouching.
- Actual dimensions: **1254 × 1254 px**. The tool returned this square size despite the prompt's 1024 × 1024 request.
- Format: PNG, RGBA. Read-only Pillow validation found alpha extrema 0–255, **456,115 fully transparent pixels**. Visible alpha >8 bounding box: `(57, 69, 1203, 1193)` in the full canvas.
- Visual review: two blue branches converge into a curving river and a lower lake; parchment terrain, sage patches, no text, houses, roads or UI frame. The subject fills roughly 90% of the canvas rather than the requested 80%; transparent margin remains on every side.

## Exact final prompt

```text
Use case: ui-mockup.
Asset type: One production PNG icon for a fantasy cartography application's hydrology settings button, readable at 32–40 pixels.
Primary request: A small top-down square terrain fragment with TWO vivid blue streams meeting into ONE broad curving river that flows into a small blue lake. Make the blue water network the clear main silhouette, thick enough to read at small button size.
Style/medium: Hand-painted watercolor fantasy map miniature, warm parchment tan land with a few muted sage-green patches, delicate dark brown ink edges and very subtle water highlights. Match the tactile painted coastal-map icon style; simple and calm, not photorealistic.
Composition/framing: Square 1024×1024 canvas, a single centered terrain swatch filling about 80% of the image width and height. Near top-down view. Two thick streams enter from the upper left and upper right, join near center, then a single wide sinuous river curves down to a compact small lake in the lower half. Keep everything simple and clearly separated. Transparent padding on all sides. The terrain outer edge may be softly irregular like a parchment map fragment, with a delicate shadow.
Color palette: Sandy beige and soft olive/sage land; saturated turquoise/slate-blue streams, river and lake, with restrained dark blue contours.
Text: none.
Constraints: Genuine alpha transparency OUTSIDE the terrain fragment. One icon only, not a sheet. Broad simple blue forms must dominate readability, with no microscopic details. No sea/coastline, no houses, no roads, no buildings, no text, letters, numbers, arrows, logos, compass, border, UI frame, checkerboard pattern or watermark.
```
