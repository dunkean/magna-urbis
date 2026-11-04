# V2 desktop icon

The detailed `app-icon.png` is used on the loading splash. The simplified
`app-icon-v2.png` is reserved for the desktop/application icon and favicon.

`app-icon-v2.png` is the current desktop icon master. It was created with the built-in `image_gen.imagegen` tool using the earlier `app-icon.png` as the reference. The original logo and the first generated icon are retained. The V2 build uses the pinned Tauri CLI to generate platform icon files from the current master.

Current prompt:

> Use case: logo-brand. Asset type: square desktop application icon, 16–32 pixel readability is the highest priority. Input image is the existing Magna Urbis city-and-compass emblem: simplify and refine it while keeping its recognizable compass, city silhouette, circular ring and navy, antique gold, cream palette. Remove the entire fine road mesh, all small buildings, tiny windows and all thin decorative lines. Use a single dominant, bold four-point gold compass with thick simple points, and only two or three chunky, clearly separated city skyline blocks behind it. A solid dark navy circular field and one thick cream or gold ring; very few large flat shapes, strong contrast, clean edges, visually balanced centered icon. The entire design must read clearly at Windows taskbar scale; prioritize simple silhouette over detail. Transparent background outside the emblem, no text, letters, watermark or mockup.

The Tauri CLI generated the ICO and PNGs from `app-icon-v2.png`. Its 16- and 32-pixel ICO images were inspected at enlarged nearest-neighbor scale: the compass and circular emblem remain distinct; the simplified city is clearer at 32 pixels than at 16 pixels.

Earlier icon provenance: `app-icon.png` was created with the built-in `image_gen.imagegen` tool using `web/src/ui/assets/logo-magna-urbis.png` as the reference.

Earlier prompt:

> Use case: logo-brand. Asset type: square desktop application icon. Input image: the existing Magna Urbis logo is the visual identity reference. Recreate and refine its recognizable central compass-rose and city/map silhouette, preserving the dark navy blue, muted antique gold and parchment-cream palette and the dignified cartographic character. Compose one bold, centered emblem with clean, simplified shapes and strong contrast that remains immediately legible at 16–32 pixels, with comfortable transparent margins. Polished, restrained desktop-icon finish; crisp edges and balanced proportions. Preserve the recognizable logo identity rather than inventing a different emblem. Genuine transparent background. No text, letters, watermark, UI mockup, or extra objects.

Earlier validation: the V2 static splash check and Windows desktop smoke test passed with the first icon. The updated icon requires a fresh desktop build and smoke check.
