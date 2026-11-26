## Alpha 0.3.11

- Town streets render again on WebGL2 devices that enforce reserved shader names.
- The live map keeps its cartographic overlay when town buildings first appear.
- Selecting a map feature keeps its outline aligned as you move or tilt the camera and lets the page rest when the view is still.
- House and parcel inspectors reopen faster after an edit.
- City share codes carry drawn outlines and splits, custom names, pin text, and road and wall edits. Maps with nested edits preserve the contour precision needed to find the same lots and buildings when reopened.
- Local building, parcel and block edits on saved landscapes reuse the ground already drawn in the top and tilted views.
- Changing the Parchment map date reuses the summer relief, grass and reed marks, and overlay tiles whose colours stay the same.
- Switching map colours reuses overlay geometry, and Parchment reuses grass and reed drawings when zooming. Fast looks render at a lower resolution and skip a second quality pass when the map stops moving.

- Low riverbank shrubs rise from their painted crowns in tilted satellite views. Dense conifer stands retain distant silhouettes across the field of view, and tree crowns follow local snow conditions in every climate. Modelled foliage takes its colour from the matching crown in the current map style.
- Close satellite views reveal gravel bars, scoured bends and shallow side channels in dry riverbeds. Low water tapers through tributary junctions and opens into lakes across exposed shores.
- Dry clay flats have broken fissures and curled plate edges. Salt flats show patches of pale mineral crust with raised seams.

- Broadleaf crowns catch the light on irregular facets, and firs have a flat skirt of lower branches. Changing the display biome refreshes the visible forest first and clears old trees from other views.
- Steppe rivers keep their water through winter. Mediterranean streams recede in the dry summer and refill in the rainy season. In satellite views, snow covers exposed riverbeds and lake shores along with the surrounding ground.

- In satellite views, woodland canopies cover regional roads branch by branch. Town streets show compacted earth, wheel ruts, worn pedestrian strips and stony margins.
- Satellite roads and footpaths have broken, soil-coloured verges and a continuous worn centre. Earth darkens on low banks and takes on a stonier colour on steep slopes. Town lanes blend into adjoining streets at junctions.
- Overhead forests keep their rounded painted crowns. Tilting reveals whole foreground stands, including dense tropical woods, while preserving the forest floor and trees along riverbanks.
- Satellite rivers grade from jade, glacial blue and tannin brown to iron-red silt across different climates and reaches. At flowing mouths, fresh water starts mixing at the shoreline and drifts across a wider, irregular patch of sea. Frozen lakes show more fine fractures between plates, with snow obscuring parts of each seam. Frozen rivers show subtler cracks at channel scale.
- In satellite view, submerged gravel and silt show through on the inside of river bends. Deeper runs follow the opposite bank, with clearer water revealing more of the bed. Lake margins now reveal gravel and silt through shallow water, especially along gently sloping shores.
- Satellite maps without lakes skip the lake textures and shoreline sampling. Inland and open-sea terrain load without computing a coastline distance field.
- Savanna washes and desert wadis narrow and widen gently around a darker thread of damp sediment. Residual pools linger in wider, flatter savanna reaches as the water recedes. Bank margins and seasonally exposed lake shores vary in width.
- Winter trees show grey-brown branches at map scale and in 3D. Nearby modelled trees replace their painted crowns, and savanna crowns have individually oriented grain.

- The Buildings menu offers five detail levels: low, medium, high, high* and extra.
- Turning off Follow the environment restores the full culture catalogue immediately, including on the first use after startup.
- Culture pickers group mages, gnomes, Duergar and other fantasy peoples under Fantasy, with corrected historical categories.
- Mushrooms, stalactites and stalagmites stay inside the map boundary in the 3D Underdark view.
- Stilt towns reuse boardwalks that connect both riverbanks when planning bridges and their approach roads.
- Giant homes use 3.5× human dimensions for their floor plans, storey height and doorways.
- At night, camps have no street lamps: lit tent doors, glowing yurt crowns and fires among the tents light them. Towns are lit by their houses: more lit doors and windows, light spilling before them and from courtyards. Street lamps shrink to small, sparse spots.
- Gnomish canal towns dig canals only from real water (river, lake, sea or a stream within reach) and none otherwise. Their canals form one network: a few openings joined by through canals, regular branches into every quarter along streets and narrow lanes, locks on slopes, and a basin at each branch end.

- Kraal thorn enclosures now stand in 3D with open entrances. Detailed architecture adds woven fences, split boards, pasture rails, hedge crowns, pointed palisades and regional masonry to yards and town defences.

- In Detailed architecture, country workshops show their work at the door, from potters’ wheels and drying jars to millstones, winding gear and dressed stone. Farmyards, rural shrines and trade buildings use local materials and fittings. Mine headframes, quarry cranes and other yard works follow their generated footprints.

- Coastal plains and archipelagos keep their sea during browser terrain generation, so rivers drain to the shore instead of crossing the seabed in long diagonals.
- Azgaar FMG matches OpenStreetMap in the top bar, with both import buttons grouped on small screens.
- Detailed architecture extends to isolated dwellings, farm outbuildings and rural sites. Barns and mills gain regional loading bays and louvred openings, and dovecotes gain flight holes and landing ledges.
- Detailed castles and watchtowers gain fitted gates, narrow openings and regional crowns, including timber galleries on roofed medieval keeps. Shrines and civic halls gain regional entrances and cornices. Carved roadside markers and memorial columns gain stepped mouldings.

- River highlights and shallows follow the channel across map tiles. Zooming in on the tilted map keeps banks sharp even on a coarse elevation grid.
- Natural rivers show soft shallows, short glints across mountain riffles, and tea-brown wetland water. Dry channels have subtle silt and gravel tones, and low water follows the outside of bends.
- On Satellite maps the ground around a house blends into the surrounding town earth.
- Leafless trees keep their forked branches at every 3D detail level. On tilted Satellite maps, distant crowns look rounder from above and stay solid as the view zooms out.
- Wild Underdark mushrooms have off-centre caps with growth rings, curled pale rims and fine gills. Their plum, bronze and verdigris caps carry a soft glow under the rim.
- Small gorse clumps appear on heathland at close zoom.

