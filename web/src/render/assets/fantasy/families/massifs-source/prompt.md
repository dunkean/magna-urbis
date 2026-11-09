# Task: generate high-resolution painted mountain and hill brushes (Magna Urbis illustration style)

Use your built-in image generation tool (not code drawing, not SVG, not PIL shapes) to produce TWELVE separate PNG
images with true alpha transparency, ONE subject per image. Save them exactly at (folder already exists):

- `web/src/render/assets/fantasy/families/massifs-source/massif-01.png` ... `massif-08.png` (8 mountain massifs)
- `web/src/render/assets/fantasy/families/massifs-source/hill-01.png` ... `hill-04.png` (4 hills)

Look first at the existing sibling brushes for the style and palette to match:
`web/src/render/assets/fantasy/families/mountains.png`, `mountain-ridges-v2.png`, `foothills.png`, `hills.png`
(bottom two rows = colour versions). The new images must look like they belong to the same set, but they are drawn
MUCH LARGER and with much more painted detail, because they are displayed several kilometres wide on a map where
trees are only 10 metres wide. They must stay crisp when shown at 1500 px wide.

Format of every file: PNG RGBA, landscape, at least 1536 x 1024 px (larger is better; do NOT downscale below that).
Genuinely transparent exterior (alpha 0 at all four corners and around the silhouette); the illustrated interior is
fully opaque. If the image tool returns an opaque background, ask for a flat pure magenta (#FF00FF) background and key
it out so the exterior is alpha 0 with a clean anti-aliased edge and NO magenta or white fringe. The subject spans
85-95 percent of the image width, its base (foot) sits near the bottom edge with a small transparent margin, the
summit near the top with a small transparent margin. Nothing touches the image border.

Do not modify any other file in the repository. Do not write code into the repository (temporary scripts go to your
own temp folder). When done, write a short summary listing the twelve files, their pixel sizes, and whether alpha is
truly transparent at the corners.

## Common prompt (prepend to each image prompt)

Use case: stylized-concept. Production game asset for a fantasy RPG painted map: ONE single isolated landform,
hand-painted in exquisite fine dark ink linework with restrained watercolour and gouache colour, like the mountains
of a premium illustrated fantasy atlas. Gently plunging oblique view looking down about 40 degrees, visible relief,
NEVER directly top down, never a side profile. Light from the upper left (north-west): lit faces warm ivory and pale
ochre, shadowed faces cool slate grey-blue, crisp shading, ink hatching in the shadows. Palette: warm grey and
ochre rock, slate shadows, sage and olive grass on the lower flanks, ivory highlights, restrained, not saturated.
The landform is MUCH WIDER THAN TALL. NO trees, NO forests, NO buildings, NO roads, NO water, NO text, NO labels,
NO frame, NO cast shadow on the ground, NO background. The foot of the landform dissolves softly into
transparency (feathered, irregular painted base, the lowest grassy slopes fading out), so several of them can be
overlapped into a continuous range. Fine detailed brushwork that holds up at large display size: individual rock
strata, gullies, scree, crests and couloirs readable.

## Massifs (mountains): width about 2 to 2.6 x height

- massif-01: broad alpine massif with one dominant rocky summit and two lower shoulders, deep gullies.
- massif-02: long mountain ridge chain of four to five summits of varying height, receding slightly in depth.
- massif-03: massive rocky dome with steep cliff faces on one side and long scree fans.
- massif-04: twin-peaked massif with a high saddle between the summits, sharp arêtes.
- massif-05: eroded older mountain, rounded rocky crest, wide grassy flanks with rock outcrops.
- massif-06: jagged serrated crest of several sharp rock teeth above wide talus slopes.
- massif-07: high snow-capped massif: snowfields and small glaciers on the upper third, bare rock below, grass at the foot.
- massif-08: broad snow-capped ridge with two summits, snow on the crests and couloirs, rocky lower flanks.

## Hills: width about 3 to 4 x height, low, gentle, rounded

- hill-01: one broad, low, rounded grassy hill, smooth gentle slopes, a few small rock outcrops near the top.
- hill-02: long low grassy ridge with two soft humps.
- hill-03: wide rolling downland hill with a gentle shoulder and a faint scarp on one side.
- hill-04: low rounded hill with patches of heath and a little exposed ochre earth on the lit side.

Hill colour: sage, olive and soft yellow-green grass, pale ochre highlights on the lit side, cool olive shadow;
outlines in fine dark ink, sparse hatching. Hills must read as clearly lower and gentler than the massifs.
