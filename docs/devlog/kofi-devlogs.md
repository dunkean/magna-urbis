# Magna Urbis — Ko-fi devlogs #00–#06

Source text for Ko-fi posts. English is the reference; French translation in `kofi-devlogs_FR.md`.
Placeholders: `[LINK]`, `[IMAGE: …]`, `[TODO: …]`.

---

## Devlog #00 — 925 commits in six weeks, and I typed almost none of them

Hi, I'm dunkean. Day job: researcher in AI and complex systems. Night job: a procedural world generator for tabletop RPGs, called Magna Urbis.

This devlog is about how it's built, what broke and what surprised me. No roadmap promises.

### What it does

One pipeline, from the ground up:

terrain → hydrology → regional roads → settlement placement → quarters and streets → parcels → programme (who lives and works where) → building sites → building volumes → 2D map styles and a 3D view.

115 architectural cultures, from medieval European to medina, hutong, dwarven, elven, modern and a few alien ones.

### The stack

- **Rust core**: about 258,000 lines. The urban module alone is about 108,000, and it is one strongly connected block. I tried to split it into crates. The plan concluded it wasn't worth it: everything calls everything.
- Compiled twice: **native**, as a local HTTP engine for the desktop app, and **WASM** for the browser.
- **TypeScript front**: about 180,000 lines, with WebGL2 and WebGPU renderers.
- Day one (30 September) was a Python prototype. It was deleted on 12 October.

### How it's built

I write very little code by hand. I run AI coding agents (mostly Claude, some Codex), several at a time, and I act as architect and reviewer: I decide what to build, I look at the images, I reject things.

That works. It also fails in ways I didn't expect:

- **Parallel builds.** Several agents, each with its own Cargo target directory, each rebuilding a 100k-line crate from scratch. Hours of CPU for nothing. The rule now: agents write code and stop, then one supervisor compiles once and tests once.
- **The antivirus** quarantined `rustc.exe` 1.99. The toolchain is pinned to 1.98 now.
- **A wedged GPU.** Screenshot scripts launched headless Chrome, and a shell `timeout` killed them. That left 19 orphan GPU processes stuck in the driver: `taskkill /F` couldn't kill them, no browser could create a WebGL context, and I had to reboot. Now every browser script has its own time limit, closes the browser in a `finally`, and runs on a dedicated GPU.
- **Endless local fixes.** Left alone, an agent will happily add the 40th special case to make a river look right. More on that in #02.

The good surprise is speed. In six weeks I went from an SVG scaffold to 115 cultures, neural terrain, and a 3D view. Agents are also very good at writing measurement tools, and most of the wins below came from those.

### Why Ko-fi

The code is AGPL v3 and stays free. No premium tier.

AI agents aren't free, though. If you like the project, the Ko-fi button helps pay for them. Bug reports with a share code are worth just as much to me.

- Magna Urbis: [LINK]
- GitHub: [LINK]

[IMAGE: one generated town, 2D + 3D side by side]

---

## Devlog #01 — Porting a terrain diffusion model to pure Rust

Noise-based terrain is fast, but it doesn't know what a mountain range looks like from 40 km up. Diffusion models do. The model I started from is **Terrain Diffusion** by Goslin, the one behind InfiniteDiffusion (Infinite Generation). Big credit to that work: without it, none of this exists.

The problem: it's a PyTorch stack. I wanted it inside the generator, with no Python at runtime and no server.

### The port

I reimplemented the inference chain in Rust with **Burn**, using FP16 convolutions on Vulkan:

- portable noise, so the same seed gives the same relief on every machine;
- the EDM2 UNets, the coarse sampler steps (DPM-Solver++), the distilled decoder and the Laplacian reconstruction;
- a `neural export` command that converts the PyTorch / safetensors checkpoints to FP16 weights directly;
- a `neural serve` mode that keeps the weights resident behind a local HTTP service.

### Good surprise #1: fewer evaluations

The original pipeline tiles an infinite world. I only need one finite map, so I plan the windows for that map. One 40 km map now takes 4 / 64 / 16 model evaluations per stage instead of 16 / 100 / 25. That's about **one second on an RTX 3090**.

### Good surprise #2: precision

