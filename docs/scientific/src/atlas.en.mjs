// Atlas of methods, English source. The French edition (atlas.fr.mjs) is a complete translation.
// Tokens in bodies: [[fig:name|caption]] inline diagram, [[wide:name|caption]] full-width diagram,
// [[img:file|alt|caption]] one capture, [[gallery:file|caption;file|caption;…]] a grid of captures.
// Stage cards listed in `stages` are appended from stages.mjs.

export const meta = {
  title: 'How Magna Urbis works · Atlas of methods',
  description: 'How Magna Urbis builds a world, from the height field to the last roof: stages, algorithms, controls, costs and limits.',
  heroTitle: 'From the height field to the last roof.',
  lead: 'Magna Urbis generates landscapes, settlements and towns for maps and tabletop games. This atlas follows a world through every stage the app runs, says what each stage computes, which method it uses, what you can change, and where the result is still an approximation.',
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
<p>The procedural source starts from coherent noise, shaped by optional painted zones (plain, hills, mountains, high mountains). Zones are masks that steer the operators; they never set an elevation directly. Seeded volcanoes and calderas add lobed rims, breaches and nested vents.</p>
<p>The heart of the chain is a bounded <strong>landscape evolution</strong> on the regional grid: each cycle applies tectonic uplift, routes water downhill, incises channels with a stream-power law, then relaxes slopes with thermal collapse and diffusion. The result is reconstructed on the fine grid with a domain warp, calibrated to the amplitude of the chosen relief family, given ridged or phasor-noise detail and a last pass of surface erosion. Since November, every surface operator scales with the cell size, so the same recipe gives the same landforms on a 5 km or a 50 km map.</p>
<h3>Where the coast is cut</h3>
<p>The land–sea cut is a stage of its own that can be moved along the chain: right after the initial noise by default, or later, after relaxation, calibration, detail, surface erosion or datum normalisation. Whatever happens after it, the finishing chain reapplies the geographic cut so the chosen coastline survives, then erodes it.</p>
<h3>Imported heightmaps</h3>
<p>An imported or library heightmap is resampled into the frame, scaled vertically, given a datum and cropped. It skips the generative stages but goes through the same finishing.</p>
`, stages: ['relief-source', 'relief-climate', 'relief-mask', 'relief-grids', 'relief-noise', 'relief-coast-cut', 'relief-regional', 'relief-relax', 'relief-reconstruct', 'relief-calibrate', 'relief-detail', 'relief-surface', 'relief-datum', 'relief-phasor', 'relief-heightmap-fit'] },

{ id: 'neural', part: 'region', title: 'Neural relief', kicker: 'A diffusion model conditioned on climate and an optional sketch.',
  body: `
<p>The neural source samples a three-stage diffusion model trained on real elevation data. A coarse stage at 7.68 km per cell is conditioned on the climate (temperature, precipitation and their variability) and on an optional sketch. A base stage refines it to 240 m, and a decoder brings it to 30 m with an optional amplification that adds a residual on top of the retained spline. Each stage is sampled in global tile coordinates with a halo, so tiles join without seams.</p>
<p>The model runs in the browser through Rust compiled to WebAssembly with WebGPU, or in the optional local Python service with CUDA. Only the decoded terrain is exposed; the intermediate stages have no separate preview.</p>
<div class="callout limit"><b>Limit.</b> A learned model reproduces the statistics of its training data. It does not simulate geology, and its output is not a measured place.</div>
`, stages: ['relief-neural-coarse', 'relief-neural-base', 'relief-neural-decoder'] },

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
<p>Water is computed once on the finished surface by the Rust vector water chain. It first conditions the relief so that every cell can drain, by breaching passes up to 8 m deep with valley-shaped or stepped banks. A <strong>Priority-Flood</strong> pass then gives every cell a downhill direction and every depression a spill point.</p>
<p>Depressions are where lakes may form, but only if the climate can feed them. For each closed basin the chain computes a <strong>water budget</strong> from temperature, altitude and precipitation; a basin keeps a lake only where runoff can sustain it and where depth, area and coverage tests pass. The rest are breached or filled. The lake abundance setting moves those thresholds.</p>
[[wide:water|The water chain. The budget formula is a Turc-type evapotranspiration corrected for altitude.]]
<h3>Rivers that behave</h3>
<p>Once lakes are decided, rivers that pass beside a lake are captured into it, and upstream areas are summed again so discharge stays consistent. River heads can extend up the talweg, spurs shorter than 150 m are dropped, and vector rivers receive a width, a bed and meanders.</p>
<p>Mouths are shaped last. A river widens towards the sea or a lake along an exponential profile, as estuaries do, without ever narrowing again, and its water surface ends at sea level without rising seaward. Large rivers on gentle coasts may open into a funnel or tidal estuary.</p>
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
<p>Sizes follow a <strong>rank-size law</strong>: the place of rank r holds the population of the largest divided by r<sup>q</sup>, down to a minimum. The number of ranks follows how many places the usable land can hold.</p>
[[wide:settlements|Left: the rank-size law. Right: what grows around one place.]]
<h3>The countryside</h3>
<p>Farms are placed within the farmland reach of their parent place, with a few isolated ones farther out. Each takes a farm type from its culture, from the Austrian four-sided farm to the Breton longère, the Apulian masseria, the Japanese minka or the southern African kraal, with its own ground plan and massing. Cultivated land follows the population and stays within walking distance of the farmers. Hamlets and villages get a chapel just outside, and wayside shrines mark junctions. Small places are built in the background after a run.</p>
<h3>Remote places</h3>
<p>Rare sites are chosen by situation: summits, crags, cliff ledges, gorges, islets, deep forest or marsh islands. Their access is a cliff stair, rock steps, a causeway, a rope bridge, a tunnel or a track, and an access line that meets a road ends on it rather than leaving a spur.</p>
`, stages: ['settle-sites', 'settle-hierarchy'] },

