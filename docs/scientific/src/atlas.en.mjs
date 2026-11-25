// Atlas of methods, English source. The French edition (atlas.fr.mjs) is a complete translation.
// Tokens in bodies: [[fig:name|caption]] inline diagram, [[wide:name|caption]] full-width diagram,
// [[img:file|alt|caption]] one capture, [[gallery:file|caption;file|caption;…]] a grid of captures.
// Stage cards listed in `stages` are appended from stages.mjs.

export const meta = {
  title: 'How Magna Urbis works · Atlas of methods',
  description: 'How Magna Urbis builds a world, from the height field to the last roof: stages, algorithms, controls, costs and limits.',
  heroTitle: 'From the height field to the last roof.',
  lead: 'Magna Urbis generates landscapes, settlements and towns for maps and tabletop games. This atlas follows a world through every stage the app runs, says what each stage computes, which method it uses, what you can change, and where the result is still an approximation.',
  credit: 'Inspired from the start by Watabou’s Medieval Fantasy City Generator. Neural relief distilled from Alexander Goslin’s Terrain Diffusion.',
  heroCaption: 'One landscape section through the layers the generator builds, in the order it builds them. Original drawing, not to scale.',
  facts: [['47', 'generation and map stages'], ['115', 'architectural cultures'], ['7', 'render styles'], ['11 × 4', 'climate zones × seasons'], ['138 s', 'one town of a million people']],
  partRegion: 'The region', partSettle: 'Places and roads', partTown: 'Towns', partMap: 'The map', partMore: 'Machinery and limits',
  stagesHead: 'Stages in this chapter',
  labels: { what: 'What and why', how: 'Method', io: 'In and out', ctl: 'Controls', cost: 'Runs on', code: 'Code', required: 'Required', optional: 'Can be switched off',
    when: { always: 'Always', procedural: 'Procedural relief', neural: 'Neural relief', heightmap: 'Heightmap', 'after-relief': 'After the relief', 'after-sites': 'After the sites', city: 'Per town', display: 'Display' } },
  filter: 'Filter chapters and stages', filterPh: 'e.g. lake, parcel, snow', filterStatus: '{n} matches',
  railNote: 'Each “?” beside a stage in the app opens its card here.',
};