I checked the port against the same chain run fully in FP32 in Python. Mean difference: **3.95 m**. The production BF16 path of the original differs from that FP32 reference by **19.8 m**. So the FP16 Rust port is closer to the FP32 result than the original production setting.

### The fail

The first WebGPU/WASM build was **too slow, and wrong after autotune**. It shipped unwired on day one, with a note in the commit saying exactly that.

The reason: without autotune, Burn's portable WebGPU convolution is a naive direct kernel. So two days later the browser stopped using Burn. I wrote a small dedicated engine in WGSL:

- implicit-GEMM convolutions over NHWC activations, FP16 when the GPU supports `shader-f16`, always with FP32 accumulation;
- the small ops fused into the kernels (activation, modulation, pixel norms, biases, residuals, skip concatenations);
- one queue submission per readback;
- a fixed accumulation order, so the output doesn't depend on the GEMM tile. The FP32 path matches Burn FP32 to 0.002 m.

The base model also had to shrink for a download: it went to 4-bit weights (NF4), with a model trained to live with that quantisation, and to two sampling steps.

Chrome, RTX 3090, one uncached 30 m tile: **104 s → 2.0–2.2 s**. First coarse tile: 6.8 s → 0.3 s. The inference WASM: **67 MB → 0.7 MB**.

### What happens after

The neural relief goes into the terrain generator as a fixed surface, with no extra cutting or erosion on top. Then the usual stages run on it: hydrology, roads, towns. The Underdark layer works the same way: it carves caves into any relief, procedural or neural.

The distilled weights are in Git LFS.

- Neural Earth: [LINK]
- Terrain Diffusion / InfiniteDiffusion: [LINK]

[IMAGE: same sketch, procedural vs neural relief]

---

## Devlog #02 — Fix the rule, not the case

The most expensive lesson of V2 so far: **a fix that only handles the case in front of you is a debt.**

### Rivers: the engine I threw away

By mid-October I had a TypeScript "vector" river engine, with meanders, oxbows, confluences, lake shoals and channel styles. Every review round found something new: stepped lakes, uniform widths, rivers that disconnected. Every round got its local fix, and the next round found three more.

On 12 October I stopped and killed it. It was ugly, it was slow, and it would never converge.

What replaced it:

- the **old Rust river graph** (lakes as nodes with an inlet and an outlet). Its rivers were already good, but it had no lakes;
- **lakes from a climate water budget**: Fill–Spill–Merge (from Barnes et al.), with open and closed lakes;
- **one lake definition** shared by routing, the graph and drawing. The same shore field feeds the Rust polygons and the GPU shader, so the map can't disagree with the simulation;
- fixes go in as **invariants** (`hydrology_invariants.rs`): when a picture looks wrong, I write the property it violates, then fix the rule that breaks it. Geometry passes keep the edge endpoints fixed, and when they fail they fall back to the previous geometry.

### Towns without houses

One review sheet showed towns with no houses at all: a harbour town on a landing with no streets, a 10k alpine town with no valid site, steep slopes that nothing could cut into lots.

First attempt: a ladder of fallbacks. Keep the harbour only if it houses as many households as the original site. Fall back to the regional roads. Fall back to the best free land. Retry the footprint at stair grade, then at 0.75. If all else fails, show a "No dwellings" warning.

It worked, and it was still the wrong framing. Nepalese villages and Bhutanese temples sit on slopes. **Steep ground is a normal site, not an error case.** So now the generator surveys the land first. It picks how much to relax its slope rules before the first layout, instead of failing, then relaxing and laying out the whole town again. Result: a halfling town on a mountain flank went from 4 full plans to 2.

### Roads: polish, don't rebuild

The road trajectories are the best part of the generator. Mountain switchbacks look genuinely credible. The defects were at the joins: round caps overlapping, roads overshooting other roads by 2–3 m, width classes meeting with no logic, too many near-parallel duplicates.

The temptation was to rewrite routing. I didn't. Junction artefacts are fixed in the render geometry. Structural changes are only for real overshoots, widths and duplicates. And there's a hard budget: the road stage must not get noticeably slower.

### The meta-lesson

An AI agent asked to "fix this picture" will fix that picture. You have to ask it for the invariant.

[IMAGE: before/after lakes, or the empty alpine town and the fixed one]

---

## Devlog #03 — The browser tax