{ id: 'roads', part: 'settle', title: 'Regional roads', kicker: 'Which places to link, then how a road actually crosses the land.',
  body: `
<p>Roads are built in two steps: decide which places to connect, then find physical paths. The candidate links are a Delaunay graph of the places, reduced to a minimum spanning tree, plus shortcuts where the tree makes a long detour.</p>
<p>Each link is then routed by a least-cost search over the terrain. A move can go to any of 24 neighbours (the 8 adjacent cells, knight moves and longer (1, 3) moves), and the search state includes the arrival heading, so turns, slopes and river crossings all have a price. The most important trips are routed first. Reusing an existing road is cheaper than building one, and cells right beside a road cost more than the road itself, so routes either share a trunk or keep a clear distance.</p>
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
<p>The macroplan is geography first: it keeps regional road corridors, partitions the dry land, places harbours on waterfronts rooted on dry ground, and lays out walls, gates and cultural phases (core, ring, faubourgs). Streets are cut recursively inside each quarter, guided by a direction field, and routed locally around obstacles. Quarters are computed in parallel with one random stream each, so the output does not depend on the number of threads. Streets never lie on water: a wet stretch becomes a bridge deck or stops short of the bank.</p>
<p>Fortifications follow the culture: walls with towers, gates, bastions and ditches, palisades or hedges. A wall can extend an older one, castles take knolls, and walled towns are filled up to the wall street. Springs inside a town receive a water building chosen by its culture, and some cultures add informal quarters at the edge.</p>
<h3>Trim</h3>
<p>The first plan is generous. Trimming runs a cheap probe of the cadastre, turns blocks that would stay empty into fields or open land and prunes the lanes that served them, until nothing changes (at most eight passes), then runs a door pass after bridges. Loose bank streets, junction triangles and doubled runs are removed.</p>
`, stages: ['city-composition', 'city-roads', 'city-quarters', 'city-trim'] },

{ id: 'parcels', part: 'town', title: 'Parcels and programme', kicker: 'Who owns which strip of street front, and what each lot is for.',
  body: `
<p>Each block is divided into <strong>parcels</strong> that front a street, with four cutting operators chosen by the culture (strips, perimeter blocks, courts, compounds) and variants for organic towns, camps, ruins and monuments. A parcel must touch an access segment over a real length and contain buildable land; spare cells are merged into occupied neighbours. Parcel ids survive tidying, so edits stick.</p>
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
<p>The <a href="catalogue-architecture.html">architectural styles catalogue</a> shows what every one of the 115 cultures produces.</p>
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
<p>The ground is drawn by a WebGL2 or WebGPU terrain renderer. Everything vector (water, roads, parcels, buildings, symbols, text) goes through one drawing interface with two back ends: a Canvas 2D engine on the CPU, and a GPU engine that records the drawing calls once into a display list and replays it every frame with the view matrix, using stencil-then-cover fills, extruded strokes and instanced sprites. A band around the view is recorded at each half octave of zoom, so panning and zooming need no new tiles. The GPU engine falls back to the CPU on software GL, a lost context or slow frames.</p>
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
<dt>Display list</dt><dd>Recorded drawing calls that the GPU replays every frame.</dd>
</dl>
`, stages: [] },

{ id: 'references', part: 'more', title: 'References', kicker: 'Sources and influences. The local contribution is stated for each.',
  body: `[[refs]]
<ol class="bibliography" start="18"><li id="ref-savenije"><a href="https://doi.org/10.1016/B978-0-444-52107-1.X5000-X">Savenije, H. H. G. (2005). <em>Salinity and Tides in Alluvial Estuaries.</em></a> Elsevier.<p>Exponential widening of alluvial estuaries; the shape of river mouths is inspired by it, without tidal simulation.</p></li></ol>`, stages: [] },
];
