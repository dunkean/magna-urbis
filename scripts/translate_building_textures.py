from pathlib import Path
import hashlib
import re

root = Path(__file__).resolve().parents[1]
source = root / 'assets/materials/buildings/README_FR.md'
out = source.with_name('README.md')
textures = {
 'clay_roof_tiles':('Weathered curved terracotta tiles','Orient tile rows toward the eaves; this is not an exact ancient tegula.'),
 'clay_roof_tiles_02':('Overlapping terracotta tiles','Profile and aging variant; check module for each tradition.'),
 'ceramic_roof_01':('Aged ceramic roofing','Rustic mossy variant.'),
 'grey_roof_tiles':('Grey ceramic tiles','Dark base for East Asia; does not replace Chinese, Korean or Japanese profiles.'),
 'roof_slates_02':('Weathered irregular slates','Rows oriented along the slope.'),
 'roof_slates_03':('Regular slates','Slate, not thick limestone roofing slabs.'),
 'reed_roof_03':('Reed thatch','Reeds and crosspieces are visible in the map; inspect repetition and do not duplicate crosspieces with geometry.'),
 'reed_roof_04':('Reed thatch, variant','For PALM: fibrous approximation; no identifiable palm leaves.'),
 'thatch_roof_angled':('Angled straw thatch','Inspect native orientation before creating UVs.'),
 'WoodSiding010':('Weathered wood shingles','Siding asset usable as a shingle surface; junctions and eaves must be built.'),
 'WoodSiding013':('Wood shingles, variant','Check overlap and module; the texture generates no silhouette.'),
 'RoofingTiles015A':('Regular grey clay tiles','Restrained supplement for grey roofs; not historical validation of their profile.'),
 'clay_plaster':('Rough earthen plaster','Direct for plaster; cob, wattle and daub, adobe and rammed earth are surface approximations without their structure.'),
 'Clay005':('Smoothed clay','Smooth earthen base; neither adobe joints nor rammed-earth strata.'),
 'patterned_clay_plaster':('Earthen plaster with decorative traces','Reserve for facades whose tradition justifies the pattern.'),
 'white_plaster_02':('Smooth white plaster','Surface lime/stucco; CHALK is a color approximation, not identified chalk.'),
 'white_plaster_rough_01':('Rough weathered white plaster','Aged variant for plastered walls and terraces.'),
 'red_plaster_weathered':('Weathered red plaster','Photographic pigmentation and wear retained.'),
 'blue_plaster_wall':('Rough blue plaster','Color is present in the asset; choose cultural use during integration.'),
 'Plaster001':('Uniform white render','Neutral base for tint variants.'),
 'brick_wall_001':('Bonded red fired brick','Preserve the real brick and joint module.'),
 'dark_brick_wall':('Weathered dark brick','Dark variant for brick facades.'),
 'sandstone_blocks_04':('Cut sandstone blocks','Ashlar; this sandstone must not be called limestone.'),
 'white_sandstone_bricks':('Light sandstone blocks','Actual sandstone; approximation for limestone/chalk without equivalent geological identification.'),
 'red_sandstone_wall':('Red sandstone wall','Red masonry; check module for India and arid regions.'),
 'stone_wall':('Irregular rubble-stone wall','Visible stones and joints; the assembly is not universal.'),
 'stacked_stone_wall':('Stone stacked in courses','Check for photographed mortar before using as strictly dry stone.'),
 'japanese_stone_wall':('Japanese bonded stone-block wall','Blocks for foundations; MEGALITH approximates material without monumental scale.'),
 'coral_stone_wall':('Coral-stone masonry','Direct for coral; shellstone only approximated.'),
 'volcanic_rock_tiles':('Dark volcanic-stone facing','Volcanic rock is stated; basaltic composition and clinker are not certified.'),
 'mossy_stone_wall':('Mossy stone wall','Wet variant for ruins and woodland settlement.'),
 'rough_wood':('Rough wood with visible grain','Wood texture only; posts, half-timbering and joints remain geometric.'),
 'medieval_wood':('Marked aged wood','Aged variant; surface marks retained.'),
 'raw_plank_wall':('Raw plank wall','Cladding, partitions and large plank houses.'),
 'weathered_plank_siding':('Weathered plank siding','DRIFTWOOD approximates weathered wood, not identified driftwood.'),
 'dark_planks':('Dark planks','Tint variant already present in the maps.'),
 'japanese_cedar_planks':('Japanese cedar planks','Local surface; does not establish framing joints.'),
 'hinoki_planks':('Hinoki planks','Light fine-grained wood variant.'),
 'wood_trunk_wall':('Trunk and log wall','The asset’s log joints and sections do not replace geometric logs.'),
 'bamboo_wall':('Round bamboo wall','Orient culms according to construction elements.'),
 'Bamboo001B':('Dry beige bamboo','Light variant for walls and framing.'),
 'bark_brown_01':('Rough brown bark','Bark surface, not a complete wall of bark panels.'),
 'Wicker013':('Woven bamboo','Actual weave; approximates wattle and should be combined with earthen plaster.'),
 'Fabric034':('Light felt','Yurts and felt coverings; thickness and seams must be added.'),
 'rough_linen':('Coarse woven blue cloth','Original is blue; provide another variant if unbleached cloth is needed. Orient the weave.'),
 'Leather039':('Light suede-like hide','Approximation of architectural hide; modern source without tent seams.'),
 'brown_leather':('Wrinkled brown leather','Modern leather variant; approximation for historic stretched hides.'),
 'snow_02':('Soft light snow','Approximation of compacted snow; igloo blocks and density remain to be defined.'),
 'grass_ground':('Grass-covered earth','Vegetation-cover appearance; neither turf blocks nor cut sod sections.'),
 'brown_mud_dry':('Dry brown earth','Surface for earthen terraces; TURF only approximates the earthen section.'),
 'rock_face':('Natural rock outcrop','For excavations and monoliths, rock supplies material; volumes come from geometry.'),
 'Rope001':('Beige rope','Rope surface; tie geometry and diameter must be supplied.'),
 'cobblestone_floor_04':('Rounded cobble and stone paving','Main road use; not mapped to a native building material.'),
 'stone_tiles':('Flat stone slabs','Squares and stone bridges; road use.'),
 'gravel_ground_01':('Compacted gravel','Lanes and paths; road use.'),
 'dirt_floor':('Packed earth','Dirt paths and fords; road use.'),
 'old_planks_02':('Aged deck planks','Wooden bridge decks; road use.'),
}
notes = {
 'MAT-WATTLE-DAUB':'Earthen plaster plus bamboo weave; exact wattle and daub not acquired.',
 'MAT-COB':'Clay and plaster approximate the surface; fibers and cob construction are not represented.',
 'MAT-ADOBE':'Clay/plaster only; no unfired-brick texture identified in this selection.',
 'MAT-RAMMED-EARTH':'Clay/plaster only; no stratified rammed-earth texture found in this selection.',
 'MAT-PALM':'Reeds as a visual substitute; no woven or overlapping palm-leaf texture.',
 'MAT-BASALT':'Dark volcanic stone; exact basalt composition not established by the supplier.',
 'MAT-HIDE':'Modern leather/suede as approximate material; no documented tent hides.',
 'MAT-TURF':'Grass/earth as a surface; cut turf and sod blocks absent.',
 'MAT-CHALK':'Light plaster and sandstone as approximations; no identified chalk.',
 'MAT-SHELLSTONE':'Approximate coral stone; no identified coquina/shellstone.',
 'MAT-CLINKER':'Dark volcanic stone; clinker porosity not faithfully covered.',
 'MAT-ICE-SNOW':'Surface snow; compacted construction snow and blocks absent.',
 'MAT-MEGALITH':'Wall/outcrop stone as material; no monumental-scale monolith.',
 'MAT-DRIFTWOOD':'Weathered wood; drift origin and marine wear not established.',
 'MAT-BONE':'No architectural bone acquired from the two libraries; bone search results were hazard signs and were excluded.',
 'MAT-LIMESTONE':'Light sandstone only; no certain limestone texture retained.',
}
text = source.read_text(encoding='utf-8')
inventory = re.search(r'(\d+) jeux PBR, (\d+) cartes, ([\d.]+) Mio de cartes', text)
if not inventory:
    raise ValueError('Could not read the generated collection totals')