The generator runs natively for the desktop app and as WASM + WebGPU in the browser. The browser version is the hard one. A few things I learned the hard way.

### Shaders: the compiler inlines everything

On Windows, Chrome runs WebGPU through Dawn → Direct3D 12 → **DXC**. DXC inlines every function call. So compile time doesn't follow your source size. It follows the size of the live code *after inlining*.

My satellite map shader had a `surfaceNoise` function with 8 unrolled corners, called from about **160 places**. Each call site is a full copy. The live inlined map shader was about **4.67 million characters**.

A second trap: WGSL override switches mixed with runtime values in the same `if`. The compiler can't drop the dead branch, so both get compiled.

The fix is boring. Turn repeated calls into loops, with the same arguments in the same order so the arithmetic doesn't change. Keep variant tests pure. Make "natural water" a runtime uniform, so two looks share one pipeline.

- Inlined map shader: 4.67 M → 1.40 M characters.
- First Satellite view: **47.8 s → 13.2 s** from that change alone.
- With idle prewarm, retained products and preparation in workers on top, the first cold Satellite view is now **3.8 s**.

For comparison, the same cold load on ANGLE/D3D11 took 56 s, against 1–6 s on Vulkan. If you're on Windows and the first load is painfully slow, the graphics backend is the first suspect.

### `hypot` ate a quarter of my CPU

Profiling the WASM build of the urban stage showed `f64::hypot` at **25–30 % of the time**, in every worker thread.

The cause: wasm32 has no libm, so `hypot` compiles to compiler-builtins' *software* implementation, with a software FMA. Natively it's a few instructions. In WASM it's a slow, careful library routine, called millions of times on 2D distances.

The fix: override the weak `hypot` symbol with `sqrt(x² + y²)`. That's within 1 ulp, and it changes towns very slightly. I'll take it.

### WASM is not automatically faster

Single-threaded WASM on the main thread is often no faster than the old TypeScript. So the rule is: the desktop app uses native Rust, and the web profile uses the Rust WASM build only where it measures faster than the TS it replaces. Otherwise the web keeps the TS.

Profiling gotcha: Chrome DevTools can't CPU-throttle web workers. To simulate a laptop, pin the browser to N cores instead.

### JSON, everywhere, until it wasn't

The town names pack was 7.6 MB of JSON, bundled three times. Stages passed JSON trees to each other. The new rule: products stay resident in native/WASM memory and cross to JS only as binary typed arrays. JSON is for small control messages only.

That rule was written before a 1M town tried to send me 557 MB of JSON. That's #04.

[IMAGE: shader compile timeline before/after, or a profiler screenshot with hypot on top]

---

## Devlog #04 — A town of one million

Today's goal: generate a town of 1,000,000 inhabitants in minutes, not hours, and show it in the browser.

### Where it started

The town chain (quarters → parcels → programme → building sites) is close to linear up to 50k, then grows like N^1.4:

- 10k: 2.3 s
- 100k: 33 s
- 250k: 2 min
- 1M: about **9 minutes** for the first complete run

### Why it was slow

The diagnosis is that the chain is **open-loop**. It sizes the town by land area, generates *everything*, measures the result with the full downstream stages, then corrects by trimming or by generating again.

- The trim loop asks one question: which blocks get no building? To answer it, it runs the programme, the cadastre and the allocation on the **whole town**, 7 to 8 times. At 100k, drawing the plan takes 4 s and those checks take 24 s.
- Every town is over-generated. 20–25 % of its quarters are cut, parcelled and allocated, then handed back to the fields.
- One town is mostly serial. 8 to 16 threads are only 2.2× faster than one.

### What changed (in one day, with several waves of agents)

- **One measuring pass** instead of several. The trim uses a light probe cadastre, and the second trim only runs if the walls actually changed the blocks.
- **Every whole-town pass made local**, with spatial indexes, and run in parallel where items are independent, with **byte-identical output**:
  - vacant-land clean-up: 30 s → 0.03 s at 1M;
  - springs: 27 s → 0.2 s;
  - enclosure fitting: 46 + 55 s → 5 + 5 s;
  - footprint outline: 26 s → 4.7 s.
- **Building sites streamed as typed rows** instead of JSON trees: 125 s → 11.5 s at 1M, with the same bytes.

### The fails