- Overhead Satellite and Parchment maps separate roofs from the ground with clearer roof slopes and quieter textures at street scale. The effect fades as the map tilts.

- Use OpenStreetMap next to Export in the top bar to bring in a real city or region. Search by name or coordinates, preview the AWS elevation, and generate a map with OpenStreetMap data. A progress bar follows the parallel downloads, map preparation and drawing. Imports keep your current display style.
- Use Download app in the top bar to open the desktop releases. The Links dialog groups the atlas, project links and build information.
- Real-place imports request leaner OpenStreetMap data, distinguish server wait from download progress, and suggest a smaller square for large search results.
- Import streets without OpenStreetMap building footprints and let Magna Urbis generate parcels and buildings along the surveyed streets in the selected culture.
- OpenStreetMap imports switch servers sooner when the first server sends no data, prefer the last successful server, and reuse small recent downloads for the same area in the current session.
- Failed real-place downloads show a warning naming OpenStreetMap or AWS elevation, with a Retry button and expandable technical details.
- Azgaar FMG replaces Share in the top bar and gives burg imports their own dialog with a copyable export script and instructions. Manage pins from the map toolbar.
- Detailed architecture varies porch roofs, supports and entrance layouts from house to house within each culture. The same generated home keeps its porch when revisited.
- Detailed architecture adds culture-specific entrances and silhouettes across the full catalogue, with regional verandas, snow passages, cliff-like giant portals, Drow silk canopies and Duergar forge vents.
- In Detailed architecture, mage districts feature fewer tall towers, futuristic houses gain distinct roof structures, and mushroom settlements and underground farms grow layered caps and cultivated beds.
- Detailed porches, landings and surrounds fit the generated openings, including off-centre doors, raised thresholds and Venetian and Byzantine windows.
- Choose extra in the Buildings menu for fitted doors and windows, raised roof edges and culture-specific materials that follow curved roofs and wrap around corners.
- In Detailed architecture, gers have open timber smoke crowns, Iroquoian longhouses have vented bark roofs, and elven and tidal homes have accessible galleries and landings.
- Detailed Indian homes have region-specific verandas, projecting bays and terrace rooms. Clay, stone and lime roofs follow the material and roof slope. Selected European homes gain gabled dormers, and contemporary and futuristic homes can have a recessed rooftop storey.
- Town walls are continuous closed rings: only land, harbour and water gates interrupt them, and they stand on dry ground back from shores and banks. Wide rivers give each bank its own wall; narrow channels get a water gate.
- Harbours lie outside the wall by default, reached through harbour gates; choosing “inside” keeps the quays within it. Moats stop short of rivers and the sea.
- Stairs appear only on really steep stretches, as straight flights in towns or winding flights in mountain cultures; other sloping links stay lanes. Crowded or sharp bridge ends gain a short straight approach.
- Pueblo town outlines no longer follow the survey grid through houses.
- Islands, islets and small coasts rise on natural slopes scaled to their size, with limited local cliffs. Peninsulas come in ten seeded families, and rocky coastlines are finely indented while sandy ones stay smooth.
- River valleys are asymmetric and irregular, with cut banks, slip-off slopes and terraces; medium and large rivers have narrower beds.
- Rivers or lakes set to 0 are now really absent, including in the Underdark.
- Underdark: a cavern share setting, great halls with very high ceilings, narrow side tunnels, dead ends and sealed chambers.
- Rivers, lakes and their beds share one colour by biome and season, rivers and dry beds no longer run under the sea, Mediterranean rivers keep more summer water, and low water wanders and braids inside its bed.
- Moat water has one colour in 2D and 3D and stands higher; dry moats follow climate and season.
- Softer Satellite transitions between ground types and along rivers.
- Season changes in the drawn maps no longer rebuild the map. Parchment trees match the biome and season: turned foliage in autumn, bare trees in winter, snow on land and trees.
- Alpine forests climb to an irregular tree line; oversized pines are gone and deciduous trees are bare in winter, in 2D and 3D.
- Tilted views reuse 3D trees when relief exaggeration changes and refresh affected trees when town ground is reshaped.
- Ground lines on maps are continuous instead of dashed. Cadastre houses are drawn at a higher definition.
- The 3D button tilts the current map. Links that used `?camera=dual` now open the standard map.
- Tilted map: hillside lots are levelled, moats are dug and houses no longer float; fences stay visible further and thin out smoothly; farms stay visible further; map names fade out; trees clear at once from a rebuilt town.
- Satellite banks carry reeds, sedge, dry grass and tamarisk by climate.
- Flat roofs show their parapet edges in V1 roofs.
- Selection tool in the map toolbar, in every view, with one sheet for any selected entity.
- Cursor coordinates and altitude stay visible in tilted views; pins work there too.
- Settlement sizes follow a continuous distribution before places become villages, towns or cities; automatic villages are no longer capped at 999.
- Shorter share codes: the dice steps to the next seed, quarter and block edits are shared, imported relief is flagged. Fixed lake coverage, landform scale and forest density in share codes.
- Heightmaps export as 16-bit PNG.
- Slow laptop GPUs are no longer reported as unavailable: the page waits for a busy GPU, and a generation names the real cause when its GPU shaders fail.
- Share a map with a short code: a 6-character seed followed only by what differs from the default city (size, biome, relief, coast, terrain engine, parameters, rerolls, simple place edits and pins). The default city is just its seed. The current code is always shown in the top bar with copy buttons; MU3 codes no longer open.
- Sliders snap to the steps the short code stores, so a shared map shows exactly the values you set.
- Seeds are 6 characters (digits and letters); the dice draws a new one and any typed seed becomes a valid one. The default map now starts from the seed “magnas”.
- Drop numbered pins on the map with “Drop pin” in the map toolbar; the Share dialog lists them, gives each an optional text and centres the map on a pin. Pin positions travel in the short code, with custom added or moved settlements; texts stay in the project.
- Copy a map for debugging as plain text (code, build and pin texts); pasting it opens the map with its pins. Export renamed places and edited labels as a names JSON file.
- Add a settlement of your choice from the Settlements page: choose its population and culture, then click on the map to place it. The other places and their towns stay as they are; the new place is joined to the nearest road and only its town is generated. Remove it from its settlement inspector.
- Settlements added or moved by hand stay in place when the settlement counts, population or density change: the automatic places are drawn around them. A new placement asks whether to keep them.
- Change the biome of a generated map without regenerating it: the climate tiles repaint the kept relief, water, land use and towns with the new biome's ground, palette, vegetation tones, seasons and snow. “Regenerate the relief for this biome” rebuilds the relief for it, and any new relief uses the biome on screen.
- Add the White map style for studying town plans: a white ground with relief shading, grey building footprints, roads, town walls and flat water, without land use, vegetation, textures or contour lines.
- Show each town layer on its own from the map toolbar: roads, quarters, blocks, parcels and houses, to inspect the street network, blocks or lots without the houses. Satellite styles keep their towns free of plan graphics.
- Keep generating maps and background towns while the browser tab is hidden or minimised; the map is drawn when the tab is shown again.
- Fix orchard rows drawn in 2D drifting away from the 3D fruit trees away from the map origin: the 2D marks, the 3D trees and the Satellite crowns now share one row lattice per orchard.
- Keep the houses and 3D trees already built when switching to a map style that draws them the same way, instead of rebuilding them.
- Choose the special buildings of a town: its options list the default draw (building type and number), and you can change any number or add another building type from the catalogue. “Suggest” lets the programme lower a number for the town’s size and sites; “Force” places exact numbers first and shows placed/requested with a warning when a site is missing. The old castle, cathedral and palace options are removed.
- Town warnings are one short line each, in English or French.
- Download the experimental Apple Silicon DMG from GitHub Releases alongside the Windows and Linux packages.
- Keep Satellite rivers correctly shaded in fast and reduced-quality displays, without exposing encoded water data as green ribbons.
- Remove offshore sediment plumes while retaining the flared river mouths and their smooth transition into the sea.
- Start with a fresh biome, relief and coherent coastline recipe; enable “Reload previous map at startup” in Settings to restore the last saved map instead. Explicitly opened maps keep their own recipe.
- Synchronize visible climate and relief choices with the fresh startup recipe, using reliefs supported by the selected terrain engine.
- Fix town composition rerolls crashing when final street and block processing changes their indices.
- Preserve the parcels of untouched quarters when regenerating a quarter, and trim village lanes to their last served plot.
- Release cadastral source geometry after baking, prepare complex overlay snapshots before navigation and reduce allocations while drawing strokes.
- Reduce building buffer duplication, reuse visible chunk selections and streamline building cache uploads and eviction without changing their appearance.
- Keep the same smooth GPU houses in flat and tilted views, without preparing a second Canvas house rendering on capable devices; retain Canvas for machines that need it.
- Fix flickering house and parcel fences when panning or tilting the map.
- Choose roof rendering independently: V1 with roof edges, V2 without traced edges, Flat without roof textures, or Minimal blocks without pitched roofs.
- V1 roof edges are finer and softer, and diagonals inside warped roof surfaces are hidden.
- Preserve the shading of pitched roofs, including Newar houses, at medium zoom.
- Keep loaded 3D trees stable while nearby forest blocks finish loading, including when the camera stays still.
- Load the 3D trees in view first when the camera is tilted, instead of filling the unseen ground under the camera before them.
- Keep nearby trees detailed, restore foliage grain and canopy tones matching the satellite ground, and broaden conifer crowns.
- Recompute urban planning bounds when a small settlement's population is increased, so mountain towns can reach nearby buildable land instead of retaining farm-sized bounds.
- Keep nearby 3D trees visible when orbiting close to the ground or looking toward the horizon, and restore the terrain exaggeration slider with its current multiplier in the tilted-view toolbar.
- Discard the previous map's 3D trees when regenerating with trees switched off, so re-enabling them cannot restore trees over the new sea or terrain.
- Keep Satellite fast's terrain and vegetation identical to Satellite, while retaining simplified textured buildings.
- Remove dashed town reserve outlines from Satellite and Satellite fast.
- Publish regenerated towns in 2D without requiring a 3D switch, continue unfinished Canvas paints, and keep the central generation card visible alongside town-name spinners until the new display is complete.
- Keep Atlas free of contour lines and urban ground fills, showing houses and roads only. Atlas, Cadastre and Topography keep only building volumes above their map in the tilted view.
- Let each map appearance choose its river, road and town-plan rendering, keep a simple Show roads switch, and keep the toolbar steady while the view loads.
- Reuse fixed-definition town and land-use rasters in Cadastre, and retained contour rasters in Topography and Parchment instead of redrawing contour triangles at each frame. Topography uses 1 m contours with 5 m index lines.
- Reduce the density of Parchment's drawn trees.
- Stabilize 3D tree populations and detail changes, fade in new tree blocks, reduce tree mesh and instance-buffer costs, thin dense tropical stands and shorten bare conifer trunks.
- Keep coastal smoothing to a configurable median width and slow, seeded width variation along the shore, without cliff profiles or inland relief reshaping. The compact controls sit below the coast choices, with help in tooltips.
- Tilt, fly and walk through the map with one continuous camera; lock the view to 2D and adjust the viewing depth.
- Keep loaded towns and contour lines cached across map styles and camera changes, with sharper navigation and faster map preparation.
- Draw parchment woods on the GPU and simplify light map styles; choose an initial style suited to the device's graphics capabilities.
- Extend the tree viewing range to 5 km, fade distant trees and keep trunks off building footprints.
- Edit roads and contour lines directly on the map, with persistent road controls and coordinated updates to affected town blocks and farmland.
- Limit automatic settlements to 20,000 inhabitants, improve mountain villages and preserve manually placed foundations.
- Confirm resets and town moves inside the app, and keep generation progress visible independently of settlement generation.
- Open the four latest versions' release notes from the top bar.
- Keep 3D harbour structures, boats and equipment on the displayed terrain and water instead of outdated planning heights, including exposed dry riverbeds; anchor pier piles in the bed.
- Preserve dwellings when a major landmark is requested in a camp or another settlement with a single residential block.
- Embed a compact city preview in an iframe using Azgaar burg data or city URL parameters, with automatic generation and a link to the full editor.
- Explore varied city previews with a randomize button, and distinguish individual buildings with clearer outlines and contrasting landmark colors in the Minimal map style.
- Pan and zoom inside city previews with mouse, touch and keyboard controls, including cached thumbnails, and reset the view to frame the city.
- Harmonize building daylight in 2D and 3D: domes, pitched roofs, flat roofs and walls share softer, consistent shading across architectural styles.
- Walk mode collides with house exteriors and fortifications, slides along walls and keeps gate passages open.
- Fix startup and reloads getting stuck when the browser GPU driver does not answer. Native procedural generation no longer waits for an unused browser GPU.
- Keep generation settings and imported heightmaps when reloading during an interrupted or unfinished restoration.
- Underdark, tilted map: the caves are back in relief, with rock walls rising to the roof of each chamber and tunnel (the appearance's roof height), a black sky, the cave's darkness and lantern light on the ground and the town, modelled mushrooms, and no surface trees.
- Underdark: the cave roof is back, cut away around the view in orbit and whole overhead when walking or flying.
- Underdark: an irregular vault, close over the floor in places and lost in the dark in great chambers; stalactites from needles to stout stumps, alone, in clusters or giant; stalagmites on the floor.
- Underdark, tilted map: a brighter cave, with lantern light around isolated farms and more glowing mushrooms.
- Underdark lava tubes are no longer drawn as a dark band with a dashed centre line.
- Underdark, free flight: only the cave's rock stops the flyer, who slides along the walls instead of being lifted out through the roof; the roof and the stalactites never block, and the roof opens under a flyer who is above it.
- Underdark road tunnels are drawn as bare ground at the road's own width instead of a wide grey slab with kerbs.
- Underdark: fungal farms stay by the cave towns. The countryside no longer fills with hundreds of farmsteads: no roadside farms or farm hamlets, and at most one isolated farm per 500 inhabitants (40 per map).
- Underdark: fungal farm beds are dark compost of the cave floor's tones with small, faintly glowing mushroom caps in every map style, instead of a pale field with a purple symbol.
- Underdark lava tubes and river passages are narrow guts a few metres wide on every map size, instead of passages at least two terrain cells wide; roads and rivers still pass through them.
- Generate towns on steep sites about twice as fast: the slope relaxation is chosen before the first layout instead of after a failed one.
- Generate towns slightly faster: street pruning settles in one pass and trim checks skip work they do not read.
- A town no longer depends on the towns generated before it in the same session: the capacity calibration is keyed on everything it reads, and retouching one quarter no longer recalibrates the town.
- Web version: generate independent towns at the same time and build town volumes from compact display rows: two towns of 50,000 take about 21 s instead of 56 s, close to the desktop engine.
- Speed up town generation in the browser when the result cache is large: cache writes no longer read back every stored town.
- Houses on mountain slopes no longer float in 3D: footings reach below the coarser distant terrain, and stilt posts run down to the ground on the downhill side.
- Hillside farmsteads seat each detached building on its own ground; terracing cultures stand houses on level terraces with a retaining wall, shown in 3D and in detailed 2D plans; compact and detailed architectures sit on the displayed terrain.
- Stepped streets stand as real flights of steps in 3D: level treads in the colour of the street they continue, lighter risers sized to the slope, landings at turns and on long climbs, stone cheeks down to the ground, over a plain paved strip instead of a hatched band; in 2D their tread hatching spans the whole width.
- Streets meet as one surface: a street joining another stops flush at its far edge instead of a rounded end sticking out by a metre or two, bends between streets close with a proper join, and dead ends are cut square, in every map style, 2D and on the 3D ground.
- Town walls open the number of gates their size allows (about five at 10,000 inhabitants, eight for a large city) instead of one wherever a street or a bridge ramp reached them. At a gate the curtain turns square to its street, with its gatehouse; the other streets end at the wall, and a main road left without a gate goes round the moat to the nearest one.
- Stepped streets also stand as flights of steps on the tilted map.
- New 3D option in Advanced, "Built terraces in 3D" (on by default), shows or hides the stone terraces and retaining walls under the hillside houses of terracing cultures.

The Apple Silicon DMG is signed ad hoc and distributed without Apple notarization. GitHub Actions tests the packaged app. Native neural GPU inference on a physical Mac remains unverified.

- Steep roads no longer raise stone or timber decks over dry ground. Stairs are short, join two streets and look like lanes from afar; their steps show close up.
- Town walls no longer fold along small streams, and large towns keep at most two older rings on one bank. Moats end round and short of the shore.
- Night views: snowed roofs take the moonlight with patchy snow, streets, doors and walls are lit, and sky and haze are dark.
- Winter trees lose their dark half and rings.
- Venetian lagoon towns on slopes have more canals, with locks.
- Nomad camps are full, with rows of tents round a common. Igloos have an entrance tunnel. Drow towers mark noble houses only. Cyberpunk towns are denser, in concrete, asphalt, glass and rust. Chinese, Indian and ksar village courts share walls on their lot limits.
- Rivers are sharp on the tilted drawn maps, and roads no longer show under town bridges.
- Houses on slopes are sunk into the hill with a low plinth and terraced ground; tall foundations are gone, and steep wings step down or open a lower storey.
- Moats are dug with their own form by culture (V ditch, revetted, double, ceremonial, bastioned) and fill: dry grass, gardens, marsh, stagnant, low or full water, ice. Water stays level, held by dams on slopes, and meets the sea through a sluice.
- Harbours stand on the town's own shore with a yard, warehouses, jetties and boats outside the wall; away from them the wall stands back from the beach, and older rings no longer run beside the outer one.
- Bridges never cross or overlap. Gates seldom fold the wall into sharp corners. Hairpin bends are rounded.
- In winter, cliffs and steep slopes keep snow patches on their ledges and in their gullies instead of standing bare, in 2D and 3D.
- Snowy streets, country roads and squares now take the snow of the land they cross: no more white roads over bare slopes. Town ground is cleared and trodden into patches, never whiter than the land around the town.
- Mountain roads climb cliffs in clean switchbacks: the road zigzags up the face and every tip is rounded inside its V, with no loop, doubled or notched tip at a corner. In 3D they keep their true width on the cliff instead of a band smeared down the face.
- Modelled 3D trees take the painted crowns’ colour grade by forest type, climate zone and season, so conifers and zone-tinted forests keep their map colour when the view tilts.
- On the tilted map and in the 3D view, hillside streets are level across their width and follow a smooth slope along their length. Levelled lots meet them at the street edge. Stairs, bridges and quays keep their own heights.
- Parchment maps prepare ploughed fields faster while you pan and zoom: furrows keep their spacing, direction and tone.
- The Places panel and the entity sheet name isolated buildings and their kind (for example Rural monastery · Place of worship) in the chosen language instead of raw identifiers. The relief editor, building counts, Azgaar import and coast names are now translated in every language.
- Editing a house, parcel, block or quarter from the selection changes only that element and the buildings on it: no street is retraced, the other houses, parcels and quarters stay exactly as they were, the neighbouring towns and the countryside are not recomputed, and the map redraws only the changed buildings in 3D. On the 2D map the town stays on screen while the edit is prepared, and only the changed lots and buildings are triangulated again. With city-volume architecture, the dice on a house now draws a new variant of that house.
- On the tilted map and in 3D, clicking a roof selects its parcel, block or quarter at those inspection levels, every building stops the click instead of letting it pass to the ground behind, distant roads and walls are easier to pick, and the selected building is tinted in 3D.
- Changing the map style, season or night on the tilted map recolours the town's buildings without rebuilding them, and the previous colours stay on screen until the new ones are ready.
- Switching between a map style with standing buildings (satellite, parchment) and a flat-plan style (topographic, minimal) no longer rebuilds the town: it stays on screen, and tilted views use less video memory across style switches.
- The fast Satellite and Parchment looks are lighter on laptops: no procedural forest crowns or ground tree symbols. Painted Satellite roofs now show their cover texture in their painted colours.
- Atlas coastlines and lake outlines are drawn in the atlas blue again, not the parchment grey, and Minimal rivers meet the sea without a colour seam.
- The sheet of a selected road, river or town wall now has an Edit button: it opens the road tool with that road selected, the river tool on that river, or the town's fortification settings.
- Changing the season on a Parchment map redraws its ground once instead of twice and no longer uploads the land sheet again; the snow line of the ground and of the land around the woods is one line. Panning a map no longer re-sends the ground tiles' positions to the graphics card on every frame.
- After a pan or zoom, the drawn map details of a new area are prepared in short steps instead of one long block, so the page no longer freezes for a second or more at rest on large Parchment maps; the Minimal map no longer updates page attributes on every frame of a gesture.
- Changing the season redraws the rivers and lakes only when their state changes (a freeze, a thaw, or a step of drought in dry climates), not on every new date; dry beds now move with the rain in small steps.
- Share codes now carry lot edits (content, households, fence, removal, reroll, culture) and house models (house type, pack, roof, floors, materials and the other model settings of a building, lot, block, quarter, town or the whole map), so the code opens the same edited town. Drawn outlines and splits still travel only in the project file. Every slider position, including on sliders shown in other units, is now a value the code keeps exactly.
- The Vector engine setting now warns, under the select, when a forced choice is wrong for the machine: GPU while the graphics card path is unavailable or software-only, or CPU while the graphics card works. Auto is recommended. The `?vector=` page address option is gone.
- Parchment woods keep their whole tree symbols: crowns along a wood's edge or a river bank are no longer sliced by straight land-use edges or hidden under the river band.
- Farmsteads in 2D show only what the farm holds and the 3D view raises: no culture fence round a farmyard the farm left open, pen fences drawn as the rail fences of the 3D view, and roof ridges taken from the raised buildings (no more ridge line across round, domed or flat farm roofs).
- Towns on steep coasts and mountain islands keep their requested population and build on terraced slopes instead of shrinking to a village.
- An activity site placed by hand (a watermill, a quarry, a pottery…) builds its mill, sheds or kilns and its other buildings again instead of standing empty. The same applies to a hand-placed isolated farm, mill, inn, tower or shrine.
- Town moats follow their culture and site: Roman V-shaped and double ditches, rock-cut ditches round hill towns and dwarven holds, canal moats in canal towns. A wet moat with no river, sea or canal to feed it holds only a seasonal pool, so it shows dry, muddy, low or full water depending on climate and season.
- Walled towns on estuaries, deltas and indented coasts trace their walls faster; the towns themselves are unchanged.
- In the Underdark, chambers sealed in the rock stay empty: no town, hamlet, farm or yard lands where no gallery leads. Valley relief now has asymmetric sides: a steep cut bank outside each bend and a gentle slip-off slope inside, with the same average width.
- The fine coastline now shapes everything at the shore: town ground, the 3D relief, the sea the towns plan with, and the sea's swell and surf follow the drawn shoreline instead of the coarser one beneath it.
- River mouths now end exactly on the drawn coastline, without a strip of land or an overshoot into the sea.
- In dry climates, a river flowing into a lake that has shrunk to its water budget now always ends in the lake's water, even when the deepest hole of the basin lies at the shrunk lake's edge.
- Towns on steep sites generate faster when a spring lies far from their streets: the paths tried for its water building are searched together instead of one after the other, with the same result.

- Phones and tablets no longer get stuck in the Minimal style: a temporary loss of the graphics context is no longer treated as a missing graphics card. Maps saved in Minimal or in a fast style by that fault return to their full style.
- Settings offers a Performance choice: Auto, Economy, Balanced or High. On phones and tablets, Auto starts at Balanced on flagship graphics chips and at Economy on the others, and keeps that level for the visit: what it measures only sets the level of the next visit.
- On phones and tablets the live map is drawn at up to twice the CSS resolution (1.5× in Economy) instead of the screen's full pixel density, and generation runs fewer threads and workers to stay within the tab's memory. The same settings and share codes give the same map on every device.
- On a phone or tablet, the terrain controls warn when a map is likely to exceed the device's memory.
- In Economy mode, the map preview and minimap reuse the lighter terrain renderer, avoiding full-quality shader compilation during generation.
- On phones, the Workshop opens as a bottom sheet (a side panel in landscape). It closes when a generation starts or when the map is touched, and opens on the town that was tapped. An empty map offers a Generate a map button.
- On phones, the header fits the screen with a ⋯ menu for secondary actions. The toolbar keeps the map style, 2D/3D and a Display panel for the other view controls. The places list folds into a chip, and the phone layout also applies in landscape.
- With a finger: fields no longer zoom the page on iOS, buttons, sliders and checkboxes have larger touch areas, parameter help opens from a ? button, dialogs close with a tap outside, and a downward pan no longer reloads the page.
- The advice to use Chrome or Edge is no longer shown on iPhone and iPad, where it could not help.
- In the tilted view, twisting two fingers turns the map, together with pinch and pan. On phones and tablets, free flight has on-screen up and down buttons.
- With a finger, the map editors pick roads, outlines and towns within a wider radius. Moving a town no longer blocks panning and pinching. Settlement placement and outline cuts have a Cancel button, and editor hints describe touch actions.
- On phones and tablets, a map left less than 30 minutes ago can be resumed in one tap after the browser discarded the tab: its settings come back and the map is rebuilt on request. The Reload previous map preference still decides when it has been set. Nothing is generated while the page is hidden.
- When a phone or tablet runs out of graphics resources, the map keeps its lighter view and the next visit starts at Economy. If the graphics compositor fails to start, the map stays on its 2D view while the compositor is tried again a few times; the 3D button explains why it cannot tilt the map instead of staying greyed or doing nothing.
- Settings › Performance can copy a device journal (graphics contexts, performance level, errors) for a bug report.

- Selection edits keep names elsewhere on the map and transfer only changed town data, reducing the work after each edit.

- Selection edits update nearby forest cover, roads under the canopy and the map background locally in 2D and 3D.

- Editing a house or plot in the live 2D town view now reuses nearby streets, roofs and lighting and updates the affected 256 m cells.

- The Valley terrain source shapes bends with steep outer banks and gentler inner slopes, keeping the same average width and depth.

- On large coastal maps, towns follow the drawn shoreline at every planning resolution.

- The Places building card shows resource names in the selected language, from ore and farmland to the roads serving isolated buildings.
- Coastal smoothing and subdivision edit errors now appear in the selected language.

- Water gates join street canals to nearby wet reaches of a canal moat.

- Changing contour colour or opacity reuses the existing contour plate, reducing redraw work and memory use.

- Farmyards show their generated enclosures in 2D and when tilted. Wetland farm buildings sit on raised earth platforms, and modern grain farms can add round metal silos through the outbuildings setting.

- Select a wall to change that enclosure’s construction, moat or land gate target, or remove it. Road edits are saved in the recipe and reapplied when the region regenerates.

- Large elven towns use less memory when switching map views, and their groves keep their crowns and elevated walkways.

- Mountain towns can start with stepped foundations when steep or wet blocks leave too little land for ordinary houses.

- Changing season on a Parchment map reuses recorded land-use washes and field strips, along with the ink and wash masks for open-land symbols.

- Editing a quarter reuses city volumes outside it when the surrounding street and block layout stays in place.

## Alpha 0.3.10

Replaces 0.3.9, whose build stopped on an outdated test before publication (no 0.3.9 packages exist).

- Open a city from another generator: the import dialog ("Open a code or link") accepts a watabou city or village generator link, or an Azgaar Fantasy Map Generator burg (a row of the burgs-overview CSV, header optional, or the JSON of the new Azgaar export script, copied from the dialog). The town keeps its name, population, walls, citadel, temple, port, river and coast; Azgaar burgs also bring relief, biome, climate and culture. The FMG culture name base and type choose a fitting Magna Urbis culture, drawn per town, and the toponym language. See `docs/AZGAAR_IMPORT.md`.
- An imported town is a single place on a map sized for it (about 3 km at 2,500 inhabitants, 6 km at 12,000).
- Opening a code or link now runs the whole generation instead of waiting for a click; the map is drawn even when the code is opened from the 3D view.
- The map recovers from a lost GPU context, and a superseded map display no longer repaints over a newer one.
- The Illustrate button is withdrawn for now.

Source validation: TypeScript type-check passed; the import, city code and city parity suites passed (83 tests) and the release integration suites passed locally (40 tests). The opened-from-3D blank map was reproduced and fixed in a headless browser. The Azgaar export script has only been syntax-checked, not yet run in a live FMG page. The same sources are live on magna-urbis.org and passed the full live check on a real GPU.

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.8

- Faster display: the GPU vector engine no longer demotes itself to the CPU for the whole session (its tile timing was inflated by a synchronous error read). On a 40 km map, switching to parchment drops from about 35 s to 17 s and parchment pan/zoom stalls are halved; on a 10 km map the parchment switch drops from 6 s to 3 s.
- Lighter 3D opening and town plans: one water clipper per ground, indexed ring tests for moats and footings, memoised wall ground samples, building meshes written straight into typed arrays, plan clipping on the building workers.

Source validation: TypeScript type-check and the render suites passed (city parity, vector engine, city ground, building ground, 3D heights). Each engine's output is pixel-identical before and after; keeping the GPU engine instead of the CPU fallback changes anti-aliasing slightly (satellite 0.4–0.6 % of pixels, parchment line edges).

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.7

- Fix procedural relief on the in-app browser engine with WebGPU: the erosion shader no longer uses `from`, which recent WebView2/Chromium versions reserve ("485: 'from' is a reserved keyword"). A test now rejects reserved words in every WGSL source.
- Faster release builds: the desktop packages skip the multithreaded browser core, which the native app does not use.

Source validation: the WGSL reserved-word test passes; a WebGPU procedural generation completes in Chrome 157 on a real GPU. The same fix is live on magna-urbis.org.

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.6

- A spinner beside the view selector turns until the view is fully drawn (style, shaders, textures, tiles, 3D opening), so a view still loading its textures is not mistaken for a broken one.
- The measure button shows its ruler icon only.
- Web edition: Automatic, WebGPU and CPU are all selectable (WebGPU greyed only without an adapter); an explicit CPU choice is kept, so neural relief is refused before any download with a WebGPU message.
- The web page gains search metadata in eight languages, link preview cards, a web app manifest and icons.

Source validation: TypeScript type-check and the targeted frontend suites passed (runtime choices 62, view loading, localisation, city parity). The public web build passed the static check and the full live check on a real GPU (neural download and WebGPU generation, complete map with towns, 3D, house roof edit, save/reopen, styles and language, GPU cancel, offline model cache).

Package validation: pending on the published assets.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.5

- Place settlements from probability layers: walked distance to water (cliffs count), access from the map edges, culture-weighted attraction to water (dwarves and duergar keep off the shore), room for the population and repulsion by size. The main town always stands on the largest land mass, towns of 1,000 inhabitants or more never stand on a disconnected island, and a place too large for the room left is lowered one class, with a notice.
- Keep harsh maps (alpine, arctic, desert, Underdark) inhabited with a minimum regional population per map size. The list of places now drives the population: adding a town adds its inhabitants. Population edits are recalculated and rural density is bounded.
- Build credible villages: about one dwelling per household, with communal houses capped (plank houses hold 2 households, longhouses up to 20 people). A village that cannot house its households is laid out again with more room. Labels, camera and picking follow the built core. Add street villages, whose lanes end at their last plot with square ends.
- Rebuild harbours as a simple quay band hugging the water, 1 m above it and drawn above streets, with pontoons, boats and cranes, closed Hanseatic basins and cliff-foot landings. The chance of a coastal port depends on the culture and the room available. The engine, 2D and 3D share one shoreline, so no buildings stand in the water in 3D.
- Roads never cross the sea or lakes; bridge spans are limited by road rank and bridges continue the road (no aqueducts). Remove dead ends without a destination and request regional map exits per road class. Satellite and Rendered roads blend into the ground, tropical earth tracks most discreetly.
- Cut fields by the drawn rivers, lakes and roads (no fields on rivers, no staircase along the water). Cultivated land follows the farming households and their reach; fields without a farm revert to pasture.
- Lay town ground, buildings, roads, bridges, quays and moats on the drawn terrain in 3D (no floating towns).
- Fortifications: fewer gates, budgeted by population, no ungated openings, dead gates closed without cutting suburb access, continuous moats, dug moats in 3D, and new Moat and Fortification style options.
- Editor: per-level fields (quarter: culture, urban plan, growth zone and phase, density with a real effect up to ×10; block: culture, density, parcelling; parcel: content with every building type, fence; house: type, roof, storeys) plus an Advanced section, a parcel merge tool and a sticky map selection. Edit toponyms (name, visibility, reset to the culture's name) and rename settlements.
- Underdark: natural and dug tunnels, a cavern look in 3D, mushrooms of many shapes (myconid towns with amanita caps), drow and duergar looks with webs and forges, rock-walled towns and no fields. Modern towns get a few towers.
- Smooth rivers at the source scale (no grid staircase), with meanders sized in metres and display by discharge. The lakes slider goes up to 4. In winter, snow covers town ground and fields; arctic summers keep pack ice, adjustable per season.
- Save and open binary `.muproj` projects, with a higher project size limit.
- The web edition generates on WebGPU or the CPU. The local profile picks native, then Python, then browser neural relief automatically and falls back to the browser when the native engine is unreachable; model setup opens from the source selection. Results are recomputed when the engine changes, a restarted engine gets its terrain back transparently, and a Reset button restores every setting.

- Performance: no more freeze while drawing large maps with rivers (a 32 s main-thread task on a 40 km map is gone); faster naming, occupation and 3D opening; the local engine is deployed as a release build again.

Source validation: Rust tests passed for settlements (52), land use (18), terrain (71), the local engine (12) and urban (744 of 746; the two known failures are a 1–2 m street-village lane tolerance and a single-quarter redraw locality case that predates this release). TypeScript type-check and the targeted frontend suites for every change passed; a full frontend run was interrupted and two heavy town-quality suites remain to be reviewed. A local Windows build produced the NSIS installer.

Package validation: pending on the published assets (download, model download, native neural inference, save/reopen and offline reuse).

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.4

- Edit the full hierarchy: city, quarter, block, parcel and building. Regeneration applies the current seed; the dice chooses a new local seed. Parent edits systematically replace descendant overrides within the selected area.
- Culture changes propagate to street patterns, parcel layouts and architecture. Quarter street patterns rebuild interior streets. Keep rendering, textures and lighting choices during regeneration, and preserve editing settings in share codes.
- Simplify the inspector, localize building types, populate advanced settings and filter types by culture, available architecture and parcel area. Failed building requests retain the previous scene. Building-type changes selected from a house currently apply to its parcel, as indicated in the interface.
- Target 85% tree dwellings in the elven profile. Reduce automatic farmstead and hamlet counts while preserving regional population; build small places in groups of up to eight with four generation lanes and one regional update per group.
- Add the minimal map renderer and its composition controls, including contour lines. Correct night lighting of detailed buildings' own window materials.

Source validation: 688 Rust urban tests and 208 targeted frontend/integration tests passed, along with TypeScript, version alignment and portable/checksum checks. A real native-engine browser run covered block editing, renderer retention, localized options, selection cleanup and nine farmsteads built in two groups (eight plus one).

The published portable Windows app passes procedural generation, exact save/reopen, complete native city generation, 3D, verified model download and real native Rust/Vulkan inference on an RTX 5090, followed by deterministic offline restart and owned-service shutdown. The extracted Windows installer payload passes startup and native-service checks. The Linux AppImage and extracted DEB app pass procedural generation, exact save/reopen and service shutdown under Ubuntu 22.04/WSL2; native GPU inference is not newly qualified on Linux. The public website passes real WebGPU generation, editing, 3D and offline model-cache reuse on the RTX 5090. All 14 public downloads pass size, link and SHA-256 checks. See the [0.3.4 verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.4_VERIFICATION.md) for methods and limits. Existing 0.3.3 results below describe that version only.

macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.

## Alpha 0.3.3

- Include the Python/CUDA service's `neural_sampling.py` dependency in both desktop packages. Staging and package validation now share the service-module inventory, with a regression check for adjacent imports.
- Clear inherited `PYTHONHOME` and `PYTHONPATH` when launching optional Python environments. AppImage launchers can otherwise redirect an existing venv to the bundle's incomplete Python library tree.

Final package validation: the published AppImage (direct FUSE launch) and installed DEB both generated terrain through the packaged interface using an existing WSL Ubuntu 22.04 venv, PyTorch 2.11.0+cu128 and an NVIDIA GeForce RTX 5090. The interpreter was configured through the application, with no wrapper or package modification. Cached Python model files were reused with Hugging Face offline mode enabled; exact project save/reopen and owned-service shutdown passed. Windows portable and extracted installer payload tests passed; native Rust/Vulkan inference on an RTX 4090 reused the previous app version's verified weights and produced identical results after an offline restart. All 14 public downloads passed size, link and SHA-256 checks. See the [0.3.3 verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.3_VERIFICATION.md) for methods and limits.

## Alpha 0.3.2

Known optional-module issue: the published Python/CUDA service omits `neural_sampling.py`, and the AppImage launcher can override a configured venv's Python paths. Alpha 0.3.3 addresses these packaging and launch issues. The source and published package files for 0.3.2 remain unchanged.

- Edit architectural styles, packs and generation parameters independently for quarters, parcels and individual buildings. Reroll a selected scope or its descendants while retaining local style choices.
- Procedural roof and storey edits retain the existing footprint. Failed architectural changes keep the previous scene. Selected buildings have a red outline.
- Show fewer map names by default. The top toolbar's Advanced panel provides category toggles, a detail slider and individual name visibility. Selection titles use the current name locale without translating proper names.
- Browser neural generation asks before downloading models, verifies same-origin model chunks and reuses verified model and runtime caches. Native desktop and optional Python model downloads remain separate.
- Improve desktop download links, map relief controls and small-settlement generation.

Source validation: 683 Rust urban tests and 156 TypeScript integration tests passed. Packaged Windows 11 tests cover procedural generation, exact save/reopen, verified model download, real native inference on an NVIDIA GeForce RTX 4090, deterministic offline restart and owned-service shutdown. Ubuntu 22.04.5 under WSL2 passes the DEB and AppImage tests, including direct FUSE launch, procedural generation, exact save/reopen and shutdown. Native Rust/Vulkan GPU inference on Linux is not qualified: this WSL installation exposes only a software Vulkan adapter. This limitation does not describe the separate Python/CUDA runtime. All 14 public downloads match their SHA-256 digests and expected sizes. See the [release verification record](https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_0.3.2_VERIFICATION.md) for methods and limits. GitHub-hosted runners do not validate GPU inference or every Linux distribution.

Magna Urbis V2 is an experimental alpha for Windows x64 and Linux x64.

- Includes the procedural Rust engine and a native Rust GPU inference service. Users do not need Rust, Node.js, Python or CUDA for these engines.
- Native neural terrain uses the same coarse4 / NF4 B75 / distilled decoder profile as browser V2. On first use, the app downloads and verifies approximately 162 MB of model weights. Settings also provides an explicit download button. Verified files are reused after restarting the app, including offline.
- Native inference needs a compatible GPU and driver. A smaller download does not imply equally small GPU memory usage. Procedural CPU generation remains available.
- The experimental 99 MB native climatic base uses a different mixed 3/4-bit format and is not supported by this Rust loader. It is not offered as an installable desktop profile.
- Optional Python/CUDA terrain and illustration modules remain separate downloads.

**Windows:** use the setup EXE for installation, including offline WebView2 setup if required. Alternatively, extract the complete portable ZIP and run `magna-urbis-v2-desktop.exe`; keep its resources alongside it. The portable edition requires WebView2 already installed. Packages are unsigned and Windows may display a warning.

**Linux:** AppImage and DEB are built on Ubuntu 22.04 (glibc 2.35). Compatibility also depends on your distribution, graphical environment and GPU drivers. Make the AppImage executable before running it. GitHub-hosted build runners do not validate GPU inference; see the release verification record for hardware actually tested.

**macOS support is deferred until native neural inference and desktop packaging are validated on Apple Silicon.**

Application updates are announced in Settings and downloaded through the system browser. Close the app before installing an update. Back up projects before upgrading; alpha project formats and generated results may change.

SHA-256 checksums, the supported model profile and build commit metadata accompany the downloads. Model weights retain the MIT teacher attribution in `LICENSE-NEURAL-MODELS.txt`.