set_count, map_count, size_mib = inventory.groups()
sections = text.split('## ')
table1 = sections[1].splitlines()
table2 = sections[2].splitlines()
table3 = sections[3].splitlines()
material_count = sum(bool(re.match(r'^\| `(MAT-[^`]+)`', line)) for line in table2)
pack_count = sum(bool(re.match(r'^\| `[^`]+`', line)) for line in table3)
source_words = []
for line in table1:
    if re.match(r'^\| \[([^]]+)\]', line):
        cells = line.split('|')
        source_words.append('\t'.join(cells[i].strip() for i in (1, 2, 6)))
for line in table2:
    if re.match(r'^\| `(MAT-[^`]+)`', line):
        cells = line.split('|')
        source_words.append('\t'.join(cells[i].strip() for i in (1, 2, 4)))
source_digest = hashlib.sha256('\n'.join(source_words).encode('utf-8')).hexdigest()
if source_digest != 'c3c7cf5c1ff11b8dba0fd35f60c45e859b68cca12994437cebbab5d68a15f1de':
    raise ValueError(f'French descriptions changed; review the translations and update the source digest to {source_digest}')
outtext = '''# Building textures — offline collection

[Français](README_FR.md)

{set_count} PBR sets, {map_count} maps, {size_mib} MiB of maps. Source resolution 1K; original files unmodified.

Collection only: no engine integration or automatic assignment to buildings.

[Guide and limitations](../../../docs/BUILDING_TEXTURE_LIBRARY.md) · [Color contact sheet](contact-sheet.jpg) · [Complete catalogue](catalog.json) · [Selection and qualifications](selection.json)

Powered by [Poly Haven](https://polyhaven.com/) and [ambientCG](https://ambientcg.com/). Downloaded maps are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) under the [Poly Haven](https://polyhaven.com/license) and [ambientCG](https://docs.ambientcg.com/license/) licenses. Previews derive from color maps, not site renders.

## Available types

`MAT-*` identifiers are documentary use leads. Their `direct`, `proxy` or `missing` qualification is in the next table. Cultural profiles and construction patterns must be checked during integration.

| Texture / provider | Type | Candidate native materials | Extent (m) | Maps | Note |
|---|---|---|---|---|---|
'''.replace('{set_count}', set_count).replace('{map_count}', map_count).replace('{size_mib}', size_mib)
for line in table1:
    match = re.match(r'^\| \[([^]]+)\]', line)
    if not match:
        continue
    key = match.group(1)
    if key not in textures:
        raise ValueError(f'Missing texture translation: {key}')
    cells = line.split('|')
    cells[2] = ' ' + textures[key][0] + ' '
    cells[4] = cells[4].replace('inconnue', 'unknown')
    cells[6] = ' ' + textures[key][1] + ' '
    outtext += '|'.join(cells) + '\n'