- **Early stop of the trim loop.** It's an obvious win, and I rejected it: on one town it left a dead-end lane. The trim must reach its exact fixed point, so the passes got cheaper instead of fewer.
- **Splitting polygon operations.** Running polygon overlays against a subset of the operands changes the ring representation downstream. It broke towns twice.
- **More threads, slower.** The 1M chain took 294 s with 22 threads and 161 s with 8 pinned threads. I spent a while suspecting my code. It was Windows: a windowless process counts as background work (EcoQoS) and gets sent to efficiency cores at low frequency. The engine now turns that throttling off itself. The 1M chain is **104 s** on all cores.

### Results

Replay suite, 8 threads on performance cores:

- 100k: 32.5 s → 13.5 s
- 250k: 117 s → 33 s
- 1M: about 9 min → 138 s (104 s on all cores)

18 of the 20 test towns are byte-identical to before. The 2 that differ are steep sites I changed on purpose.

### Then the browser said no

The engine could build a 1M town, but no page could receive it. The parcels + programme reply was **557 MB of JSON**. A browser can't hold a string much above 537 MB, so the page just said "Calculation refused". And even under the limit, the parsed objects wouldn't fit in a 4 GB tab.

So the parcels got a binary pack: 536 MB of JSON → 151 MB. Above 60,000 buildings, building detail (roofs, snow, shadows) is only prepared for the visible area.

State tonight: a 1M town generates in under 2 minutes. It draws in the V2 about **6 minutes after the click**. The 3D view still dies.

### Not done

- **Growth by accretion**: open quarters until everyone is housed, then stop. The capacity forecast that should decide when to stop is wrong by 3–4× (83,000 households forecast for 25,000 required at 100k). Stopping on it would cut towns to a third of their size.
- My target was 15–30 s for 1M. I'm at 104–138 s. Not there yet.

[IMAGE: the 1M town, full view + one zoomed district]

---

## Devlog #05 — The satellite view, or: every effect I added and then deleted

Of all the map styles, the satellite view is the one I'm obsessed with. The target is simple to state: a medieval world that looks like Google Earth. No painterly filter, no game-map look.

Getting close to that turned out to be mostly about deleting things.

### What it's made of

It's all one shader stack, shared by 2D and 3D. Ground colour comes from slope, rock, climate zone and soil. On top of that come baked sky occlusion and sun-horizon light on the relief, land use (fields, orchards, terraces), forests drawn as volumetric crowns in the shader, water by regime, and one season calendar per climate zone.

Winter has a single source of truth: land snow drives river ice, lake ice and sea ice. Before that, every water type had its own idea of winter, and you got frozen rivers next to green fields.

### The review loop

To judge changes while other sessions kept editing the same tree, I froze one build per state. A script then shoots the same procedural 12 km region in every climate zone, with targeted views (town, cliff, plain, forest, field, river, coast, summit) at fixed scales and seasons, plus a few 3D shots. A compare script puts before and after side by side. One pass over 12 worlds takes about 14 minutes.

The 13 November review had 15 points on it. Here is what came out of it.

### Rejected

- **Fields.** I made them colourful and varied: stronger colours, deformed grids, waves, crop stripes. My own note on the review: caricatures. We're in a medieval world. The old, quieter fields came back.
- **River effects.** White water, waterfall bars and summer ice on mountain rivers. All of it was removed. What I actually wanted was detail on the banks: a little noise, plants, rocks, and foam only where a torrent hits emergent rocks.
- **Rocks on the ground.** Pebbles everywhere, except maybe in deserts. Removed.
- **Shrubs made of three spheres.** Hideous. Gone.
- **Patterns.** Any noise pattern that you can recognise at some zoom is a bug, all the way down to battlemap scale (about 1 cm per pixel).
- **Shiny roofs.** Strong contrast between roof pans reads as metal. Under snow, ridges should barely show and the snow should lie in patches.
- **Towns from afar** looked like a street plan pasted on a photo. The fix was a dedicated built-up far look for towns in the satellite presets.

The rule I took from it: **an effect that reads as an effect is worse than no effect.** Restore the old look first, then add small variations. And when an effect is doubtful, delete it instead of tuning it.

### The happy accident

At one point I asked for the parchment style to get the same care as the satellite. What came back was the satellite render repainted in paper tones. It was not what I wanted: parchment is a vector map, and its identity is its medium. But it was beautiful.