export const chapters = [
{ id: 'overview', part: 'region', title: 'A recipe, four families, one retained world', kicker: 'How to read the app and this atlas.',
  body: `
<div class="callout"><b>Where it started.</b> Magna Urbis began as an exploration of <a href="https://watabou.itch.io/medieval-fantasy-city-generator">Watabou’s Medieval Fantasy City Generator</a> (Oleg Dolya, source code <a href="https://github.com/watabou/TownGeneratorOS">TownGeneratorOS</a>): a town grown from a market, wards cut by streets, walls and a countryside, drawn as a clean plan. That generator is the first inspiration of this project, and its plain map look lives on as the “Plain (classic)” variant of the cadastre style. Magna Urbis then took the idea down to the terrain, the water and the region, and up to every house.</div>
<p>A Magna Urbis world is described by a <strong>recipe</strong>: the seed, the map size, the relief source and every setting. The same recipe on the same engine gives the same world, which is why a share link or a saved project is enough to rebuild a map.</p>
<p>The app runs the recipe as <strong>stages</strong> grouped in four families. The <em>region</em> builds the ground, its water and its natural cover. <em>Settlements</em> place towns, villages, farms and the roads between them. <em>Cities</em> build one town at a time, from its footprint to its roofs. The <em>map</em> draws all of it in one of seven styles, in 2D or 3D. Each family keeps its products, so changing a setting reruns only the stages downstream of it, and changing the look of the map never reruns generation.</p>
[[wide:families|The four stage families. Each column keeps its products; arrows show what the next family reads.]]
<h3>How the stages are documented</h3>
<p>Every stage in the app has a card in this atlas, under the chapter that explains it. A card says what the stage computes and why, the method actually used in the code, its inputs and outputs, the controls and their visible effect, and where it runs. Optional stages can be switched off in the app; required ones cannot.</p>
<div class="callout"><b>A note on claims.</b> Magna Urbis combines published algorithms with its own heuristics. A plausible river is not a hydrological forecast, a medina plan is not an archaeological reconstruction, and a requested population is a target, not a census. Where a result is an approximation, the chapter says so.</div>
`, stages: [] },

{ id: 'relief', part: 'region', title: 'Relief: three sources, one surface', kicker: 'Procedural landscape evolution, neural diffusion or an imported heightmap.',
  body: `
<p>The relief is a signed height field in metres above sea level, kept at a fixed physical resolution for the whole run. It comes from exactly one of three sources, and all three end in the same shared finishing chain, so everything downstream reads one kind of surface.</p>
[[wide:relief|Three relief sources converge on one retained surface. Procedural stages work on two grids: a coarse regional grid for landscape evolution and a fine surface grid for detail and erosion.]]
<h3>Procedural relief</h3>
<p><a href="#ref-perlin">Perlin (2002)</a> gives the coherent gradient noise this source starts from, and <a href="#ref-phasor">Tricard et al. (2019)</a> the phasor noise used for oriented detail. The procedural source starts from coherent noise, shaped by optional painted zones (plain, hills, mountains, high mountains). Zones are masks that steer the operators; they never set an elevation directly. Seeded volcanoes and calderas add lobed rims, breaches and nested vents.</p>
<p>The incision solver is the implicit stream-power method of <a href="#ref-stream">Braun and Willett (2013)</a>. The heart of the chain is a bounded <strong>landscape evolution</strong> on the regional grid: each cycle applies tectonic uplift, routes water downhill, incises channels with a stream-power law, then relaxes slopes with thermal collapse and diffusion. The result is reconstructed on the fine grid with a domain warp, calibrated to the amplitude of the chosen relief family, given ridged or phasor-noise detail and a last pass of surface erosion. Since November, every surface operator scales with the cell size, so the same recipe gives the same landforms on a 5 km or a 50 km map.</p>
<h3>Where the coast is cut</h3>
<p>The land–sea cut is a stage of its own that can be moved along the chain: right after the initial noise by default, or later, after relaxation, calibration, detail, surface erosion or datum normalisation. Whatever happens after it, the finishing chain reapplies the geographic cut so the chosen coastline survives, then erodes it.</p>
<h3>Imported heightmaps</h3>
<p>An imported or library heightmap is resampled into the frame, scaled vertically, given a datum and cropped. It skips the generative stages but goes through the same finishing.</p>
`, stages: ['relief-source', 'relief-climate', 'relief-mask', 'relief-grids', 'relief-noise', 'relief-coast-cut', 'relief-regional', 'relief-relax', 'relief-reconstruct', 'relief-calibrate', 'relief-detail', 'relief-surface', 'relief-datum', 'relief-phasor', 'relief-heightmap-fit'] },

{ id: 'neural', part: 'region', title: 'Neural relief', kicker: 'A diffusion model conditioned on climate and an optional sketch.',
  body: `
<p>The entry point of the neural relief is <strong>InfiniteDiffusion</strong>, Alexander Goslin’s method, with its <a href="https://github.com/xandergos/terrain-diffusion">Terrain Diffusion</a> models, described in <a href="https://arxiv.org/abs/2512.08309"><em>InfiniteDiffusion: Bridging Learned Fidelity and Procedural Utility for Open-World Terrain Generation</em></a> (arXiv 2512.08309). Its idea is what makes a learned terrain usable in a procedural world: windows generated lazily, consistent with the seed and independent of the visiting order, so the terrain has no edge and no seams. The models Magna Urbis runs are distilled from the Terrain Diffusion models and follow the method of that paper; the distillation and the browser runtime are developed in <a href="https://github.com/dunkean/neural-earth">Neural Earth</a>.</p>
<p>Like Terrain Diffusion, the models use the diffusion formulation of <a href="#ref-edm">Karras et al. (2022</a>, <a href="#ref-edm2">2024)</a>. The neural source samples a three-stage diffusion model trained on real elevation data. A coarse stage at 7.68 km per cell is conditioned on the climate (temperature, precipitation and their variability) and on an optional sketch. A base stage refines it to 240 m, and a decoder brings it to 30 m with an optional amplification that adds a residual on top of the retained spline. Each stage is sampled in global tile coordinates with a halo, so tiles join without seams.</p>
<p>The model runs in three places: in the browser, through Rust compiled to WebAssembly with WebGPU; in a native Rust service on the same machine; or in the optional local Python service with CUDA. <a href="#neural-engines">The next chapter</a> describes the distilled networks and the engines. Only the decoded terrain is exposed; the intermediate stages have no separate preview.</p>
<div class="callout limit"><b>Limit.</b> A learned model reproduces the statistics of its training data. It does not simulate geology, and its output is not a measured place.</div>
`, stages: ['relief-neural-coarse', 'relief-neural-base', 'relief-neural-decoder'] },

{ id: 'neural-engines', part: 'region', title: 'Distillation and the inference engines', kicker: 'How the diffusion chain runs without Python: smaller or shorter networks, a finite window plan, a native engine and a browser engine.',
  body: `
<p>The teacher is Terrain Diffusion as published by <a href="#ref-goslin">Goslin (2025)</a>: the checkpoint <code>xandergos/terrain-diffusion-30m</code>, MIT licence, pinned at revision <code>9ef8030c</code>. As published it runs in Python with PyTorch and CUDA, its base network has about 254 million parameters (1,014.77 MB of weights), and its coarse sampler takes twenty evaluations per window. Magna Urbis adds three constraints: no Python at runtime, a path that runs in a browser tab on WebGPU, and a download a user can accept. The work was done in <a href="https://github.com/dunkean/neural-earth">Neural Earth</a> and ported here. It has three parts: distilled or shortened networks, a plan that computes only the windows one finite map needs, and two inference engines written in Rust.</p>
[[wide:neuralchain|The inference chain. The four stages, their windows and the noise are shared; the native and browser engines differ in their base network, their kernels and their precision.]]
<h3>The teacher chain</h3>
<p>The diffusion formulation is EDM (<a href="#ref-edm">Karras et al., 2022</a>) with the magnitude-preserving networks of EDM2 (<a href="#ref-edm2">Karras et al., 2024</a>). The <strong>coarse</strong> network is an EDM2 U-Net with one level of 128 channels. It reads eleven channels (six noisy outputs and five conditioning fields: height and four climate fields, each mixed with noise at the angle t = atan(noise / signal)) and writes six channels on windows of 64 × 64 cells of 7.68 km, at a stride of 48 cells. It is sampled with the multistep DPM-Solver++ (2M) of <a href="#ref-dpmsolver">Lu et al. (2022)</a> on a Karras schedule from σ = 80 to 0.002 (ρ = 7). The <strong>base</strong> network is an EDM2 U-Net with levels of 192, 384, 576 and 768 channels, three layers per block and attention in the middle block, conditioned by a vector of 58 values computed from the 4 × 4 coarse cells under each window. It writes five channels (four latents and a low-frequency elevation) on windows of 64 × 64 latent cells of 240 m, at a stride of 32, and the teacher samples it in two steps. The <strong>decoder</strong> turns the latents into a 30 m residual on windows of 512 × 512 cells at a stride of 384. Overlapping windows are blended with the upstream linear weight window, and metres are rebuilt by the upstream Laplacian reconstruction: the low-frequency channel plus the decoder residual.</p>
<h3>What is distilled, and how</h3>
<div class="table-wrap"><table><thead><tr><th>Network</th><th>Teacher</th><th>Student used here</th><th>Method</th><th class="num">Weights</th></tr></thead><tbody>
<tr><td>Coarse</td><td>20 solver evaluations, 11.20 MB</td><td>coarse4 (default), also coarse8, coarse2, coarse1</td><td>Same network, shortened differentiable solver trained on the teacher’s final outputs</td><td class="num">11.2 MB each</td></tr>
<tr><td>Decoder</td><td>111.71 MB</td><td>Convolutional student, width 64</td><td>Regression on teacher outputs, same windows and blending</td><td class="num">13.35 MB</td></tr>
<tr><td>Base, browser</td><td>About 254 million parameters, 2 steps, 1,014.77 MB</td><td>B75: same architecture (253,688,037 parameters) and solver</td><td>Trained against the teacher with weight-only NF4 quantisation-aware training</td><td class="num">149.6 MB</td></tr>
<tr><td>Base, native</td><td colspan="3">Not distilled: the original base network, evaluated once per window</td><td class="num">1,014.77 MB</td></tr>
</tbody></table></div>
<p><strong>Coarse: a shorter solver, not a smaller network.</strong> The coarse students start from the teacher network and its weights and shorten its sampler. The twenty-evaluation DPM-Solver++ run becomes a differentiable run of N evaluations, computed in BF16 as in production, and the weights are trained, through every evaluation, so that the short run reproduces the final output of the full one. This is solver distillation, not compression: each coarse file weighs about 11.2 MB, like the original. The bundled checkpoints are exponential moving averages (EMA) of the weights: coarse4 at 50,000 training steps (the default), coarse8 at 25,000, coarse2 and coarse1 at 200,000. The Neural Earth notes state that coarse2 and coarse1 were started from the coarse4 EMA, and that removing steps without retraining is not equivalent.</p>
<p><strong>Decoder: a small student.</strong> The decoder is replaced by a student trained on the teacher’s outputs, knowledge distillation in the sense of <a href="#ref-hinton">Hinton, Vinyals and Dean (2015)</a>. It is a convolutional U-Net with per-pixel normalisation, width 64 and four levels, dilated blocks (1, 2, 4) in the middle, stride-2 downsampling and two FP32 1 × 1 heads: a residual head and a linear bypass of the inputs. It reads the same 512 × 512 windows at stride 384 and keeps the upstream blending, so only the network changes, and it runs in one pass. Training is a BF16 regression; the training script combines a mean squared error with gradient (weight 0.05) and log-spectrum (weight 0.02) terms by default, the spectral term countering the smoothing a pure mean-squared-error student shows. The bundled decoder is the EMA at 200,000 steps.</p>
<p><strong>Training data.</strong> Targets were generated by the teacher: 19,616 training and 384 validation crops, the validation crops drawn from separate worlds, and the seeds 42, 101, 202, 303 and 404 reserved for evaluation.</p>
<p><strong>Base: what failed, and what was kept.</strong> The base is the expensive network. Convolutional one-pass students of width 128 and 192 (13.3 and 30.0 million parameters), trained to regress the blended two-step field directly, ran the base stage five to seven times faster (on a 2048 × 2048 surface, 16.27 s down to 2.22 s on an RTX 4090). Visual review rejected them: they erased river valleys and drew horizontal and vertical lines. The base was then rebuilt from the teacher itself. <strong>B75</strong> keeps the whole architecture (253,688,037 parameters), the 64-cell windows at stride 32, the 58-value conditioning and the two-step solver. It is trained against the teacher with weight-only quantisation-aware training to the 4-bit NormalFloat (NF4) code of <a href="#ref-qlora">Dettmers et al. (2023)</a>, with one FP32 scale per block of 512 coefficients and the output gain kept in FP32. The release is the EMA of training branch B at 75,000 steps. NF4 is a storage format only: weights are decoded to FP16 or FP32 when loaded, so the base computes as much as the teacher; only the download shrinks.</p>
<h3>A finite window plan</h3>
<p>InfiniteDiffusion generates windows on demand for an unbounded world. A Magna Urbis map is a finite square, so the engine works backwards from the delivered 30 m crop and computes only what it depends on: the residual cells the reconstruction reads, with a margin of six latent cells; the decoder windows that cover them; the latent cells those windows read; the base windows that write them; and the coarse cells and windows below. The regional plan puts every map at a fixed origin of the world grid, chosen so that for any extent from 500 m to 200 km all dependencies fall inside one coarse window. A request that would need a second coarse window is refused, not computed partly. For one 40 km map (1,334 cells of 30 m) the plan needs 4 coarse, 64 base and 16 decoder evaluations, against 16, 100 and 25 for the same map at the origin of the validation reference.</p>
<p>The Gaussian noise is the upstream portable generator, a PCG64 stream with Marsaglia’s polar method, reproduced byte for byte in Rust and addressed by window position. A window therefore receives the same noise whichever engine computes it and in whatever order.</p>
<h3>The native engine</h3>
<p>The native crate (<code>rust/crates/neural</code>) runs the chain with <a href="#ref-burn">Burn</a> on wgpu, that is Vulkan, Metal or DX12. Its profile is coarse4 for four steps, the original base in one evaluation per window, and the distilled decoder. Convolutions and activations between layers are FP16; normalisations, embeddings and attention scores are FP32. The production chain ran in BF16; the port runs its convolutions in FP16.</p>
<p>Weights are prepared offline by <code>neural export</code>, which reads the PyTorch zip checkpoints and the safetensors files directly, without Python. Parameters are first rounded to BF16, as production does, then each magnitude-preserving convolution is folded into an ordinary one, normalize(w) · gain / √fan-in, so the runtime only runs plain convolutions. The result is stored as FP16, with FP32 output heads. <code>neural serve</code> keeps the three networks resident on one GPU thread, warms the kernels once at start, and answers on 127.0.0.1:8792 with little-endian FP32 heights. <code>neural compare</code> checks an output against a NumPy reference, over the whole map and over its interior.</p>
<h3>The browser engine</h3>
<p>The first browser build, on 11 October 2026, compiled the same Burn code to WebGPU. It was left unwired: too slow, and incorrect after autotuning. Without autotuning, Burn’s portable WebGPU convolution is a naive direct kernel. Two days later Neural Earth replaced it with a direct WebGPU runtime that Magna Urbis now wraps (<code>rust/crates/neural-wasm</code>). It keeps the noise, plan, pipeline, conditioning and reconstruction modules of the Rust chain, and replaces the network layer with its own WGSL kernels:</p>
<ul>
<li>convolutions as implicit GEMM over NHWC activations whose channels are padded to 16;</li>
<li>activations stored in FP16 when the device offers <code>shader-f16</code>, in FP32 otherwise, with every kernel accumulating in FP32;</li>
<li>a fixed accumulation order, so outputs do not depend on the GEMM tile size;</li>
<li>fused activation, modulation, pixel normalisation, biases, residual sums, clamps and skip concatenations;</li>
<li>work recorded and submitted once per readback, so a whole forward pass is a single queue submission;</li>
<li>base windows batched by 16, and NF4 nibbles decoded once at load time.</li>
</ul>
<p>Its profile is coarse4, the NF4 B75 base in two steps (a first pass from σ = 80, then a second re-noised to σ = 0.35 that reads the blended first pass over the neighbouring windows), and the same distilled decoder. Computed windows go into a bounded cache of about 128 MiB, which Magna Urbis clears between maps because windows depend on the seed and the conditioning.</p>
<p>Weights are downloaded separately from the application. A manifest lists each file with its size and SHA-256, and the three files total 162.27 MB: coarse 5.95 MB, base 149.64 MB, decoder 6.68 MB, the FP16 coarse and decoder being half the size of their FP32 checkpoints. Verified weights are kept in Cache Storage (<code>magna-urbis-neural-models-v1</code>), checked again on reuse, and removed and downloaded again if corrupt. A partial download is never stored. The settings panel lists, downloads and removes models and can ask the browser for persistent storage, which the browser may refuse.</p>
<h3>Precision and validation</h3>
<p>All figures below measure agreement between models or implementations, not error against a real place.</p>
<ul>
<li><strong>Native port.</strong> Against the same chain run fully in FP32 in Python, the Rust port differs by 3.95 m on average. Production BF16 differs from that FP32 reference by 19.8 m, so the port is closer to FP32 than the production chain.</li>
<li><strong>Browser kernels.</strong> The FP32 path of the direct WebGPU runtime matches Burn FP32 to 0.002 m.</li>
<li><strong>Compact base.</strong> On seven reference scenes, with coarse4 and the distilled decoder, B75 differs from the original BF16 base by 24.06 m on average at level of detail 3 and 22.15 m at level 0. The natural variation between the FP32 and BF16 runs of the original is 22.43 m and 21.10 m. The previous NF4 candidate, at 70,000 steps, scored 37.26 m and 36.06 m. Its packed runtime reproduces the quantisation-aware training source exactly on all 174 tensors.</li>
</ul>
<h3>Speed and size</h3>
<ul>
<li><strong>Native.</strong> One 40 km map in about one second on an RTX 3090.</li>
<li><strong>Browser.</strong> Replacing Burn with the direct runtime, Neural Earth measured on Chrome and an RTX 3090: an uncached tile of its viewer at 30 m went from 104 s to 2.0–2.2 s, the first coarse tile from 6.8 s to 0.3 s, and the inference WebAssembly from 67 MB to 0.7 MB. The Magna Urbis build of this runtime compiles to about 1 MB of WebAssembly.</li>
<li><strong>Python catalogue.</strong> The optional CUDA service offers nine bundled weight files, each under 100,000,000 bytes and 99,783,839 bytes in all, so its coarse, base and decoder can be chosen separately.</li>
</ul>
<h3>Three ways to run it</h3>
<p>The V2 offers three neural sources. <em>Browser</em> runs the WebGPU engine and requires WebGPU; there is no CPU fallback. <em>Native</em> calls <code>neural serve</code>. <em>Python</em> calls the CUDA service on port 8793, the only path where checkpoints can be chosen; the browser and native engines use their installed profile. In the desktop app, the page asks the application to start the neural service on demand when it does not answer. The native and browser chains do not use the same base network, so the same recipe gives a different neural terrain on each.</p>
<div class="callout limit"><b>Limits.</b> The compact base saves download size, not computation: once loaded it keeps the teacher’s computation cost, its file size is not its GPU memory, and the student bases that would compute less were rejected. No B75-specific WebGPU speed benchmark or minimum hardware has been measured. Agreement between the browser and the CUDA reference is not certified. B75 still loses fine grain in plains and some coast pixels. The coarse and decoder students were accepted on visual review and proxy measures, not on a measure of erosion forms. An experimental residual base of 18.28 MB exists for the Python service only.</div>
`, stages: [] },

{ id: 'finishing', part: 'region', title: 'Finishing the surface, and the world below it', kicker: 'Shared operators every relief goes through, and the optional underdark layer.',
  body: `
<p>Whatever the source, four operators finish the surface. <strong>Fractal refinement</strong> adds slope-dependent detail below the source cell size, with its own Hurst exponent, lacunarity and octaves. <strong>Fluvial conditioning</strong> breaches or erodes depressions so water can leave the land. <strong>Wind transport</strong> moves material along an azimuth for dunes and loess. <strong>Coastal erosion</strong> shapes the chosen shoreline.</p>
<h3>Underdark</h3>
<p>The underdark is a world layer, not a stage: when chosen, it carves the finished surface once, before hydrology, into a cave world. The relief becomes the rock above; drainage becomes the tunnel network.</p>
[[wide:underdark|The underdark carving in seven steps (rust/crates/terrain/src/underdark.rs). Hydrology then runs on the carved surface.]]
[[img:underdark.webp|Painted satellite view of an underdark map: dark rock walls, pale cavern floors, kept lakes in blue.|An underdark map in the painted satellite style. The rock field is soft, so walls fade rather than step.]]
`, stages: ['relief-refine', 'relief-conditioning', 'relief-aeolian', 'relief-coasts'] },

{ id: 'water', part: 'region', title: 'Water: drainage, lakes, rivers and mouths', kicker: 'A drainage graph and a water budget, then vector rivers.',
  body: `
<p>Drainage relies on the Priority-Flood algorithm of <a href="#ref-flood">Barnes, Lehman and Mulla (2014)</a>. Water is computed once on the finished surface by the Rust vector water chain. It first conditions the relief so that every cell can drain, by breaching passes up to 8 m deep with valley-shaped or stepped banks. A <strong>Priority-Flood</strong> pass then gives every cell a downhill direction and every depression a spill point.</p>
<p>Lakes follow the fill, spill and merge logic of <a href="#ref-fsm">Barnes, Callaghan and Wickert (2021)</a>, fed by the annual water balance of <a href="#ref-turc">Turc (1954)</a>. Depressions are where lakes may form, but only if the climate can feed them. For each closed basin the chain computes a <strong>water budget</strong> from temperature, altitude and precipitation; a basin keeps a lake only where runoff can sustain it and where depth, area and coverage tests pass. The rest are breached or filled. The lake abundance setting moves those thresholds.</p>
[[wide:water|The water chain. The budget formula is a Turc-type evapotranspiration corrected for altitude.]]
<h3>Rivers that behave</h3>
<p>Once lakes are decided, rivers that pass beside a lake are captured into it, and upstream areas are summed again so discharge stays consistent. River heads can extend up the talweg, spurs shorter than 150 m are dropped, and vector rivers receive a width, a bed and meanders.</p>
<p>Mouth widening follows the exponential estuary shape of <a href="#ref-savenije">Savenije (2005)</a>. Mouths are shaped last. A river widens towards the sea or a lake along an exponential profile, as estuaries do, without ever narrowing again, and its water surface ends at sea level without rising seaward. Large rivers on gentle coasts may open into a funnel or tidal estuary.</p>
[[fig:mouth|River mouth in plan. The width at the water depends on discharge and bank slope; two neighbouring mouths never overlap.]]
<div class="callout limit"><b>Limit.</b> The budget is annual and static. There are no floods, no groundwater and no seasonal regime; river ice and snow are drawn by the renderer from the season, not simulated.</div>
`, stages: ['water-hydrology'] },

{ id: 'cover', part: 'region', title: 'Climate and natural cover', kicker: 'Forests, clearings and beaches from climate, relief and water.',
  body: `
<p>The climate entered with the relief (mean temperature, its seasonal spread, precipitation and its variability) is reused for the natural cover. Forest density follows moisture, temperature and slope; banks and beaches have their own rules, and beach width follows the climate. The forest field is a product of the region: settlements clear it, and the map draws it as symbols, painted brushes or a procedural canopy depending on the style.</p>
<p>Seasons do not change the generated world. They are applied at render time from a calendar of eleven climate zones, which sets the herb tint, leaves, snow cover, river and lake ice and sea ice for each point of the year (see <a href="#map">the map chapter</a>).</p>
`, stages: ['cover-climate'] },

{ id: 'settlements', part: 'settle', title: 'Settlements and the countryside', kicker: 'Where places go, how large they are, and what surrounds them.',
  body: `
<p>Places are chosen on the finished region. Every dry cell gets a site score (water, slope, coast, river crossings, defence), and places are picked greedily with a minimum spacing, each one carving an urban reserve. You can ask for a number of places drawn from a size law, or give an explicit list; a listed place that lands in water is moved to the nearest suitable dry site with a warning, so a list is always honoured.</p>
<p>The size rule is <a href="#ref-zipf">Zipf’s rank-size law (1949)</a>. Sizes follow a <strong>rank-size law</strong>: the place of rank r holds the population of the largest divided by r<sup>q</sup>, down to a minimum. The number of ranks follows how many places the usable land can hold.</p>
[[wide:settlements|Left: the rank-size law. Right: what grows around one place.]]
<h3>The countryside</h3>
<p>Farms are placed within the farmland reach of their parent place, with a few isolated ones farther out. Each takes a farm type from its culture, from the Austrian four-sided farm to the Breton longère, the Apulian masseria, the Japanese minka or the southern African kraal, with its own ground plan and massing. Cultivated land follows the population and stays within walking distance of the farmers. Hamlets and villages get a chapel just outside, and wayside shrines mark junctions. Small places are built in the background after a run.</p>
<h3>Remote places</h3>
<p>Rare sites are chosen by situation: summits, crags, cliff ledges, gorges, islets, deep forest or marsh islands. Their access is a cliff stair, rock steps, a causeway, a rope bridge, a tunnel or a track, and an access line that meets a road ends on it rather than leaving a spur.</p>
`, stages: ['settle-sites', 'settle-hierarchy'] },

{ id: 'roads', part: 'settle', title: 'Regional roads', kicker: 'Which places to link, then how a road actually crosses the land.',
  body: `
<p>Roads are built in two steps: decide which places to connect, then find physical paths. The candidate links are a Delaunay graph of the places, reduced to a minimum spanning tree, plus shortcuts where the tree makes a long detour.</p>
<p>Routing follows <a href="#ref-roads">Galin, Peytavie, Maréchal and Guérin (2010)</a>: a least-cost path over the terrain with an extended set of moves. Each link is then routed by a least-cost search over the terrain. A move can go to any of 24 neighbours (the 8 adjacent cells, knight moves and longer (1, 3) moves), and the search state includes the arrival heading, so turns, slopes and river crossings all have a price. The most important trips are routed first. Reusing an existing road is cheaper than building one, and cells right beside a road cost more than the road itself, so routes either share a trunk or keep a clear distance.</p>
[[wide:roads|Regional roads in four steps. Cell geometry is illustrative.]]
<p>All paths are written into <strong>one graph</strong> whose vertices are grid cells pinned to places or map exits. Crossings become junctions, small triangles lose their longest side, and chains of degree-two vertices become links that take the class of the most important trip using them. Surface follows the development level and the culture. Toll houses, ferries, inns and border posts are read from the finished network.</p>
`, stages: ['settle-roads'] },

{ id: 'town-plan', part: 'town', title: 'The town plan', kicker: 'Footprint, macroplan, streets and quarters, then trimming.',
  body: `
<p>A town is built when you select it, one at a time or all together, by the Rust engine. The chain reads the region, the road graph and the culture of the place.</p>
[[wide:town|The town chain. Dashed inputs: claims of neighbouring towns and the culture sheet. Coloured loops: trimming and replanning.]]
<h3>Kind and footprint</h3>
<p>The town's <strong>kind</strong> (from a lone building or a ruin up to a metropolis) follows its population, culture, site and settlement form. Its <strong>footprint</strong> spends a land budget on a bounded raster with an anisotropic arrival field, so towns stretch along valleys, roads and shores. A survey of the terrain picks how much slope the plan may accept before the first layout, so mountain towns climb instead of failing.</p>
<h3>Neighbouring towns</h3>
<p>Towns are generated in a fixed order, largest first. Each town receives the claims of the earlier towns near it, the land they occupy and their edge streets: it keeps off that land, joins those streets, moves its centre if needed and warns when land runs short.</p>
[[wide:neighbours|Left: a later town avoids the land claimed by an earlier one and joins its streets. Right: the optional density gradient between phases.]]
[[img:neighbours.webp|Two towns side by side, one in orange and one in blue, their streets joined at the edge.|Two neighbouring towns generated in order. The second keeps off the first one's land and joins its edge streets.]]
<h3>Macroplan, streets and quarters</h3>
<p>The macroplan is geography first: it keeps regional road corridors, partitions the dry land, places harbours on waterfronts rooted on dry ground, and lays out walls, gates and cultural phases (core, ring, faubourgs).</p>
<p>Street guidance by a direction field comes from <a href="#ref-tensor">Chen, Esch, Wonka, Müller and Zhang (2008)</a>, within the procedural city chain introduced by <a href="#ref-city">Parish and Müller (2001)</a>. Streets are cut recursively inside each quarter, guided by a direction field, and routed locally around obstacles. Quarters are computed in parallel with one random stream each, so the output does not depend on the number of threads. Streets never lie on water: a wet stretch becomes a bridge deck or stops short of the bank.</p>
<p>Fortifications follow the culture: walls with towers, gates, bastions and ditches, palisades or hedges. A wall can extend an older one, castles take knolls, and walled towns are filled up to the wall street. Springs inside a town receive a water building chosen by its culture, and some cultures add informal quarters at the edge.</p>
<h3>Trim</h3>
<p>The first plan is generous. Trimming runs a cheap probe of the cadastre, turns blocks that would stay empty into fields or open land and prunes the lanes that served them, until nothing changes (at most eight passes), then runs a door pass after bridges. Loose bank streets, junction triangles and doubled runs are removed.</p>
`, stages: ['city-composition', 'city-roads', 'city-quarters', 'city-trim'] },

{ id: 'parcels', part: 'town', title: 'Parcels and programme', kicker: 'Who owns which strip of street front, and what each lot is for.',
  body: `
<p>The parcel operators follow <a href="#ref-parcels">Vanegas, Kelly, Weber et al. (2012)</a>. Each block is divided into <strong>parcels</strong> that front a street, with four cutting operators chosen by the culture (strips, perimeter blocks, courts, compounds) and variants for organic towns, camps, ruins and monuments. A parcel must touch an access segment over a real length and contain buildable land; spare cells are merged into occupied neighbours. Parcel ids survive tidying, so edits stick.</p>
<p>The <strong>programme</strong> then assigns uses. Demand comes from the population and the role tables of the culture: landmarks and large programmes reserve whole blocks first, then trades and shops take street lots, then housing, and leftovers become gardens and yards. Household size is culture data, not a constant. No more than 3 % of the plan may turn housing blocks into commons, parks or cemeteries.</p>
[[wide:lot|From parcels to a raised silhouette: cut, assign, preview the occupation, raise it.]]
<p>A large town produces a lot of data. Parcels can be returned as JSON or as a compact binary pack; for a town of a million people the pack weighs 151 MB against 536 MB of JSON.</p>
`, stages: ['city-parcels', 'city-programme'] },

{ id: 'buildings', part: 'town', title: 'Buildings and their forms', kicker: 'The displayed building is the planned silhouette, raised.',
  body: `
<p>Building sites are neutral placement intents, streamed from the engine as typed rows. The occupation preview of each lot (a street body, a rear wing, a court range, a nave, a tower) is raised piece by piece by the <strong>massing</strong> stage: every piece gets its own number of floors, eave height and roof. What you see on the map is therefore the silhouette the plan intended, not a house dropped into a lot.</p>
<p>Floors follow the range of the culture's building tradition. Modern styles add a population ladder: towers appear from about 50,000 inhabitants, Haussmann-style blocks keep five to seven storeys.</p>
<h3>The forms engine</h3>
<p>Detailed houses come from a forms engine that composes labelled masses into a plan (bar, L, T, court, cross or H) with extras such as outshots, porches, bays, turrets, chimneys and dormers, and covers them with composed roofs: valleys, hips, gablets, gambrels and mansards. Singular buildings (temples, mosques, castles, halls, markets, mills, utilities) come from families shared across cultures. A hybrid style sheet can mix cultures facet by facet, for example the streets of one culture with the houses of another.</p>
[[wide:forms|The vocabulary of the forms engine: home plans and roof kinds.]]
<h3 id="architecture-detail">How the 3D view fits a building’s skin</h3>
<p>To change the generated buildings themselves, set <strong>House plans</strong> to <strong>Complex</strong> before regenerating the town. The plan grammar can fit wings and composite roofs when the lot permits. To compare the appearance of one existing building, keep its plan and camera fixed and change the roof display.</p>
<p>To inspect a house, zoom in and choose <strong>Detailed architecture</strong> in the roofs menu. The renderer reads each volume’s footprint, eaves, roof form, openings and material slots. A sill follows the four corners of its window, including on a sloping wall. A Mongolian ger gains a raised timber crown, a felt cover and tension cords. These are additions to the display mesh. The procedural building programme still determines the occupied lot, floor count and roof height.</p>
<p>Texture coordinates (UVs) measure metres on the building. Wall courses follow the footprint perimeter, one sheet of felt spans the ger’s crown, and bark follows the arch of a barrel roof. A three-metre swatch combines the culture’s finish with the colour of the individual building. Some finishes use a sampled image of the material. Light picks out small surface irregularities, while door frames and roof fittings cast a silhouette because they have depth.</p>
<p>The renderer selects a level of detail from the apparent size of a building. Nearby buildings can carry extra geometry. Smaller projections reuse simpler volumes and progressively filtered material images. At town scale, compare footprints, courtyards and roof profiles. At house scale, compare the joints, openings and coverings. These views describe the generated exterior. Room layouts, structural capacity and reconstructions of specific historic buildings require independent evidence.</p>
<h3>A dormer changes the roof profile</h3>
<p>On an eligible dwelling, a gabled dormer can rise from a pitched roof. Its two slopes meet the existing roof along valleys. Some modern and futuristic profiles can receive a glazed upper room set back from the edges of a large flat terrace. In both cases the renderer checks the available roof face, existing upper volumes and courtyard openings before it adds the room. The result changes the visible silhouette. It adds no dwelling or population to the simulation.</p>
<p>The model borrows two architectural ideas with different histories. The dormers of a house dated 1732 at Guenroc admit light to a storage loft. New York’s 1916 height districts allowed a building to rise higher with distance from the street line. The game chooses its own dimensions for both forms. <a href="https://www.patrimoine.bzh/gertrude-diffusion/dossier/IA22015300">Brittany Heritage Inventory, Guenroc</a> · <a href="https://www.nyc.gov/assets/planning/downloads/pdf/zoning/zoning-nyc/1916_zoning_resolution.pdf">New York Building Zone Resolution, Article III</a></p>
<p>The Indian profiles show why the renderer checks individual openings. A projecting Rajput window needs a supporting upper bay. A Tamil thinnai needs a clear approach at ground level. A metropolitan loggia and its screen need room in front of an existing opening. The threshold study and the Kanchanjunga Apartments project in Mumbai document how covered spaces mediate between a dwelling and the street or climate. The game’s dimensions and placement tests belong to its procedural rules. <a href="https://doi.org/10.3390/heritage7120309">Threshold spaces in traditional Indian dwellings</a> · <a href="https://charlescorreafoundation.org/2022/03/13/kanchanjunga/">Charles Correa Foundation, Kanchanjunga Apartments</a></p>
<p>Compare the covered entrance and the roof terrace of <a href="catalogue-architecture.html#architecture-compare">one Dravidian-profile house in both rendering modes</a>. The catalogue also includes town and village views for all 115 cultures.</p>
[[gallery:view-3d-parchment.webp|Al-Andalus town in 3D, parchment style.;view-3d-chinese.webp|Chinese walled town in 3D, satellite style.;view-3d-satellite.webp|Celtic oppidum and its countryside in autumn.]]
`, stages: ['city-buildings', 'city-houses'] },

{ id: 'map', part: 'map', title: 'Drawing the map', kicker: 'Seven styles, one recipe per pass, seasons, and two drawing engines.',
  body: `
<p>The map reads the retained world and never changes it. A <strong>style</strong> is only a preset of a per-pass recipe: ground, relief, vegetation, rural and urban land use, water, roads, buildings, ambience, text and legend each have their own settings, and a customised style is marked with an asterisk.</p>
[[gallery:style-parchment.webp|Parchment, the default view, adapted to the biome.;style-satellite.webp|Satellite, material ground and procedural canopy.;style-painted.webp|Painted satellite.;style-topographic.webp|Topographic, contours and footprints.;style-cadastre.webp|Cadastre, footprints and land use in category colours.;style-atlas.webp|Atlas.;style-night.webp|Night ambience on parchment.;season-snow.webp|Winter on the satellite style.]]
<h3>Seasons</h3>
<p>Each of eleven climate zones (temperate, Mediterranean, continental, Nordic, alpine, Arctic, steppe, desert, savanna, tropical, wetland) has a calendar of four seasonal rows: herb tint, leaves, snow, thaw and sea ice. The palette of every vector style follows it, the shaders read the same calendar, and you can edit the year of a zone. Snow is a continuous cover shaped by relief, rivers and lakes freeze only where the ground does, and sea ice has leads, floes and slush. On parchment, seasons change the land use only.</p>
<h3>Two engines</h3>
[[wide:render|From the retained world to pixels. Exports reuse the displayed map.]]
<p>The GPU vector engine applies the stencil-then-cover path rendering of <a href="#ref-kilgard">Kilgard and Bolz (2012)</a>. The ground is drawn by a WebGL2 or WebGPU terrain renderer. Everything vector (water, roads, parcels, buildings, symbols, text) goes through one drawing interface with two back ends: a Canvas 2D engine on the CPU, and a GPU engine that records the drawing calls once into a display list and replays it every frame with the view matrix, using stencil-then-cover fills, extruded strokes and instanced sprites. A band around the view is recorded at each half octave of zoom, so panning and zooming need no new tiles. The GPU engine falls back to the CPU on software GL, a lost context or slow frames.</p>
<p>The 3D view uses WebGPU, with WebGL2 as fallback, and drapes the 2D map on the relief, raises building volumes by sector, and can add trees within 360 m of the camera, which follow the season. You can orbit, walk or fly.</p>
`, stages: ['display-terrain', 'display-relief', 'display-vegetation', 'display-landuse', 'display-water', 'display-roads', 'display-buildings', 'display-ambience'] },

{ id: 'names', part: 'map', title: 'Names, legend and exports', kicker: 'Text is a full layer of the composition.',
  body: `
<p>Place names come from cultural naming grammars, one per culture, with an importance that decides which names survive at each zoom. Text is a layer of its own, in 2D and 3D: toponyms, district and role labels have their own density, size and style, and the legend and cartouche are a separate pass.</p>
<p>Exports reuse what is on screen: PNG and SVG of the displayed map with its names, the heightmap, the project and the recipe. A battlemap mode frames the 3D view for tabletop play and can export mosaics.</p>
`, stages: ['display-text', 'display-labels', 'map-naming', 'map-export'] },

{ id: 'runtime', part: 'more', title: 'Where it runs', kicker: 'The browser, a native engine on the same machine, and an optional neural service.',
  body: `
<p>The interface and the drawing run on the main thread. Generation runs in a worker that queues requests and keeps the world; rendering, composition, export, occupation and road routing have their own workers. The computation itself is Rust, compiled two ways.</p>
[[wide:runtime|Who computes what. Every native service listens on the loopback interface only.]]
<ul>
<li><strong>WebAssembly</strong>, in the browser: multi-threaded when the page is cross-origin isolated, otherwise single-threaded or as a pool of single-threaded workers.</li>
<li><strong>The native engine</strong>, <code>magna-urbis-local</code> on port 8791: relief, water, coast, land use, forest, site choice, roads and towns, with one session per town lane and binary replies. The desktop app starts it automatically on a free port.</li>
<li><strong>The neural service</strong>, optional, in Python with CUDA on port 8793. The neural relief also runs in the browser with WebGPU.</li>
</ul>
<h3>How fast</h3>
<p>Measured on 14 November 2026 with eight threads, after the town performance round:</p>
<div class="table-wrap"><table><thead><tr><th>Town</th><th class="num">Before</th><th class="num">After</th></tr></thead><tbody>
<tr><td>Medieval organic, 10,000 people, real map</td><td class="num">3.8 s</td><td class="num">2.7 s</td></tr>
<tr><td>Medieval organic, 50,000 people, real map</td><td class="num">20.6 s</td><td class="num">10.1 s</td></tr>
<tr><td>Medieval organic, 100,000 people</td><td class="num">32.5 s</td><td class="num">13.5 s</td></tr>
<tr><td>Medieval organic, 250,000 people</td><td class="num">117 s</td><td class="num">32.8 s</td></tr>
<tr><td>Medieval organic, 1,000,000 people</td><td class="num">about 9 min</td><td class="num">138 s</td></tr>
<tr><td>Halfling, 10,000 people, mountain flank</td><td class="num">25.5 s</td><td class="num">10.9 s</td></tr>
</tbody></table></div>
[[img:megacity-1m.webp|Plan of a medieval organic town of one million inhabitants, a dense brown disc of streets around a river.|A town of one million inhabitants, generated by the native engine in 138 seconds.]]
<p>Timings vary a lot with load and cores: the same 50,000-people town ranged from 9.5 to 85 s across runs. Streets and quarters take about 80 % of the time.</p>
`, stages: [] },

{ id: 'limits', part: 'more', title: 'Open limits and what comes next', kicker: 'What the generator does not do yet.',
  body: `
<ul>
<li><strong>Towns do not grow.</strong> A town is planned at its final size. Growth by accretion, where a larger town keeps the plan of its smaller self, is designed but not built; only a chronology hook exists.</li>
<li><strong>A million is a ceiling for the pages.</strong> The engine generates a town of a million people, but neither page can receive it yet; districts on demand are not implemented.</li>
<li><strong>Water is annual.</strong> No floods, groundwater or seasonal flow; winter is drawn, not simulated.</li>
<li><strong>Cultures are data, not history.</strong> A culture sheet is an artistic synthesis from sources and references; it is not a reconstruction of a real town.</li>
<li><strong>The backend is part of the recipe.</strong> CPU and GPU paths are not promised bit-identical; the same recipe on another engine may differ in detail.</li>
</ul>
`, stages: [] },

{ id: 'glossary', part: 'more', title: 'Glossary', kicker: 'Each term with one meaning in this atlas.',
  body: `
<dl class="glossary">
<dt>Recipe</dt><dd>Seed, size, sources and every setting of a world. Rebuilds it on the same engine.</dd>
<dt>Retained product</dt><dd>A stage output kept in memory and reused by later stages and views until a setting upstream changes.</dd>
<dt>Priority-Flood</dt><dd>An algorithm that gives every cell of a height field a drainage order and every depression a spill point.</dd>
<dt>Water budget</dt><dd>Annual precipitation minus evapotranspiration over a basin; decides whether a lake can be kept.</dd>
<dt>Talweg</dt><dd>The line joining the lowest points of a valley.</dd>
<dt>Rank-size law</dt><dd>Place r has the population of the largest divided by r<sup>q</sup>.</dd>
<dt>Footprint</dt><dd>The land given to a town, distinct from its streets and buildings.</dd>
<dt>Macroplan</dt><dd>The geographic frame of a town: corridors, harbours, walls, phases.</dd>
<dt>Block, parcel</dt><dd>Land enclosed by streets; a property in it that fronts a street.</dd>
<dt>Programme</dt><dd>The uses demanded by the population and their allocation to parcels.</dd>
<dt>Massing</dt><dd>Raising each planned piece of a building into a volume with floors, eaves and a roof.</dd>
<dt>Culture sheet</dt><dd>The data describing one architectural culture: streets, plots, houses, monuments, countryside.</dd>
<dt>Style sheet</dt><dd>A hybrid mix of cultures, weighted facet by facet.</dd>
<dt>Teacher, student</dt><dd>In distillation, the original network and the smaller or shorter network trained to reproduce its outputs.</dd>
<dt>NF4</dt><dd>A 4-bit code for storing network weights; the weights are decoded before computing.</dd>
<dt>Display list</dt><dd>Recorded drawing calls that the GPU replays every frame.</dd>
</dl>
`, stages: [] },

{ id: 'references', part: 'more', title: 'References', kicker: 'Sources and influences. The local contribution is stated for each.',
  body: `[[refs]]
<ol class="bibliography" start="18"><li id="ref-savenije"><a href="https://doi.org/10.1016/B978-0-444-52107-1.X5000-X">Savenije, H. H. G. (2005). <em>Salinity and Tides in Alluvial Estuaries.</em></a> Elsevier.<p>Exponential widening of alluvial estuaries; the shape of river mouths is inspired by it, without tidal simulation.</p></li>
<li id="ref-turc">Turc, L. (1954). <em>Le bilan d’eau des sols : relations entre les précipitations, l’évaporation et l’écoulement.</em> Annales agronomiques 5, 491–596.<p>Annual evapotranspiration from precipitation and temperature; used as written for the lake water budget, with an altitude correction of the temperature.</p></li>
<li id="ref-zipf">Zipf, G. K. (1949). <em>Human Behavior and the Principle of Least Effort.</em> Addison-Wesley.<p>Rank-size rule of city populations; the exponent is a setting, not a fit to real data.</p></li>
<li id="ref-phasor"><a href="https://doi.org/10.1145/3306346.3322990">Tricard, T., Efremov, S., Zanni, C., Neyret, F., Martínez, J. &amp; Lefebvre, S. (2019). <em>Procedural Phasor Noise.</em></a> ACM Transactions on Graphics 38(4), 57.<p>Oriented, contrast-stable noise; adapted for the phasor detail stage of the procedural relief.</p></li>
<li id="ref-kilgard"><a href="https://doi.org/10.1145/2366145.2366191">Kilgard, M. J. &amp; Bolz, J. (2012). <em>GPU-accelerated Path Rendering.</em></a> ACM Transactions on Graphics 31(6), 172.<p>Stencil-then-cover filling of vector paths; reimplemented on WebGL2 in the GPU vector engine.</p></li></ol>`, stages: [] },
];