outtext += '''
## Coverage of the {material_count} native materials

`direct`: same material family; `proxy`: explicitly qualified approximation; `missing`: no retained file. Even `direct` certifies neither historical provenance nor construction geometry.

| Material | Status | Candidate sets | Limitation |
|---|---|---|---|
'''.replace('{material_count}', str(material_count))
for line in table2:
    match = re.match(r'^\| `(MAT-[^`]+)`', line)
    if not match:
        continue
    key = match.group(1)
    cells = line.split('|')
    status = cells[2].strip()
    if status != 'direct' and key not in notes:
        raise ValueError(f'Missing material limitation translation: {key} ({status})')
    cells[4] = ' ' + notes.get(key, 'Surface of the same family; construction geometry must still be supplied.') + ' '
    outtext += '|'.join(cells) + '\n'

outtext += '''
## Coverage of the {pack_count} architectural packs

Inventory calculated from materials in every recipe, variant and component of `rust/crates/houses/data/recipes.json`, including structure and rope fields. Full detail is in `catalog.json`. Counts are material families, not visually validated styles.

| Pack | Recipes | Direct materials | Approximate materials | Missing materials |
|---|---:|---:|---|---|
'''.replace('{pack_count}', str(pack_count))
for line in table3:
    if re.match(r'^\| `[^`]+`', line):
        outtext += line + '\n'
out.write_text(outtext, encoding='utf-8')