So it stayed, as its own preset (Satellite-2), and parchment went back to being a vector map.

### What wasn't a shader problem

Mountain rivers sat in uniform canyons, as if drawn with a ruler along a ridge. I tried to fix that in the shader for a while. The cause was upstream: the Rust hydrology incises the terrain at a constant width. You can't shade your way out of wrong geometry.

### The bill

All of this is shader code, and #03 showed what it costs to compile. Every "small effect" is more inlined code for DXC. That's one more reason to delete things.

[IMAGE: same town, satellite before/after the 13 November review; or the Satellite-2 accident next to the parchment]

---

## Devlog #06 — Why I put Neural Earth on the back burner: multi-scale rivers are hell

Magna Urbis has a sibling project, Neural Earth: a whole planet from neural relief, with display levels from about 60 km per pixel down to below one metre. The neural models produce terrain at three resolutions: 7,680 m (coarse), 240 m (latent) and 30 m (decoded).

The terrain was the easy part. The rivers are why Magna Urbis got most of my time.

### Why rivers break at multiple scales

A river is a global object. Its flow depends on everything upstream, possibly thousands of kilometres away. A multi-scale world is lazy: it only computes the tiles you're looking at, in whatever order the camera asks for them. Those two facts don't get along.

- The neural relief doesn't know about drainage. Nothing guarantees a valley where the water wants to go, or a coast where the river mouth is.
- The drainage arrays from an intermediate erosion step can't become the final rivers: the terrain changes after them.
- The polar regions use a rotated neural chart with different noise. The same seed gives different detail on each side of the 60th parallel. The longitude seam isn't periodic either.
- And the result must not depend on the order tiles were requested in, or on what's in the cache.

### The design that came out of it

- **Global authority at the coarse scale.** Drainage, basins and lake levels are decided once, from the final coarse source.
- **Refinement at 240 m with shared "portals".** Where two refined pieces of the same river meet, they read the same frozen crossing point: position, water level, tangent. Neither side may decide it alone.
- **Topology ends at 240 m.** At 30 m there's no new routing, only geometry inside visible corridors. Sub-240 m channels are detail, not newly discovered catchments.
- **One lake, one level, one shore field** across all pieces. A lake is never clipped because a tile ended.
- **Water accounting** that adds up: child catchments sum to the parent, and showing only some regions can't change the discharge at the outlet.

### What the real neural terrain broke

The synthetic test cases all passed. The first real neural case, with 14,456 river reaches, didn't:

- Independently chosen portal levels made one trunk river **climb 33 m uphill**.
- A lake picked an outlet whose receiver flowed back into the same lake: **cycles in the drainage graph**.
- A lake around 595 m raised a different unit whose own river was at about 113 m.
- Per-core masking threw away **308 of 364 wet pixels** in one tile.
- At far zoom, the overview dropped the refined rivers and showed the coarse preview, displaced by up to **12 km**.
- On one real tile, keeping the river wet needed cuts up to **99.9 m** deep. 8 side cells still exceeded the allowed cut and stayed dry, explicitly flagged.

Each of these got fixed. Shared coarse water profiles replaced the local levels, outlets are chosen by topological rank, and absorbers have a bounded level allowance. Performance took work too: network refinement went from 92 s to 21.7 s, and an older package's kernels went from 267.6 s to 22.5 s with bit-identical output.

It works on that case. Lakes aren't rendered yet. River bars, oxbows and distributaries are still on the list. A planet-wide visual campaign has never been run.

### Why Magna Urbis won

Magna Urbis works on one finite region at a time, from 500 m to 200 km, on a single grid. One drainage graph, one water budget, Fill–Spill–Merge for the lakes, invariants for the defects (#02). It's fast, and you can actually check it.

Neural Earth needs every one of those decisions to stay consistent across 18 display levels and two neural charts, whatever the camera does. That's a research project in its own right. I'd rather ship towns that sit on believable rivers than a planet whose rivers are almost right.

Neural Earth isn't dead. It already reuses Magna Urbis's satellite rendering, and the neural relief feeds Magna Urbis regions (#01). But for now, the rivers that matter are the ones that run through a town.

[IMAGE: the Neural Earth 66.9 km river course across LOD levels, or a debug view of portals between tiles]
