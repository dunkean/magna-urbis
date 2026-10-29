# Scientific method notes

Every newly implemented generation or rendering method based on a known
technique or publication should have a short English Markdown note here. Link
it from its control's question-mark help on click, or through a clickable link
in the tooltip. Bundle the note and its figures for standalone/offline use.

Explain the objective, inputs and physical units, equations or algorithm,
assumptions, deterministic behavior, scale/LOD behavior, and limitations. Cite
primary sources, state the actual implementation, and distinguish adaptations
from unimplemented parts of a paper. Report reproducible settings and measured
validation evidence. Add compact, captioned screenshots when they help readers
understand the method; keep large raw captures and scratch output in `web/out/`.

Keep Markdown as the source of truth. The shared viewer is
`web/src/ui/methodNotes.ts`; register the note and bundled figures there and
connect the relevant control in `terrainHelp.ts`. It supports headings, links,
figures, tables, lists and fenced equations/code. Use readable Unicode or plain
text equations in fenced blocks so the offline reader needs no remote math
service.

- [Render3D: multiscale ground, material and mesh](render3d-ground.md)
- [Fantasy brushes guided by territory occupation](fantasy-landuse.md)
- [Render3D: forest field, crowns and applied occupation](render3d-vegetation.md)
- [Render3DBrush: biome brushes in the forest material](render3d-brush.md)
- [Neural Earth amplification on retained terrain](neural-earth-amplification.md)

- [Compact regional erosion and Phasor terrain](compact-terrain-phasor.md)

- [Inspectable procedural generation and biome erosion](procedural-generation-stages.md)

The stage-by-stage overview of the whole pipeline (one bilingual section per
stage id of `docs/stage-registry-contract.md`, with diagrams) lives in the
scientific atlas, `docs/scientific/index.html` (EN) and `fr.html` (FR); link
each note from the matching `#stage-<id>` section by editing
`docs/scientific/stages-data.mjs`.
