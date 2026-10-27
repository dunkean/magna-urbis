"""Author the atlas recipe catalogue. Profiles are assigned explicitly by ID.

No runtime guesses from names or culture labels. Edit PROFILES / ASSIGNMENTS
and regenerate; --check fails when the committed JSON is stale.
"""

import argparse
import copy
import math
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'rust/crates/houses/data'


def profile(layout='single', footprint='RECT', roof='GABLE', structure='post_beam',
            frame='TIMBER-POST', infill='WATTLE-DAUB', coating='MUD-PLASTER',
            cladding='THATCH', width=(5, 9), depth=(7, 12), floors=(1, 1),
            bodies=(1, 1), rooms=(1, 3), elevation='ground', details=(), pitch=(35, 55)):
    return dict(layout=layout, footprint_family='FP-' + footprint, roof_system='RF-' + roof,
                structure_system=structure,
                materials=dict(frame='MAT-' + frame, infill='MAT-' + infill,
                               coating='MAT-' + coating, cladding='MAT-' + cladding,
                               base='MAT-STONE-DRY', roof_frame='MAT-TIMBER-POST'),
                width_m=list(width), depth_m=list(depth), floors=list(floors),
                bodies=list(bodies), rooms_per_body=list(rooms), elevation_family=elevation,
                details=list(details), roof_pitch_deg=list(pitch), overhang_m=[0.25, 0.6],
                wall_thickness_m=[0.25, 0.45], courtyard_ratio=[0.35, 0.55],
                allowed_roofs=['RF-' + roof], allowed_footprints=['FP-' + footprint])


PROFILES = {}


def add(name, parent=None, **changes):
    data = copy.deepcopy(PROFILES[parent]) if parent else profile()
    # Explicit overrides in source-readable units, not keyword inference.
    for key, value in changes.items():
        if key == 'materials':
            data[key].update(value)
        else:
            data[key] = value
    PROFILES[name] = data


add('timber', details=['posts', 'hearth'])
add('masonry', structure_system='masonry', materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'coating': 'MAT-PLASTER-LIME', 'cladding': 'MAT-TILE-CLAY'}, floors=[1, 2], roof_pitch_deg=[20, 40], details=['masonry_joints', 'hearth'])
# Compact Roman envelopes: dimensions are authored artistic ranges, not surveys.
# No shop interior, independent apartments or household capacity is implied.
add('roman_shop_house', 'masonry', width_m=[4.5, 6.5], depth_m=[7, 11],
    floors=[2, 2], rooms_per_body=[1, 2], wall_thickness_m=[0.25, 0.4],
    roof_pitch_deg=[20, 35], overhang_m=[0.15, 0.3],
    materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK'},
    details=['masonry_joints', 'shopfront'])
# B13's explicit infill opt-out keeps one body at every declared storey count.
# side_corridor would add a gallery; Strip already creates its lateral path.
# Native interior/urban admission and household capacity are separate checks.
add('roman_street_block', 'roman_shop_house', layout='strip',
    width_m=[6.5, 10], depth_m=[10, 18], rooms_per_body=[2, 4],
    urban_frontage_infill=False, details=['masonry_joints', 'rear_yard'])
add('stone', 'masonry', materials={'frame': 'MAT-STONE-DRY', 'infill': 'MAT-STONE-DRY', 'cladding': 'MAT-SLATE'}, details=['masonry_joints', 'porch'])
add('earth', structure_system='earth_wall', materials={'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE', 'cladding': 'MAT-MUD-PLASTER'}, roof_system='RF-FLAT', allowed_roofs=['RF-FLAT'], floors=[1, 2], roof_pitch_deg=[0, 0], wall_thickness_m=[0.45, 0.8], details=['parapet', 'scupper', 'exterior_stair'])
add('round', footprint_family='FP-ROUND', allowed_footprints=['FP-ROUND', 'FP-OVAL'], roof_system='RF-CONE', allowed_roofs=['RF-CONE'], width_m=[4, 8], depth_m=[4, 8], rooms_per_body=[1, 1], details=['hearth', 'single_door'])
add('stone_round', 'round', structure_system='masonry', materials={'frame': 'MAT-STONE-DRY', 'infill': 'MAT-STONE-DRY'}, wall_thickness_m=[0.45, 0.65], details=['masonry_joints', 'single_door'])
add('oval', footprint_family='FP-OVAL', allowed_footprints=['FP-OVAL'], roof_system='RF-REED-HIP', allowed_roofs=['RF-REED-HIP'], width_m=[5, 8], depth_m=[8, 14], details=['arcs', 'hearth'])
add('long', footprint_family='FP-LONG', allowed_footprints=['FP-LONG'], width_m=[6, 10], depth_m=[18, 36], rooms_per_body=[4, 10], details=['bays', 'multiple_hearths', 'multiple_doors'])
add('strip', 'timber', layout='strip', width_m=[4, 6], depth_m=[10, 18], floors=[1, 3], materials={'cladding': 'MAT-TILE-CLAY'}, details=['party_walls', 'rear_yard', 'shopfront', 'side_corridor'])
add('jettied', 'strip', structure_system='half_timber', materials={'frame': 'MAT-HALF-TIMBER'}, elevation_family='jettied', floors=[2, 3], details=['party_walls', 'jetty', 'exposed_frame', 'shopfront'])
add('market', 'strip', details=['shopfront', 'arcade', 'multiple_doors', 'rear_yard'])
add('arcade', 'masonry', layout='strip', width_m=[6, 10], depth_m=[12, 18], floors=[2, 3], details=['party_walls', 'arcade', 'columns', 'shopfront'])
add('tower', 'stone', footprint_family='FP-TOWER', allowed_footprints=['FP-TOWER', 'FP-POLYGON', 'FP-ROUND'], width_m=[5, 7], depth_m=[5, 7], floors=[3, 6], roof_system='RF-FLAT', allowed_roofs=['RF-FLAT'], roof_pitch_deg=[0, 0], materials={'cladding': 'MAT-STONE-DRY'}, details=['parapet', 'stair_tower', 'narrow_windows'])
add('earth_tower', 'tower', structure_system='earth_wall', materials={'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE', 'coating': 'MAT-MUD-PLASTER', 'cladding': 'MAT-MUD-PLASTER'}, floors=[3, 5])
add('fortified', 'masonry', layout='additive', bodies=[2, 2], floors=[2, 3], details=['stair_tower', 'parapet', 'narrow_windows'])
add('farm', 'masonry', layout='courtyard', footprint_family='FP-U', allowed_footprints=['FP-U', 'FP-L'], width_m=[18, 28], depth_m=[18, 26], bodies=[3, 4], rooms_per_body=[2, 4], details=['byre', 'barn', 'yard', 'well'])
add('alpine', 'log' if 'log' in PROFILES else 'timber', structure_system='log', materials={'frame': 'MAT-LOG', 'infill': 'MAT-LOG', 'cladding': 'MAT-WOOD-SHINGLES'}, width_m=[8, 12], depth_m=[10, 15], floors=[2, 2], elevation_family='mixed_base', roof_system='RF-EAVES', allowed_roofs=['RF-EAVES'], overhang_m=[0.8, 1.4], details=['stone_ground_floor', 'gallery', 'log_corners'])
add('redent', 'masonry', roof_system='RF-STEEP-STEP', allowed_roofs=['RF-STEEP-STEP'], floors=[2, 3], details=['stepped_gable', 'party_walls'])
add('bridge', 'masonry', layout='bridge', elevation_family='bridge', bodies=[2, 3], width_m=[7, 10], depth_m=[18, 28], details=['bridge_piers', 'water', 'arches'])
add('log', 'timber', structure_system='log', materials={'frame': 'MAT-LOG', 'infill': 'MAT-LOG', 'coating': 'MAT-BARK', 'cladding': 'MAT-WOOD-SHINGLES'}, floors=[1, 2], details=['log_corners', 'porch', 'hearth'])
add('turf_parallel', 'timber', layout='parallel', footprint_family='FP-COMPLEX', allowed_footprints=['FP-COMPLEX'], bodies=[3, 6], width_m=[16, 24], depth_m=[14, 22], materials={'infill': 'MAT-TURF', 'cladding': 'MAT-TURF'}, elevation_family='sunken', details=['turf_gables', 'connecting_corridor'])
add('turf', 'timber', materials={'frame': 'MAT-DRIFTWOOD', 'infill': 'MAT-TURF', 'cladding': 'MAT-TURF'}, elevation_family='sunken', roof_system='RF-THATCH-VAULT', allowed_roofs=['RF-THATCH-VAULT', 'RF-FLAT'], details=['earth_bank', 'entrance_tunnel'])
add('dome', 'round', footprint_family='FP-OVAL', allowed_footprints=['FP-ROUND', 'FP-OVAL'], roof_system='RF-DOME', allowed_roofs=['RF-DOME'], structure_system='flexible_frame', details=['arcs', 'low_entry'])
add('tipi', 'round', structure_system='flexible_frame', materials={'infill': 'MAT-HIDE', 'coating': 'MAT-HIDE', 'cladding': 'MAT-HIDE'}, roof_system='RF-TENT', allowed_roofs=['RF-TENT'], details=['poles', 'guy_ropes', 'smoke_flaps'])
add('yurt', 'tipi', materials={'infill': 'MAT-FELT', 'coating': 'MAT-FELT', 'cladding': 'MAT-FELT'}, roof_system='RF-DOME', allowed_roofs=['RF-DOME'], details=['lattice', 'crown', 'guy_ropes'])
add('nomad', 'tipi', footprint_family='FP-OVAL', allowed_footprints=['FP-OVAL', 'FP-RECT'], roof_system='RF-SADDLE', allowed_roofs=['RF-SADDLE'], details=['poles', 'guy_ropes', 'low_entry'])
add('court_flat', 'earth', layout='courtyard', footprint_family='FP-COURT', allowed_footprints=['FP-COURT', 'FP-U'], width_m=[16, 24], depth_m=[16, 24], bodies=[4, 4], rooms_per_body=[2, 4], details=['courtyard', 'passage_gate', 'parapet', 'scupper'])
add('court_tile', 'masonry', layout='courtyard', footprint_family='FP-COURT', allowed_footprints=['FP-COURT', 'FP-U'], width_m=[16, 24], depth_m=[16, 24], bodies=[4, 4], rooms_per_body=[2, 4], details=['courtyard', 'passage_gate', 'gallery'])
add('atrium', 'court_tile', layout='atrium', courtyard_ratio=[0.2, 0.3], details=['impluvium', 'inward_roof', 'passage_gate', 'atrium'])
add('peristyle', 'court_tile', layout='peristyle', width_m=[22, 32], depth_m=[24, 36], courtyard_ratio=[0.45, 0.6], details=['columns', 'covered_gallery', 'garden', 'passage_gate'])
add('insula', 'court_tile', width_m=[22, 34], depth_m=[26, 38], floors=[3, 5], bodies=[4, 4], rooms_per_body=[4, 8], details=['party_walls', 'multiple_households', 'shopfront', 'stair', 'passage_gate'])
add('villa', 'peristyle', footprint_family='FP-U', allowed_footprints=['FP-U'], bodies=[3, 3], elevation_family='platform', details=['columns', 'covered_gallery', 'platform', 'garden'])
add('vault', 'earth', roof_system='RF-VAULT', allowed_roofs=['RF-VAULT', 'RF-DOME'], materials={'frame': 'MAT-ADOBE', 'roof_frame': 'MAT-ADOBE', 'cladding': 'MAT-ADOBE'}, structure_system='masonry', details=['vault_abutments', 'thick_walls'], roof_pitch_deg=[0, 0])
add('iwan', 'court_flat', layout='iwan_court', materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK', 'coating': 'MAT-PLASTER-LIME', 'roof_frame': 'MAT-BURNT-BRICK'}, details=['iwans', 'vault_abutments', 'passage_gate', 'courtyard'])
add('windtower', 'court_flat', bodies=[5, 5], details=['windcatcher', 'passage_gate', 'courtyard', 'parapet'])
add('multiyard', 'court_flat', layout='multiyard', footprint_family='FP-COMPLEX', allowed_footprints=['FP-COMPLEX'], width_m=[22, 32], depth_m=[36, 56], bodies=[8, 12], details=['successive_courts', 'axial_gates', 'gallery'])
add('forest_court', 'court_tile', structure_system='post_beam', materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-COB', 'coating': 'MAT-MUD-PLASTER', 'cladding': 'MAT-THATCH'}, roof_system='RF-REED-HIP', allowed_roofs=['RF-REED-HIP'], roof_pitch_deg=[35, 55], details=['carved_posts', 'gallery', 'passage_gate'])
add('forest_multiyard', 'multiyard', structure_system='post_beam', materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-COB', 'cladding': 'MAT-THATCH'}, roof_system='RF-HIP', allowed_roofs=['RF-HIP'], roof_pitch_deg=[35, 55], details=['successive_courts', 'axial_gates', 'carved_posts'])
add('sahel_compound', 'earth', layout='hut_compound', footprint_family='FP-CLUSTER-ROUND', allowed_footprints=['FP-CLUSTER-ROUND'], width_m=[20, 30], depth_m=[20, 30], bodies=[4, 9], rooms_per_body=[1, 2], details=['mixed_round_square', 'earth_enclosure', 'shared_yard'])
add('hut_compound', 'round', layout='hut_compound', footprint_family='FP-CLUSTER-ROUND', allowed_footprints=['FP-CLUSTER-ROUND'], width_m=[20, 34], depth_m=[20, 34], bodies=[3, 12], details=['shared_yard', 'enclosure', 'peripheral_huts'])
add('kraal', 'hut_compound', layout='kraal', footprint_family='FP-ELLIPTICAL-RING', allowed_footprints=['FP-ELLIPTICAL-RING'], width_m=[30, 54], depth_m=[28, 50], bodies=[5, 30], details=['livestock_pen', 'peripheral_huts', 'enclosure'])
add('dogon', 'earth', layout='pueblo', footprint_family='FP-MULTICELL', allowed_footprints=['FP-MULTICELL'], elevation_family='terraced', width_m=[14, 22], depth_m=[12, 20], bodies=[6, 12], floors=[1, 3], details=['terraces', 'retaining_walls', 'round_granary'])
add('musgum', 'round', structure_system='earth_shell', materials={'frame': 'MAT-COB', 'infill': 'MAT-COB', 'cladding': 'MAT-COB'}, roof_system='RF-SHELL', allowed_roofs=['RF-SHELL'], details=['ogival_shell', 'earth_ribs', 'low_entry'])
add('forest', 'timber', roof_system='RF-REED-HIP', allowed_roofs=['RF-REED-HIP'], overhang_m=[0.8, 1.2], details=['posts', 'veranda', 'woven_panels'])
add('open_oval', 'oval', structure_system='post_beam', materials={'infill': 'MAT-PALM', 'cladding': 'MAT-PALM'}, details=['open_sides', 'ligatures', 'posts'])
add('coral', 'court_flat', structure_system='masonry', materials={'frame': 'MAT-CORAL', 'infill': 'MAT-CORAL', 'coating': 'MAT-PLASTER-LIME'}, details=['coral_joints', 'carved_door', 'passage_gate'])
add('axum', 'earth', layout='additive', footprint_family='FP-COMPLEX', allowed_footprints=['FP-COMPLEX'], bodies=[3, 5], floors=[2, 3], elevation_family='setback', materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR'}, details=['timber_bands', 'setbacks'])
add('stilt', 'forest', layout='platform', elevation_family='stilt', materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-BAMBOO', 'cladding': 'MAT-PALM'}, details=['raised_posts', 'stairs', 'veranda', 'water'])
add('small_stilt', 'stilt', width_m=[3, 5], depth_m=[3, 6], rooms_per_body=[1, 1], details=['raised_posts', 'ladder', 'ventilation'])
add('brick_court', 'court_flat', structure_system='masonry', materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK'}, details=['courtyard', 'drain', 'passage_gate'])
add('latérite', 'court_tile', materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR'}, roof_system='RF-EAVES', allowed_roofs=['RF-EAVES'], details=['wide_eaves', 'veranda', 'courtyard'])
add('himalaya', 'court_flat', width_m=[10, 16], depth_m=[10, 16], floors=[2, 3], materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'coating': 'MAT-PLASTER-LIME'}, details=['white_plaster', 'parapet', 'timber_bands'])
add('newar', 'strip', structure_system='post_beam', materials={'frame': 'MAT-WOOD-MORTISE', 'infill': 'MAT-BURNT-BRICK'}, floors=[2, 4], details=['carved_windows', 'brick_joints', 'party_walls'])
add('pavilion', 'timber', materials={'frame': 'MAT-WOOD-MORTISE', 'infill': 'MAT-BURNT-BRICK', 'cladding': 'MAT-TILE-CLAY'}, elevation_family='platform', roof_system='RF-EAVES', allowed_roofs=['RF-GABLE', 'RF-HIP', 'RF-EAVES'], roof_pitch_deg=[22, 38], details=['regular_bays', 'platform', 'wide_eaves'])
add('siheyuan', 'pavilion', layout='siheyuan', footprint_family='FP-COURT', allowed_footprints=['FP-COURT'], width_m=[22, 32], depth_m=[24, 36], bodies=[4, 4], details=['axial_gate', 'north_hall', 'courtyard', 'brick_enclosure'])
add('clan', 'siheyuan', layout='multiyard', footprint_family='FP-COMPLEX', allowed_footprints=['FP-COMPLEX'], width_m=[28, 40], depth_m=[48, 72], bodies=[8, 16], details=['successive_courts', 'axial_gates', 'north_hall'])
add('hanok', 'pavilion', layout='courtyard', footprint_family='FP-U', allowed_footprints=['FP-L', 'FP-U'], width_m=[18, 26], depth_m=[16, 24], bodies=[3, 3], details=['madang', 'ondol', 'stone_base', 'gallery'])
add('japan', 'forest', materials={'frame': 'MAT-WOOD-MORTISE', 'infill': 'MAT-WATTLE-DAUB', 'cladding': 'MAT-THATCH'}, details=['wood_floor', 'veranda', 'earth_floor_kitchen'])
add('shinden', 'pavilion', layout='siheyuan', elevation_family='stilt', bodies=[3, 5], width_m=[26, 40], depth_m=[26, 40], materials={'infill': 'MAT-REED', 'cladding': 'MAT-BARK'}, details=['connecting_galleries', 'raised_posts', 'movable_panels'])
add('samurai', 'japan', layout='kancha', width_m=[22, 32], depth_m=[22, 32], bodies=[3, 5], details=['enclosure', 'detached_annex', 'gate'])
add('multipav', 'pavilion', layout='additive', footprint_family='FP-COMPLEX', allowed_footprints=['FP-COMPLEX'], roof_system='RF-MULTIPAV', allowed_roofs=['RF-MULTIPAV'], floors=[2, 3], bodies=[3, 5], elevation_family='setback', details=['dougong', 'interlocking_roofs', 'gallery'])
add('tiered', 'pavilion', roof_system='RF-TIERED', allowed_roofs=['RF-TIERED'], floors=[2, 3], elevation_family='setback', details=['tiered_roofs', 'wide_eaves', 'platform'])
add('tulou', 'earth', layout='ring', footprint_family='FP-ELLIPTICAL-RING', allowed_footprints=['FP-ELLIPTICAL-RING', 'FP-COURT'], width_m=[36, 60], depth_m=[36, 60], bodies=[24, 48], floors=[3, 5], rooms_per_body=[1, 1], materials={'frame': 'MAT-RAMMED-EARTH', 'infill': 'MAT-RAMMED-EARTH', 'cladding': 'MAT-TILE-CLAY'}, roof_system='RF-HIP', allowed_roofs=['RF-HIP'], roof_pitch_deg=[25, 40], wall_thickness_m=[1, 1.8], details=['inhabited_ring', 'inner_gallery', 'single_gate', 'rammed_earth'])
add('long_stilt', 'stilt', footprint_family='FP-LONG', allowed_footprints=['FP-LONG'], width_m=[8, 12], depth_m=[32, 60], rooms_per_body=[8, 20], details=['raised_posts', 'continuous_veranda', 'bays', 'stairs'])
add('saddle', 'stilt', roof_system='RF-SADDLE', allowed_roofs=['RF-SADDLE'], width_m=[6, 10], depth_m=[12, 20], details=['carved_panels', 'saddle_ends', 'raised_posts', 'stairs'])
add('horns', 'saddle', width_m=[10, 16], depth_m=[18, 28], details=['multiple_horns', 'carved_panels', 'raised_posts'])
add('batak', 'saddle', roof_system='RF-CURVED', allowed_roofs=['RF-CURVED'], details=['projected_gables', 'carved_panels', 'raised_posts'])
add('joglo', 'pavilion', roof_system='RF-HIP', allowed_roofs=['RF-HIP'], width_m=[14, 22], depth_m=[14, 22], details=['four_master_posts', 'high_central_pyramid', 'open_sides'])
add('javanese_kampung', width_m=[4.5, 7.5], depth_m=[6, 11],
    materials={'frame': 'MAT-TIMBER-POST', 'roof_frame': 'MAT-TIMBER-POST', 'infill': 'MAT-BAMBOO', 'coating': '', 'cladding': 'MAT-TILE-CLAY'},
    roof_pitch_deg=[35, 45], overhang_m=[0.35, 0.6], wall_thickness_m=[0.12, 0.18], details=[])
add('javanese_limasan', 'javanese_kampung', width_m=[5, 8], depth_m=[9, 13],
    roof_system='RF-HIP', allowed_roofs=['RF-HIP'], roof_pitch_deg=[30, 40])
add('balinese', 'pavilion', layout='kancha', width_m=[20, 30], depth_m=[20, 30], bodies=[4, 8], materials={'infill': 'MAT-BAMBOO'}, details=['separate_pavilions', 'enclosure', 'family_shrine'])
add('shell', 'oval', roof_system='RF-SHELL', allowed_roofs=['RF-SHELL'], width_m=[6, 12], depth_m=[14, 24], details=['arcs', 'continuous_shell', 'low_entry'])
add('boat_shell', 'shell', width_m=[3, 5], depth_m=[16, 24], materials={'base': 'MAT-BASALT', 'cladding': 'MAT-REED'}, details=['boat_plan', 'basalt_base', 'low_entry'])
add('bark', 'timber', materials={'infill': 'MAT-BARK', 'coating': 'MAT-BARK', 'cladding': 'MAT-BARK'}, roof_system='RF-SHED', allowed_roofs=['RF-SHED', 'RF-THATCH-VAULT'], footprint_family='FP-OVAL', allowed_footprints=['FP-OVAL'], details=['open_sides', 'arcs'])
add('excavated', 'earth', layout='excavated', footprint_family='FP-ROCKCUT', allowed_footprints=['FP-ROCKCUT'], elevation_family='excavated', materials={'frame': 'MAT-ROCKCUT', 'infill': 'MAT-ROCKCUT', 'cladding': 'MAT-ROCKCUT'}, structure_system='rockcut', width_m=[16, 24], depth_m=[16, 24], bodies=[4, 8], details=['sunken_courtyard', 'cut_cells', 'entry_stairs'])
add('cliff', 'excavated', layout='cliff', width_m=[24, 40], depth_m=[8, 14], bodies=[4, 12], details=['rock_overhang', 'cliff_cells', 'gallery', 'ladder'])
add('yaodong', 'cliff', materials={'infill': 'MAT-ADOBE'}, details=['loess_cliff', 'vault_cells', 'entry_gallery'])
add('igloo', 'round', roof_system='RF-SNOW', allowed_roofs=['RF-SNOW'], structure_system='snow_shell', materials={'frame': 'MAT-ICE-SNOW', 'infill': 'MAT-ICE-SNOW', 'coating': 'MAT-ICE-SNOW', 'cladding': 'MAT-ICE-SNOW', 'roof_frame': 'MAT-ICE-SNOW'}, width_m=[3, 6], depth_m=[3, 6], details=['snow_blocks', 'entrance_tunnel', 'continuous_shell'], roof_pitch_deg=[0, 0])
add('earth_lodge', 'dome', materials={'infill': 'MAT-TURF', 'cladding': 'MAT-TURF'}, width_m=[8, 14], depth_m=[8, 14], elevation_family='sunken', details=['four_master_posts', 'earth_bank', 'vestibule'])
add('bark_long', 'long', roof_system='RF-THATCH-VAULT', allowed_roofs=['RF-THATCH-VAULT'], materials={'infill': 'MAT-BARK', 'cladding': 'MAT-BARK'}, structure_system='flexible_frame', details=['arcs', 'multiple_hearths', 'bays'])
add('pueblo', 'earth', layout='pueblo', footprint_family='FP-MULTICELL', allowed_footprints=['FP-MULTICELL'], elevation_family='terraced', width_m=[18, 28], depth_m=[14, 24], bodies=[8, 18], rooms_per_body=[1, 1], floors=[1, 3], details=['roof_access', 'ladders', 'setbacks', 'vigas'])
add('great_house', 'pueblo', layout='great_house', width_m=[70, 110], depth_m=[60, 95], bodies=[100, 300], floors=[2, 4], materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR'}, details=['hundreds_of_cells', 'great_court', 'roof_access', 'ladders'])
add('pithouse', 'turf', footprint_family='FP-OVAL', allowed_footprints=['FP-OVAL'], width_m=[5, 9], depth_m=[6, 10], details=['earth_bank', 'pit', 'roof_hatch', 'ladder'])
add('maya', 'oval', materials={'infill': 'MAT-WATTLE-DAUB', 'cladding': 'MAT-PALM'}, elevation_family='platform', details=['rounded_corners', 'limestone_base', 'patio'])
add('teotihuacan', 'multiyard', width_m=[36, 56], depth_m=[40, 60], bodies=[12, 24], materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-ADOBE', 'coating': 'MAT-PLASTER-LIME'}, details=['painted_plaster', 'multiple_households', 'successive_courts', 'drain'])
add('maya_palace', 'multiyard', materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'coating': 'MAT-PLASTER-LIME'}, details=['multiple_doors', 'galleries', 'courtyards', 'corbelled_vault'])
add('kancha', 'stone', layout='kancha', footprint_family='FP-COURT', allowed_footprints=['FP-COURT'], width_m=[22, 36], depth_m=[22, 34], bodies=[3, 8], rooms_per_body=[1, 2], materials={'cladding': 'MAT-THATCH'}, roof_pitch_deg=[35, 50], details=['trapezoidal_doors', 'stone_enclosure', 'separate_bodies'])
add('inca', 'stone', materials={'cladding': 'MAT-THATCH'}, roof_pitch_deg=[35, 50], details=['trapezoidal_doors', 'stone_joints'])
add('polygonal_inca', 'inca', materials={'frame': 'MAT-STONE-ASHLAR', 'infill': 'MAT-STONE-ASHLAR'}, details=['polygonal_joints', 'trapezoidal_doors'])
add('chimú', 'multiyard', details=['sculpted_earth', 'storerooms', 'successive_courts', 'high_walls'])
add('maloca', 'oval', width_m=[12, 20], depth_m=[24, 42], rooms_per_body=[4, 12], materials={'infill': 'MAT-PALM', 'cladding': 'MAT-PALM'}, roof_system='RF-SHELL', allowed_roofs=['RF-SHELL'], details=['multiple_hearths', 'large_posts', 'woven_panels'])
add('cedar_long', 'long', materials={'infill': 'MAT-WOOD-SHINGLES', 'coating': 'MAT-BARK', 'cladding': 'MAT-WOOD-SHINGLES'}, width_m=[10, 18], depth_m=[22, 40], details=['cedar_planks', 'large_posts', 'multiple_hearths', 'front_porch'])
add('cedar_additive', 'cedar_long', layout='additive', footprint_family='FP-COMPLEX', allowed_footprints=['FP-COMPLEX'], bodies=[3, 6], details=['cedar_planks', 'added_rooms', 'roof_steps'])
add('ruka', 'shell', width_m=[8, 14], depth_m=[16, 28], details=['communal_hall', 'woven_panels', 'hearth'])
add('platform', 'earth', footprint_family='FP-TERRACE', allowed_footprints=['FP-TERRACE'], roof_system='RF-STEP', allowed_roofs=['RF-STEP'], elevation_family='platform', details=['terraces', 'axial_stairs'])

# One explicit token per B ID, in numerical order within each pack.
# @ = domestic annex; + = spatial domestic component; ! = non-residential;
# ~ = landscape. Prestige and collective roles are resolved explicitly below.
ASSIGNMENTS = {
    'MED-ANT': 'masonry atrium peristyle insula court_tile !long !long court_flat !vault !round villa roman_shop_house roman_street_block',
    'ATL-CEL': 'round stone_round long stone_round @small_stilt strip shell tower @stone_round',
    'EUR-MED': 'timber strip jettied masonry market farm fortified tower arcade alpine redent long bridge',
    'EUR-NOR': 'long log turf_parallel @long @small_stilt !tiered dome tipi farm turf_parallel',
    'EUR-EAST': 'log timber masonry tower !masonry court_tile !masonry !masonry excavated !cliff',
    'AF-NILE': 'earth court_flat strip @round !multiyard vault !multiyard axum !platform !earth',
    'AF-MAG': 'earth court_flat peristyle stone earth_tower !court_flat @pueblo @round court_flat nomad excavated',
    'AS-MIDE': 'court_flat court_flat iwan court_flat !court_flat vault !court_flat !platform windtower market !iwan earth_tower earth_tower',
    'AS-STEP': 'yurt nomad earth court_flat !court_flat !round @stone yurt farm !pavilion',
    'AF-SAHEL': 'round court_flat sahel_compound earth iwan !court_flat @round dogon multiyard hut_compound musgum',
    'AF-WEST': 'forest_court forest_court long forest forest_multiyard timber forest_court @pavilion forest_court forest_multiyard',
    'AF-SOUTH': 'round +kraal stone_round dome hut_compound round ~earth forest @round ~round',
    'AF-EAST': 'round coral forest stone_round !excavated vault +kraal axum !court_flat open_oval ~tower !dome',
    'AS-IND': 'masonry brick_court court_tile stilt round !tower !platform !round !pavilion market ~excavated latérite multiyard',
    'AS-HIM': 'himalaya dogon newar alpine !tiered !multiyard !round tower tiered cliff !multiyard',
    'AS-CHI': 'pavilion siheyuan pavilion strip farm !tiered !pavilion stilt !tower yaodong clan +bridge tulou multipav',
    'AS-KOR': 'forest hanok open_oval !pavilion timber !tiered !tiered clan',
    'AS-JAP': 'japan japan shinden strip @small_stilt !tiered !pavilion !siheyuan samurai tiered strip !tower',
    'AS-SEA': 'stilt forest stilt court_tile stilt !tower !round !tower !siheyuan !tiered @small_stilt +stilt !small_stilt',
    'AS-ISL': 'stilt long_stilt saddle @saddle balinese joglo stilt !platform stilt horns batak !tiered !long javanese_kampung javanese_limasan',
    'OC-PAC': 'open_oval oval timber @small_stilt oval !long ~platform stilt shell boat_shell !long ~court_flat ~platform',
    'OC-AUS': 'bark dome stone_round ~earth ~round bark shell ~platform',
    'AM-ARC': 'tipi turf turf pithouse igloo turf bark @long @small_stilt turf',
    'AM-WOODS': 'dome bark_long tipi earth_lodge long !bark_long dome @small_stilt +kraal @dome',
    'AM-PUEB': 'earth pueblo great_house @pithouse cliff pithouse +court_flat tower @cliff pueblo',
    'AM-MISS': 'timber timber long ~platform +kraal ~round ~round @small_stilt ~platform',
    'AM-MESO': 'maya timber teotihuacan earth !platform !vault maya_palace ~earth !platform timber +masonry maya_palace +stilt',
    'AM-AND': 'inca kancha polygonal_inca long @round ~earth chimú ~platform !excavated +masonry !tower !platform ~platform',
    'AM-TROP': 'forest maloca round oval stilt shell ~earth open_oval +platform @small_stilt ~earth',
    'AS-SIB': 'tipi yurt log turf @small_stilt nomad log turf_parallel',
    'AM-PNW': 'cedar_long cedar_long turf @long +timber cedar_long @long cedar_additive',
    'AM-SOUTH': 'oval ruka long nomad dome @small_stilt bark !long',
}

# Pack era is a documented filter at the atlas's broad resolution, not a claim
# about the exact lifespan of a people. T profiles may be used in either era.
PACK_ERAS = {
    'MED-ANT': ['A'], 'ATL-CEL': ['A', 'M'], 'EUR-MED': ['M'],
    'EUR-NOR': ['M'], 'EUR-EAST': ['A', 'M'],
}
LATE_IDS = {'AS-MIDE-B13', 'AF-WEST-B10', 'AF-EAST-B12', 'AS-HIM-B11',
            'AS-CHI-B13', 'AS-JAP-B11', 'AS-JAP-B12', 'AS-ISL-B10', 'OC-PAC-B11'}
# Explicit cultural membership, independent from a settlement archetype or roof.
TRADITION_ASSIGNMENTS = {identifier: 'javanese' for identifier in ['AS-ISL-B06', 'AS-ISL-B14', 'AS-ISL-B15']}
TRADITION_ASSIGNMENTS['MED-ANT-B12'] = 'roman_urban'
TRADITION_ASSIGNMENTS['MED-ANT-B13'] = 'roman_urban'
JAVA_SOURCE = 'docs/sources/javanese-domestic-architecture_FR.md'
ROMAN_SOURCE = 'docs/sources/roman-compact-domestic-architecture_FR.md'
# Provenance and artistic defaults belong to a recipe, not to the generic
# inspired_only permission. Keep the two existing Java records byte-identical.
JAVA_INSPIRED_METADATA = dict(
    source=JAVA_SOURCE, level_height_m=2.8,
    parameter_note='Dimensions, pitch, eaves, wall thickness, room count and production weight are explicit artistic defaults; measured late buildings are examples, not universal ranges. See ' + JAVA_SOURCE + '. Simple closed dwelling: no emper, gallery, annex or extra household is implied.',
    temporal=dict(eras=[], tradition_long=True, late_only=False, from_year=None, to_year=None),
    chronology_note='Late documented examples; no ancient or medieval date is asserted. Inspired interpretation only; see ' + JAVA_SOURCE,
    chronology_confidence='undated_tradition',
)
INSPIRED_ONLY_RECIPES = {
    identifier: copy.deepcopy(JAVA_INSPIRED_METADATA)
    for identifier in ['AS-ISL-B14', 'AS-ISL-B15']
}
INSPIRED_ONLY_RECIPES['MED-ANT-B12'] = dict(
    source=ROMAN_SOURCE, level_height_m=2.8,
    parameter_note='Inspired compact Roman envelope: dimensions, two storeys, room count, roof shape/pitch, eaves, wall thickness and production weight are artistic defaults, not measured historical ranges. Shopfront adds a decorative panel and marks the first ground-floor room as Shop; this generic partition, separate commercial access, apartments and household capacity are not certified as a Roman functional programme. See ' + ROMAN_SOURCE + '.',
    temporal=dict(eras=['A'], tradition_long=False, late_only=False, from_year=None, to_year=None),
    chronology_note='Shop-and-upper-dwelling arrangements are documented in Imperial Roman contexts; this generated envelope has no exact archaeological date or measured dimensional range. Inspired interpretation only; see ' + ROMAN_SOURCE,
    chronology_confidence='broad_tradition',
    roof_confidence='uncertain',
)
INSPIRED_ONLY_RECIPES['MED-ANT-B13'] = {'source': 'docs/sources/roman-compact-domestic-architecture_FR.md',
 'level_height_m': 2.8,
 'parameter_note': 'Inspired compact Roman street block: all dimensional ranges, 2/3/4 storeys, 2.8m storey '
                   'height, room count, roof, rear court and lateral passage proportions are artistic/native '
                   'construction defaults, not archaeological measurements. Generic communal rooms and '
                   'internal stairs do not certify apartments, independent tenancy, households or '
                   'inhabitants. No automatic burgage infill, shopfront, gallery or multiple_households '
                   'programme is declared. See docs/sources/roman-compact-domestic-architecture_FR.md.',
 'temporal': {'eras': ['A'], 'tradition_long': False, 'late_only': False, 'from_year': None, 'to_year': None},
 'chronology_note': 'Imperial Roman multi-storey street dwellings are documented, including facade-lit and '
                    'court-lit examples; this generated block has no exact archaeological date or measured '
                    'dimensional range. Inspired interpretation only; see '
                    'docs/sources/roman-compact-domestic-architecture_FR.md',
 'chronology_confidence': 'broad_tradition',
 'roof_confidence': 'uncertain'}
INSPIRED_ONLY_IDS = set(INSPIRED_ONLY_RECIPES)
PRESTIGE_IDS = {'MED-ANT-B11', 'AS-IND-B13', 'AS-HIM-B09', 'AS-CHI-B14',
               'AS-JAP-B10', 'AM-MESO-B07', 'AM-MESO-B12', 'AF-WEST-B10',
               'AF-EAST-B06', 'AM-MISS-B02', 'AM-MISS-B03'}

# Region-specific variants; the same plan operator does not imply the same recipe.
OVERRIDES = {
    'ATL-CEL-B04': {'allowed_footprints': ['FP-ROUND', 'FP-OVAL', 'FP-RECT'], 'details': ['masonry_joints', 'party_walls', 'castro_cells']},
    'ATL-CEL-B08': {'layout': 'ring', 'footprint_family': 'FP-ELLIPTICAL-RING', 'bodies': [12, 20], 'floors': [2, 3], 'roof_system': 'RF-FLAT', 'allowed_roofs': ['RF-FLAT'], 'details': ['double_wall', 'internal_wall_stair', 'uncertain_roof']},
    'ATL-CEL-B09': {'roof_system': 'RF-DOME', 'allowed_roofs': ['RF-DOME'], 'materials': {'roof_frame': 'MAT-STONE-DRY', 'cladding': 'MAT-STONE-DRY'}, 'details': ['corbelled_dome']},
    'EUR-NOR-B01': {'materials': {'cladding': 'MAT-TURF'}, 'details': ['bays', 'central_aisle', 'multiple_hearths']},
    'EUR-NOR-B07': {'materials': {'cladding': 'MAT-BARK'}, 'details': ['arcs', 'low_entry', 'turf_bank']},
    'EUR-EAST-B03': {'roof_system': 'RF-FLAT', 'allowed_roofs': ['RF-FLAT'], 'roof_pitch_deg': [0, 0], 'materials': {'cladding': 'MAT-MUD-PLASTER'}, 'details': ['central_hearth', 'thick_stone_walls']},
    'EUR-EAST-B04': {'roof_system': 'RF-HIP', 'allowed_roofs': ['RF-HIP'], 'roof_pitch_deg': [25, 40], 'materials': {'cladding': 'MAT-SLATE'}, 'details': ['defensive_tower', 'stone_crown']},
    'AF-NILE-B03': {'structure_system': 'earth_wall', 'materials': {'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE', 'cladding': 'MAT-MUD-PLASTER'}, 'roof_system': 'RF-FLAT', 'allowed_roofs': ['RF-FLAT'], 'roof_pitch_deg': [0, 0], 'details': ['party_walls', 'repeated_cells', 'lightwell']},
    'AF-NILE-B04': {'roof_system': 'RF-DOME', 'allowed_roofs': ['RF-DOME'], 'structure_system': 'masonry', 'materials': {'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE', 'cladding': 'MAT-ADOBE', 'roof_frame': 'MAT-ADOBE'}, 'details': ['silo', 'loading_hatch']},
    'AF-NILE-B08': {'details': ['high_central_hall', 'roof_steps', 'courtyard']},
    'AF-MAG-B03': {'roof_system': 'RF-FLAT', 'allowed_roofs': ['RF-FLAT'], 'roof_pitch_deg': [0, 0], 'materials': {'cladding': 'MAT-MUD-PLASTER'}, 'details': ['garden', 'fountain', 'gallery', 'passage_gate']},
    'AF-MAG-B05': {'floors': [2, 4], 'details': ['regional_corner_turrets', 'parapet', 'thick_earth_walls']},
    'AF-MAG-B08': {'roof_system': 'RF-DOME', 'allowed_roofs': ['RF-DOME'], 'structure_system': 'earth_shell', 'materials': {'frame': 'MAT-COB', 'infill': 'MAT-COB', 'cladding': 'MAT-COB', 'roof_frame': 'MAT-COB'}, 'details': ['silo', 'earth_dome']},
    'AS-MIDE-B09': {'details': ['windcatcher', 'ventilation_channels', 'courtyard', 'passage_gate']},
    'AS-MIDE-B10': {'roof_system': 'RF-VAULT', 'allowed_roofs': ['RF-VAULT'], 'structure_system': 'masonry', 'materials': {'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK', 'cladding': 'MAT-BURNT-BRICK', 'roof_frame': 'MAT-BURNT-BRICK'}, 'roof_pitch_deg': [0, 0]},
    'AS-MIDE-B13': {'floors': [4, 7], 'details': ['white_plaster_bands', 'high_earth_tower', 'narrow_windows']},
    'AS-STEP-B08': {'width_m': [9, 14], 'depth_m': [9, 14], 'details': ['high_crown', 'decorated_felt', 'axial_entry']},
    'AF-SAHEL-B04': {'details': ['earth_buttresses', 'sculpted_facade', 'parapet']},
    'AF-SAHEL-B05': {'details': ['compartmented_court', 'earth_vaults', 'decorated_plaster', 'vestibule']},
    'AF-SAHEL-B07': {'width_m': [2, 4], 'depth_m': [2, 4], 'details': ['silo', 'ventilation', 'raised_base']},
    'AF-SAHEL-B09': {'details': ['large_vestibule', 'successive_courts', 'carved_posts']},
    'AF-SAHEL-B10': {'layout': 'hut_compound', 'bodies': [3, 8], 'details': ['mobile_oval_tents', 'livestock_pen', 'enclosure']},
    'AF-WEST-B01': {'footprint_family': 'FP-U', 'allowed_footprints': ['FP-L', 'FP-U'], 'bodies': [3, 3]},
    'AF-WEST-B06': {'details': ['geometric_relief', 'marked_entry', 'porch']},
    'AF-WEST-B07': {'layout': 'kancha', 'details': ['clan_enclosure', 'separate_pavilions', 'decorated_plaster']},
    'AF-WEST-B08': {'width_m': [3, 5], 'depth_m': [3, 5], 'details': ['domestic_shrine', 'posts']},
    'AF-WEST-B09': {'details': ['work_cells', 'open_work_yard', 'shed']},
    'AF-WEST-B10': {'materials': {'infill': 'MAT-COB'}, 'details': ['three_hierarchical_courts', 'polychrome_reliefs', 'high_enclosure']},
    'AF-SOUTH-B06': {'details': ['daga_walls', 'shared_space', 'terrace']},
    'AF-EAST-B01': {'details': ['veranda', 'single_door', 'stone_base']},
    'AF-EAST-B03': {'details': ['veranda', 'court', 'palm_roof']},
    'AF-EAST-B06': {'materials': {'frame': 'MAT-CORAL', 'infill': 'MAT-CORAL', 'cladding': 'MAT-CORAL', 'roof_frame': 'MAT-CORAL'}, 'details': ['coral_vault', 'lime_coating']},
    'AS-IND-B10': {'details': ['street_balcony', 'courtyard', 'lattice_windows', 'shopfront']},
    'AS-HIM-B02': {'materials': {'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-ADOBE'}, 'details': ['slope_terraces', 'retaining_walls', 'timber_bands']},
    'AS-HIM-B08': {'materials': {'cladding': 'MAT-MUD-PLASTER'}, 'details': ['massive_stone_tower', 'timber_bands', 'parapet']},
    'AS-HIM-B09': {'layout': 'courtyard', 'footprint_family': 'FP-U', 'allowed_footprints': ['FP-U'], 'bodies': [3, 3], 'details': ['carved_gallery', 'tiered_roofs', 'courtyard']},
    'AS-CHI-B01': {'elevation_family': 'ground', 'roof_system': 'RF-GABLE', 'details': ['regular_bays', 'grey_tiles', 'wide_eaves']},
    'AS-CHI-B03': {'details': ['dougong', 'regular_bays', 'platform', 'wide_eaves']},
    'AS-CHI-B05': {'materials': {'frame': 'MAT-RAMMED-EARTH', 'infill': 'MAT-RAMMED-EARTH', 'cladding': 'MAT-TILE-CLAY'}, 'details': ['farm_annex', 'courtyard', 'earth_walls']},
    'AS-CHI-B08': {'details': ['raised_posts', 'slope_platform', 'gallery', 'stairs']},
    'AS-KOR-B03': {'footprint_family': 'FP-RECT', 'allowed_footprints': ['FP-RECT'], 'roof_system': 'RF-EAVES', 'allowed_roofs': ['RF-EAVES'], 'materials': {'frame': 'MAT-WOOD-MORTISE', 'cladding': 'MAT-TILE-CLAY'}, 'elevation_family': 'platform', 'details': ['open_sides', 'stone_base', 'wide_eaves']},
    'AS-KOR-B05': {'roof_system': 'RF-HIP', 'allowed_roofs': ['RF-HIP'], 'details': ['ondol', 'insulated_rooms', 'courtyard']},
    'AS-KOR-B08': {'details': ['successive_courts', 'differentiated_gates', 'wood_galleries']},
    'AS-JAP-B03': {'details': ['central_pavilion', 'connecting_galleries', 'movable_panels', 'bark_roof']},
    'AS-JAP-B04': {'details': ['party_walls', 'front_shop_gallery', 'rear_yard', 'wood_panels']},
    'AS-SEA-B03': {'layout': 'kancha', 'bodies': [3, 5], 'roof_system': 'RF-GABLE', 'allowed_roofs': ['RF-GABLE'], 'details': ['shared_raised_platform', 'high_gables', 'stairs']},
    'AS-SEA-B04': {'details': ['long_hall', 'courtyard', 'farm_annex', 'tile_eaves']},
    'AS-SEA-B05': {'roof_system': 'RF-HIP', 'allowed_roofs': ['RF-HIP'], 'details': ['raised_posts', 'external_stair', 'light_panels']},
    'AS-SEA-B12': {'elevation_family': 'floating', 'details': ['floats', 'moorings', 'water', 'open_sides']},
    'AS-ISL-B01': {'roof_system': 'RF-GABLE', 'allowed_roofs': ['RF-GABLE'], 'roof_pitch_deg': [45, 60]},
    'AS-ISL-B04': {'width_m': [3, 5], 'depth_m': [5, 8], 'details': ['raised_posts', 'small_saddle', 'storage']},
    'AS-ISL-B09': {'roof_system': 'RF-CURVED', 'allowed_roofs': ['RF-CURVED'], 'details': ['oblique_large_posts', 'high_projected_gables', 'stairs']},
    'OC-PAC-B03': {'width_m': [4, 7], 'depth_m': [6, 10], 'details': ['front_porch', 'low_threshold', 'woven_panels']},
    'OC-PAC-B05': {'width_m': [10, 16], 'depth_m': [14, 22], 'details': ['chief_hall', 'woven_panels', 'high_hip']},
    'OC-AUS-B03': {'details': ['low_basalt_wall', 'uncertain_roof'], 'materials': {'frame': 'MAT-BASALT', 'infill': 'MAT-BASALT'}},
    'AM-ARC-B01': {'roof_system': 'RF-DOME', 'allowed_roofs': ['RF-DOME'], 'details': ['hide_membrane', 'bone_posts', 'seasonal']},
    'AM-ARC-B06': {'width_m': [12, 20], 'depth_m': [18, 28], 'details': ['pit', 'roof_hatch', 'ladder', 'driftwood_posts']},
    'AM-ARC-B10': {'footprint_family': 'FP-LONG', 'allowed_footprints': ['FP-LONG'], 'width_m': [10, 16], 'depth_m': [24, 40], 'details': ['multiple_entrance_tunnels', 'bays', 'driftwood_posts']},
    'AM-WOODS-B01': {'materials': {'infill': 'MAT-BARK', 'cladding': 'MAT-BARK'}, 'details': ['arcs', 'bark_panels', 'low_entry']},
    'AM-WOODS-B05': {'materials': {'infill': 'MAT-BARK', 'cladding': 'MAT-BARK'}, 'roof_pitch_deg': [15, 25], 'details': ['low_portico', 'bark_panels', 'multiple_hearths']},
    'AM-WOODS-B10': {'width_m': [2, 4], 'depth_m': [2, 4], 'materials': {'cladding': 'MAT-HIDE'}, 'details': ['sweat_lodge', 'temporary_shell']},
    'AM-PUEB-B05': {'materials': {'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'cladding': 'MAT-MUD-PLASTER'}, 'structure_system': 'masonry', 'details': ['rock_overhang', 'stone_cells', 'roof_access', 'ladders']},
    'AM-PUEB-B08': {'floors': [2, 3], 'materials': {'cladding': 'MAT-MUD-PLASTER'}, 'details': ['sandstone_tower', 'roof_access', 'vigas']},
    'AM-PUEB-B10': {'details': ['attached_kiva', 'central_roof_hatch', 'roof_access', 'ladders']},
    'AM-MISS-B02': {'elevation_family': 'platform', 'details': ['earth_mound', 'axial_ramp', 'posts']},
    'AM-MISS-B03': {'details': ['large_posts', 'portico', 'chief_hall']},
    'AM-MESO-B02': {'elevation_family': 'platform', 'materials': {'cladding': 'MAT-PALM'}, 'details': ['stone_earth_platform', 'stairs', 'light_panels']},
    'AM-MESO-B10': {'elevation_family': 'platform', 'materials': {'cladding': 'MAT-PALM'}, 'details': ['limestone_base', 'porch', 'posts']},
    'AM-MESO-B13': {'details': ['artificial_island', 'water', 'raised_posts', 'garden'], 'elevation_family': 'platform'},
    'AM-AND-B01': {'materials': {'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR'}, 'details': ['few_partitions', 'stone_base', 'thatch_gable']},
    'AM-AND-B04': {'width_m': [10, 16], 'depth_m': [36, 60], 'materials': {'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR'}, 'details': ['many_court_doors', 'large_timber_span', 'bays']},
    'AM-TROP-B03': {'materials': {'infill': 'MAT-PALM', 'cladding': 'MAT-PALM'}, 'details': ['single_door', 'palm_roof', 'posts']},
    'AM-TROP-B08': {'details': ['open_side', 'hammocks', 'arcs']},
    'AS-SIB-B01': {'details': ['long_poles', 'high_cone', 'seasonal']},
    'AS-SIB-B02': {'materials': {'infill': 'MAT-HIDE', 'cladding': 'MAT-HIDE'}, 'details': ['inner_insulated_tent', 'guy_ropes', 'large_frame']},
    'AS-SIB-B03': {'materials': {'cladding': 'MAT-BARK'}, 'details': ['log_corners', 'raised_base']},
    'AS-SIB-B07': {'materials': {'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-BARK'}, 'details': ['split_wood_panels', 'vestibule']},
    'AS-SIB-B08': {'elevation_family': 'excavated', 'details': ['excavated_cells', 'connecting_tunnels', 'earth_bank']},
    'AM-PNW-B03': {'materials': {'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-WOOD-SHINGLES'}, 'details': ['shallow_excavation', 'cedar_planks', 'communal_hall']},
    'AM-PNW-B06': {'details': ['painted_front', 'front_porch', 'cedar_planks']},
    'AM-SOUTH-B03': {'roof_system': 'RF-HIP', 'allowed_roofs': ['RF-HIP'], 'materials': {'cladding': 'MAT-PALM'}, 'details': ['bays', 'ligatures', 'communal_hall']},
    'AM-SOUTH-B04': {'roof_system': 'RF-SHED', 'allowed_roofs': ['RF-SHED'], 'details': ['hide_membrane', 'low_entry', 'seasonal']},
    'AM-SOUTH-B07': {'details': ['open_side', 'hide_membrane', 'shore_access']},
}

# Multiple permitted roles. MATs are never reduced to a single mutually exclusive enum.
MATERIAL_ROLES = {
    'WATTLE-DAUB': ['infill'], 'COB': ['load_bearing', 'infill', 'cladding'],
    'ADOBE': ['load_bearing', 'infill', 'cladding'], 'RAMMED-EARTH': ['load_bearing', 'infill'],
    'MUD-PLASTER': ['coating', 'cladding'], 'TIMBER-POST': ['frame', 'support', 'roof_frame'],
    'LOG': ['load_bearing', 'frame', 'infill', 'roof_frame'],
    'STONE-DRY': ['load_bearing', 'infill', 'base', 'roof_frame', 'cladding'],
    'STONE-MORTAR': ['load_bearing', 'infill', 'base', 'roof_frame'],
    'STONE-ASHLAR': ['load_bearing', 'infill', 'base', 'roof_frame'],
    'THATCH': ['cladding'], 'REED': ['infill', 'coating', 'cladding'],
    'TILE-CLAY': ['cladding'], 'WOOD-SHINGLES': ['infill', 'cladding'], 'SLATE': ['cladding'],
    'HALF-TIMBER': ['frame', 'roof_frame'], 'BURNT-BRICK': ['load_bearing', 'infill', 'roof_frame', 'cladding'],
    'BAMBOO': ['frame', 'support', 'infill', 'roof_frame'], 'PALM': ['infill', 'cladding'],
    'RAISED-POST': ['support'], 'PLASTER-LIME': ['coating'],
    'CORAL': ['load_bearing', 'infill', 'base', 'roof_frame', 'cladding'],
    'BASALT': ['load_bearing', 'infill', 'base'], 'BARK': ['infill', 'coating', 'cladding'],
    'FELT': ['infill', 'coating', 'cladding'], 'HIDE': ['infill', 'coating', 'cladding'],
    'TURF': ['infill', 'coating', 'cladding'], 'CHALK': ['load_bearing', 'infill', 'coating', 'base'],
    'SHELLSTONE': ['load_bearing', 'infill', 'base'], 'CLINKER': ['load_bearing', 'infill', 'base'],
    'ICE-SNOW': ['load_bearing', 'infill', 'coating', 'cladding', 'roof_frame', 'base'],
    'MEGALITH': ['load_bearing', 'support', 'base'], 'WOOD-MORTISE': ['frame', 'roof_frame'],
    'ROCKCUT': ['construction_mode', 'load_bearing', 'infill', 'cladding', 'roof_frame'],
    'DRIFTWOOD': ['frame', 'support', 'infill', 'roof_frame'],
}
for floor_material in ['COB', 'ADOBE', 'MUD-PLASTER', 'WOOD-SHINGLES', 'WOOD-MORTISE', 'TIMBER-POST', 'LOG', 'STONE-DRY', 'STONE-MORTAR']:
    MATERIAL_ROLES[floor_material].append('floor')

# Roles are independent of the reused plan operator. A platform can carry one
# dwelling, and a circular fence is never a ring of invented dwellings.
ROLE_CODES = dict(D='dwelling', E='residential_ensemble', C='communal_dwelling',
                  M='mixed_residential', A='domestic_annex', S='spatial_component',
                  N='non_domestic', L='landscape')
ROLE_ASSIGNMENTS = {
    'MED-ANT': 'D D D C D N N D N N M M C',
    'ATL-CEL': 'D D D E A D D D A',
    'EUR-MED': 'D D D D M E D D D D D D D',
    'EUR-NOR': 'C D E A A N D D E E',
    'EUR-EAST': 'D D D D N D N N D N',
    'AF-NILE': 'D D E A N D N D N N',
    'AF-MAG': 'D D D D D N A A D D D',
    'AS-MIDE': 'D D D D N D N N D M N D D',
    'AS-STEP': 'D D D D N N A D E N',
    'AF-SAHEL': 'D D E D D N A E D E D',
    'AF-WEST': 'D E S D D D E A M M',
    'AF-SOUTH': 'D S D D E E L D A L',
    'AF-EAST': 'D D D D N M S D N D L N',
    'AS-IND': 'D D D D D N N N N M L D M',
    'AS-HIM': 'D E D D N N N D M D N',
    'AS-CHI': 'D D D M E N N D N D E S E M',
    'AS-KOR': 'D D S N D N N E',
    'AS-JAP': 'D D D M A N N N D M M N',
    'AS-SEA': 'D D E E D N N N N N A S N',
    'AS-ISL': 'D C D A E D D N D D D N N D D',
    'OC-PAC': 'D D D A D N L D D D N L L',
    'OC-AUS': 'D D D L L D D L',
    'AM-ARC': 'D D D D D C D A A C',
    'AM-WOODS': 'D C D D C N D A S A',
    'AM-PUEB': 'D E E N E D S D A E',
    'AM-MISS': 'D M M L S L L A L',
    'AM-MESO': 'D D E D N N M L N D S M E',
    'AM-AND': 'D E D S A L E L N S N N L',
    'AM-TROP': 'D C D D D C L D S A L',
    'AS-SIB': 'D D D D A D D E',
    'AM-PNW': 'C C D A S D A E',
    'AM-SOUTH': 'D C C D D A D N',
}

# One authored local context per B entry (including excluded entries). These are
# references for an isolated building bench, not a claim to generate a city.
CONTEXT_ASSIGNMENTS = {
    'MED-ANT': '03:GRID 03:GRID 03:GRID 03:GRID 01:IRREGULAR 01:IRREGULAR 03:GRID 06:COASTAL 03:GRID 01:IRREGULAR 08:DISPERSED 04:LINEAR 03:GRID',
    'ATL-CEL': '01:CLUSTER 01:CLUSTER 01:DISPERSED 03:HILL 01:DISPERSED 02:WALLED 07:COASTAL 08:HILL 06:TERRACE',
    'EUR-MED': '01:NUCLEATED 02:LINEAR 03:IRREGULAR 01:NUCLEATED 02:LINEAR 01:DISPERSED 05:WALLED 09:VERTICAL 08:LINEAR 06:TERRACE 03:IRREGULAR 07:LINEAR 02:RIVER',
    'EUR-NOR': '01:DISPERSED 05:LINEAR 03:COMPOUND 02:COASTAL 05:DISPERSED 01:NUCLEATED 06:NOMAD 06:NOMAD 05:COMPOUND 03:COMPOUND',
    'EUR-EAST': '01:DISPERSED 02:NUCLEATED 05:TERRACE 08:VERTICAL 03:HILL 03:IRREGULAR 04:HILL 04:HILL 07:CLIFF 07:CLIFF',
    'AF-NILE': '01:RIVER 01:COURTYARDS 02:GRID 05:RIVER 03:CEREMONIAL 04:WALLED 06:NUCLEATED 01:COURTYARDS 08:TERRESTRIAL-RITUAL 08:TERRESTRIAL-RITUAL',
    'AF-MAG': '01:COURTYARDS 03:IRREGULAR 03:COURTYARDS 04:TERRACE 02:VERTICAL 03:IRREGULAR 07:COMPOUND 06:OASIS 03:COURTYARDS 08:NOMAD 09:SUBTERRANEAN',
    'AS-MIDE': '03:IRREGULAR 01:COURTYARDS 07:COURTYARDS 03:COURTYARDS 05:COMPOUND 06:NUCLEATED 04:IRREGULAR 02:CEREMONIAL 10:COURTYARDS 04:LINEAR 07:COURTYARDS 09:VERTICAL 11:VERTICAL',
    'AS-STEP': '01:NOMAD 02:NOMAD 04:OASIS 03:OASIS 06:COMPOUND 03:OASIS 07:TERRACE 02:NOMAD 07:TERRACE 03:OASIS',
    'AF-SAHEL': '01:COURTYARDS 03:IRREGULAR 01:COMPOUND 02:RIVER 04:COURTYARDS 03:IRREGULAR 01:COMPOUND 06:TERRACE 04:COURTYARDS 05:NOMAD 09:CLUSTER',
    'AF-WEST': '01:COURTYARDS 02:COMPOUND 04:NUCLEATED 04:DISPERSED 03:MULTICORE 07:COMPOUND 06:COMPOUND 01:COURTYARDS 05:COMPOUND 08:COURTYARDS',
    'AF-SOUTH': '01:CIRCULAR 01:PASTORAL 06:CLUSTER 02:CIRCULAR 03:COMPOUND 05:TERRACE 04:CIRCULAR 07:DISPERSED 03:COMPOUND 09:CIRCULAR',
    'AF-EAST': '05:DISPERSED 02:COASTAL 03:COASTAL 04:TERRACE 08:HILL 09:COASTAL 06:PASTORAL 07:AXIAL 02:COASTAL 01:DISPERSED 07:CEREMONIAL 10:COURTYARDS',
    'AS-IND': '01:COURTYARDS 02:GRID 01:COURTYARDS 06:WATER-STILT 01:CLUSTER 05:CEREMONIAL 04:CEREMONIAL 08:CEREMONIAL 04:CEREMONIAL 03:LINEAR 11:SUBTERRANEAN 10:COMPOUND 09:COURTYARDS',
    'AS-HIM': '02:TERRACE 01:TERRACE 03:LINEAR 05:DISPERSED 03:CEREMONIAL 04:HILL 04:CEREMONIAL 07:VERTICAL 03:COURTYARDS 01:CLIFF 08:NESTED-CITADEL',
    'AS-CHI': '01:COURTYARDS 01:COURTYARDS 03:NUCLEATED 04:LINEAR 01:COMPOUND 02:AXIAL 02:AXIAL 07:WATER-STILT 03:WALLED 08:CLIFF 10:COMPOUND 04:CANAL 11:MEGAHOUSE 12:AXIAL',
    'AS-KOR': '01:COURTYARDS 01:COURTYARDS 04:TERRACE 05:HILL 01:COURTYARDS 06:AXIAL 05:CEREMONIAL 06:COURTYARDS',
    'AS-JAP': '01:DISPERSED 06:COMPOUND 02:AXIAL 04:LINEAR 01:COMPOUND 03:CEREMONIAL 07:CEREMONIAL 03:COURTYARDS 08:COMPOUND 08:AXIAL 04:LINEAR 09:VERTICAL',
    'AS-SEA': '01:WATER-STILT 09:DISPERSED 01:COMPOUND 06:COURTYARDS 05:WATER-STILT 03:AXIAL 04:CEREMONIAL 07:CEREMONIAL 08:COURTYARDS 08:AXIAL 01:COMPOUND 05:FLOATING 08:COURTYARDS',
    'AS-ISL': '01:WATER-STILT 02:MEGAHOUSE 03:LINEAR 03:LINEAR 04:COMPOUND 05:COURTYARDS 06:RIVER 07:AXIAL 08:LINEAR 12:LINEAR 09:HILL 04:CEREMONIAL 11:MEGAHOUSE 05:COURTYARDS 05:COURTYARDS',
    'OC-PAC': '01:COASTAL 01:COASTAL 05:CLUSTER 04:HILL 11:NUCLEATED 06:CEREMONIAL 07:CEREMONIAL 03:WATER-STILT 02:CLUSTER 08:COMPOUND 09:CEREMONIAL 10:ISLANDS 11:CEREMONIAL',
    'OC-AUS': '01:DISPERSED 01:CLUSTER 04:CLUSTER 03:RIVER 08:RIVER 06:DISPERSED 05:COASTAL 01:TERRESTRIAL-RITUAL',
    'AM-ARC': '01:NOMAD 02:CLUSTER 08:COASTAL 07:CLUSTER 04:ICE 03:MEGAHOUSE 05:RIVER 03:COASTAL 05:RIVER 06:MEGAHOUSE',
    'AM-WOODS': '01:DISPERSED 02:COMPOUND 04:NOMAD 05:CIRCULAR 06:MEGAHOUSE 08:NUCLEATED 07:NOMAD 02:COMPOUND 03:WALLED 01:TERRESTRIAL-RITUAL',
    'AM-PUEB': '01:TERRACE 04:TERRACE 02:MEGAHOUSE 08:CEREMONIAL 03:CLIFF 07:SUBTERRANEAN 05:COURTYARDS 04:VERTICAL 03:CLIFF 08:TERRACE',
    'AM-MISS': '01:NUCLEATED 02:MOUND 02:MOUND 02:MOUND 04:WALLED 02:TERRESTRIAL-RITUAL 05:CEREMONIAL 03:COMPOUND 07:MOUND',
    'AM-MESO': '06:DISPERSED 01:COMPOUND 03:GRID 07:IRREGULAR 02:CEREMONIAL 02:CEREMONIAL 09:COURTYARDS 10:CEREMONIAL 05:AXIAL 06:COMPOUND 09:COURTYARDS 09:COURTYARDS 05:LAKE',
    'AM-AND': '01:TERRACE 02:COURTYARDS 03:TERRACE 10:NUCLEATED 09:DISPERSED 09:TERRACE 05:NESTED-CITADEL 02:CEREMONIAL 06:CEREMONIAL 03:TERRACE 01:TERRESTRIAL-RITUAL 06:AXIAL 07:MOUND',
    'AM-TROP': '01:NUCLEATED 03:MEGAHOUSE 06:RADIAL 06:RADIAL 05:WATER-STILT 02:CIRCULAR 06:CEREMONIAL 08:DISPERSED 07:MOUND 04:RIVER 10:CLUSTER',
    'AS-SIB': '01:NOMAD 02:NOMAD 04:RIVER 03:COASTAL 06:DISPERSED 05:NOMAD 04:DISPERSED 07:SUBTERRANEAN',
    'AM-PNW': '01:COASTAL 05:MEGAHOUSE 03:COASTAL 04:COASTAL 02:COASTAL 02:COASTAL 03:COASTAL 05:COMPOUND',
    'AM-SOUTH': '01:DISPERSED 02:MEGAHOUSE 03:MEGAHOUSE 04:NOMAD 07:COASTAL 05:RIVER 06:COASTAL 08:CEREMONIAL',
}

LOT_BY_LAYOUT = dict(single='LOT-COMPOUND', strip='LOT-STRIP', courtyard='LOT-CENTRAL-YARD',
    high_hall='LOT-COMPOUND',
                     atrium='LOT-ATRIUM', peristyle='LOT-PERISTYLE', iwan_court='LOT-CENTRAL-YARD',
                     siheyuan='LOT-SIHEYUAN', kancha='LOT-KANCHA', hut_compound='LOT-COMPOUND',
                     kraal='LOT-KRAAL', multiyard='LOT-MULTIYARD', pueblo='LOT-BLOCK',
                     great_house='LOT-CELLULAR', ring='LOT-RING', cliff='LOT-CLIFF',
                     excavated='LOT-CLIFF', platform='LOT-PLATFORM', parallel='LOT-COMPOUND',
                     bridge='LOT-COMPOUND', additive='LOT-COMPOUND', broch='LOT-RING', shinden='LOT-COMPOUND')

# Geometry traits form a finite registry. Source adjectives and uncertainty are
# preserved separately in notes; new geometry cannot be activated by free prose.
TRAIT_GROUPS = {
    'access': 'axial_entry axial_gate axial_gates axial_ramp axial_stairs connecting_corridor connecting_galleries connecting_tunnels continuous_veranda differentiated_gates entrance_tunnel entry_gallery entry_stairs exterior_stair external_stair front_porch front_shop_gallery galleries gallery gate inner_gallery internal_wall_stair ladder ladders loading_hatch low_entry low_threshold many_court_doors marked_entry multiple_doors multiple_entrance_tunnels passage_gate porch portico roof_access roof_hatch central_roof_hatch shore_access side_corridor single_door single_gate stair stair_tower stairs trapezoidal_doors veranda vestibule wood_galleries',
    'layout': 'added_rooms artificial_island attached_kiva atrium barn bays boat_plan byre castro_cells central_aisle central_pavilion cliff_cells compartmented_court court courtyard courtyards cut_cells detached_annex farm_annex few_partitions great_court hundreds_of_cells inhabited_ring iwans large_vestibule lightwell livestock_pen long_hall madang mixed_round_square mobile_oval_tents multiple_households north_hall open_work_yard patio peripheral_huts pit rear_yard repeated_cells round_granary separate_bodies separate_pavilions shared_space shared_yard silo storerooms successive_courts sunken_courtyard three_hierarchical_courts work_cells yard',
    'walls': 'brick_enclosure clan_enclosure daga_walls double_wall earth_buttresses earth_enclosure earth_ribs enclosure high_enclosure high_walls narrow_windows open_side open_sides party_walls regional_corner_turrets stone_enclosure thick_earth_walls thick_stone_walls thick_walls',
    'roof': 'bark_roof continuous_shell coral_vault corbelled_dome corbelled_vault crown earth_dome earth_vaults high_central_hall high_central_pyramid high_cone high_crown high_gables high_hip high_projected_gables impluvium interlocking_roofs inward_roof multiple_horns ogival_shell palm_roof parapet projected_gables roof_steps saddle_ends scupper shed small_saddle smoke_flaps stepped_gable stone_crown thatch_gable tiered_roofs tile_eaves turf_gables vault_abutments vault_cells wide_eaves windcatcher',
    'support': 'arcs arches bone_posts bridge_piers columns dougong driftwood_posts exposed_frame floats four_master_posts guy_ropes large_frame large_posts lattice ligatures log_corners long_poles moorings oblique_large_posts poles posts raised_posts regular_bays timber_bands vigas',
    'elevation': 'basalt_base defensive_tower earth_bank earth_floor_kitchen earth_mound high_earth_tower jetty limestone_base loess_cliff low_basalt_wall massive_stone_tower platform raised_base retaining_walls rock_overhang sandstone_tower setbacks shallow_excavation shared_raised_platform slope_platform slope_terraces stone_base stone_cells stone_earth_platform stone_ground_floor terrace terraces turf_bank wood_floor',
    'fittings': 'arcade central_hearth covered_gallery domestic_shrine drain family_shrine fountain garden hearth insulated_rooms lattice_windows multiple_hearths ondol shopfront ventilation ventilation_channels water well',
    'surface': 'bark_panels brick_joints carved_door carved_gallery carved_panels carved_posts carved_windows cedar_planks coral_joints decorated_plaster geometric_relief grey_tiles light_panels lime_coating masonry_joints movable_panels painted_front painted_plaster polychrome_reliefs polygonal_joints rammed_earth sculpted_earth sculpted_facade snow_blocks split_wood_panels sweat_lodge white_plaster white_plaster_bands wood_panels woven_panels',
}
TRAITS = {trait: operator for operator, tokens in TRAIT_GROUPS.items() for trait in tokens.split()}
TRAITS.update(excavated_cells='layout', inner_insulated_tent='layout', low_portico='access',
              rounded_corners='layout', street_balcony='elevation')
NOTES = set('chief_hall communal_hall decorated_felt earth_walls hammocks hide_membrane large_timber_span seasonal storage temporary_shell uncertain_roof'.split())

COMPONENT_KINDS = {
    'AF-WEST-B03': 'open_community_hall', 'AF-SOUTH-B02': 'livestock_enclosure',
    'AF-EAST-B07': 'livestock_enclosure', 'AS-CHI-B12': 'covered_bridge',
    'AS-KOR-B03': 'open_pavilion', 'AS-SEA-B12': 'floating_hall',
    'AM-WOODS-B09': 'palisade', 'AM-PUEB-B07': 'open_court',
    'AM-MISS-B05': 'palisade', 'AM-MESO-B11': 'puuc_facade',
    'AM-AND-B04': 'assembly_hall', 'AM-AND-B10': 'prestige_wall',
    'AM-TROP-B09': 'earth_platform', 'AM-PNW-B05': 'windbreak',
    'AM-ARC-B08': 'drying_rack',
}

CORRECTIONS = {
    'MED-ANT-B05': dict(materials={'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE'}, structure_system='earth_wall'),
    'MED-ANT-B08': dict(materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'coating': 'MAT-PLASTER-LIME'}, structure_system='masonry'),
    'MED-ANT-B11': dict(layout='courtyard'),
    'ATL-CEL-B04': dict(layout='additive', bodies=[3, 6], width_m=[16, 24], depth_m=[14, 22], details=['castro_cells', 'party_walls', 'masonry_joints']),
    'ATL-CEL-B05': dict(roof_system='RF-GABLE', materials={'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-THATCH'}),
    'ATL-CEL-B06': dict(materials={'cladding': 'MAT-THATCH'}),
    'ATL-CEL-B07': dict(materials={'cladding': 'MAT-REED'}),
    'ATL-CEL-B08': dict(layout='broch', footprint_family='FP-ROUND', bodies=[1, 1], width_m=[15, 20], depth_m=[15, 20], rooms_per_body=[1, 3], details=['double_wall', 'internal_wall_stair', 'uncertain_roof']),
    'EUR-MED-B11': dict(materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK'}),
    'EUR-NOR-B04': dict(roof_pitch_deg=[15, 25], materials={'cladding': 'MAT-WOOD-SHINGLES'}, rooms_per_body=[1, 1], details=['open_sides', 'shore_access', 'multiple_doors']),
    'EUR-NOR-B05': dict(roof_system='RF-GABLE', materials={'frame': 'MAT-LOG', 'infill': 'MAT-LOG', 'cladding': 'MAT-WOOD-SHINGLES'}, structure_system='log', details=['raised_posts', 'log_corners', 'loading_hatch']),
    'EUR-NOR-B09': dict(materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-WATTLE-DAUB', 'coating': 'MAT-MUD-PLASTER', 'cladding': 'MAT-THATCH'}, structure_system='post_beam', roof_pitch_deg=[35, 55]),
    'EUR-EAST-B09': dict(layout='cliff', details=['cliff_cells', 'entry_stairs', 'rock_overhang']),
    'AF-NILE-B01': dict(layout='courtyard', footprint_family='FP-U', width_m=[10, 16], depth_m=[12, 18], bodies=[3, 3], details=['courtyard', 'party_walls', 'passage_gate', 'parapet']),
    'AF-NILE-B03': dict(layout='additive', bodies=[4, 8], width_m=[24, 36], depth_m=[16, 24]),
    'AF-NILE-B08': dict(layout='additive', footprint_family='FP-COMPLEX', bodies=[3, 5], materials={'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE'}, structure_system='earth_wall'),
    'AF-MAG-B07': dict(materials={'frame': 'MAT-STONE-DRY', 'infill': 'MAT-STONE-DRY'}, structure_system='masonry', rooms_per_body=[1, 1], details=['stone_cells', 'enclosure', 'roof_access', 'ladders']),
    'AS-MIDE-B04': dict(materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'coating': 'MAT-PLASTER-LIME'}, structure_system='masonry'),
    'AS-MIDE-B13': dict(footprint_family='FP-RECT', width_m=[5, 7], depth_m=[8, 12]),
    'AS-STEP-B09': dict(materials={'frame': 'MAT-RAMMED-EARTH', 'infill': 'MAT-RAMMED-EARTH', 'coating': 'MAT-MUD-PLASTER', 'cladding': 'MAT-MUD-PLASTER'}, structure_system='earth_wall', roof_system='RF-FLAT', roof_pitch_deg=[0, 0]),
    'AF-SAHEL-B05': dict(materials={'frame': 'MAT-COB', 'infill': 'MAT-COB', 'roof_frame': 'MAT-COB', 'coating': 'MAT-MUD-PLASTER'}, structure_system='earth_wall'),
    'AF-SAHEL-B07': dict(materials={'frame': 'MAT-COB', 'infill': 'MAT-COB'}, structure_system='earth_wall'),
    'AF-SAHEL-B10': dict(footprint_family='FP-COMPLEX', roof_system='RF-SADDLE', structure_system='flexible_frame', materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-REED', 'coating': 'MAT-REED', 'cladding': 'MAT-REED'}, roof_pitch_deg=[25, 40], rooms_per_body=[1, 1]),
    'AF-SAHEL-B11': dict(materials={'roof_frame': 'MAT-COB', 'coating': 'MAT-MUD-PLASTER'}, roof_pitch_deg=[0, 0]),
    'AF-WEST-B08': dict(materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-COB', 'coating': 'MAT-MUD-PLASTER', 'cladding': 'MAT-THATCH'}, roof_system='RF-GABLE', roof_pitch_deg=[35, 50], rooms_per_body=[1, 1], details=['domestic_shrine', 'posts']),
    'AF-SOUTH-B09': dict(width_m=[2.5, 4], depth_m=[2.5, 4], elevation_family='stilt', materials={'frame': 'MAT-COB', 'infill': 'MAT-COB'}, structure_system='earth_wall'),
    'AF-SOUTH-B06': dict(layout='additive', bodies=[2, 4], width_m=[10, 16], depth_m=[12, 18]),
    'AF-EAST-B10': dict(layout='single', footprint_family='FP-OVAL', roof_system='RF-REED-HIP', materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-WATTLE-DAUB', 'cladding': 'MAT-THATCH'}, structure_system='post_beam', floors=[1, 1], roof_pitch_deg=[35, 55], details=['open_sides', 'posts', 'wide_eaves']),
    'AS-IND-B10': dict(layout='courtyard', footprint_family='FP-U', width_m=[12, 18], depth_m=[16, 22], bodies=[3, 3]),
    'AS-IND-B05': dict(materials={'frame': 'MAT-COB', 'infill': 'MAT-COB', 'roof_frame': 'MAT-BAMBOO'}, structure_system='earth_wall'),
    'AS-CHI-B02': dict(roof_system='RF-GABLE'),
    'AS-CHI-B12': dict(materials={'frame': 'MAT-WOOD-MORTISE', 'infill': 'MAT-WOOD-SHINGLES', 'coating': 'MAT-BARK', 'roof_frame': 'MAT-WOOD-MORTISE'}, structure_system='post_beam', details=['bridge_piers', 'regular_bays', 'wide_eaves', 'water']),
    'AS-JAP-B03': dict(layout='shinden', footprint_family='FP-COMPLEX', bodies=[3, 5], details=['central_pavilion', 'connecting_galleries', 'movable_panels', 'bark_roof', 'garden']),
    'AS-JAP-B05': dict(materials={'infill': 'MAT-WOOD-SHINGLES'}),
    'AS-SEA-B01': dict(materials={'cladding': 'MAT-THATCH'}),
    'AS-SEA-B02': dict(materials={'frame': 'MAT-BAMBOO', 'infill': 'MAT-BAMBOO', 'roof_frame': 'MAT-BAMBOO', 'cladding': 'MAT-PALM'}),
    'AS-SEA-B04': dict(layout='kancha', footprint_family='FP-COURT', bodies=[3, 5], width_m=[22, 32], depth_m=[20, 28], details=['long_hall', 'courtyard', 'farm_annex', 'tile_eaves']),
    'AS-ISL-B07': dict(roof_system='RF-GABLE'),
    'OC-PAC-B02': dict(materials={'cladding': 'MAT-PALM'}),
    'OC-PAC-B04': dict(roof_system='RF-GABLE', materials={'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-THATCH'}),
    'OC-AUS-B06': dict(footprint_family='FP-RECT', roof_system='RF-GABLE', materials={'cladding': 'MAT-THATCH'}, details=['open_side', 'posts', 'porch']),
    'AM-ARC-B09': dict(materials={'frame': 'MAT-DRIFTWOOD', 'infill': 'MAT-DRIFTWOOD', 'roof_frame': 'MAT-DRIFTWOOD', 'cladding': 'MAT-BARK'}),
    'AM-WOODS-B08': dict(materials={'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-BARK'}),
    'AM-MISS-B08': dict(roof_system='RF-GABLE', materials={'infill': 'MAT-WATTLE-DAUB', 'cladding': 'MAT-THATCH'}),
    'AM-AND-B05': dict(materials={'frame': 'MAT-STONE-DRY', 'infill': 'MAT-STONE-DRY'}, structure_system='masonry', details=['ventilation', 'single_door']),
    'AM-PUEB-B05': dict(footprint_family='FP-MULTICELL', structure_system='masonry', elevation_family='terraced', materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'cladding': 'MAT-MUD-PLASTER', 'roof_frame': 'MAT-TIMBER-POST'}),
    'AM-PUEB-B09': dict(bodies=[1, 1], floors=[1, 1], width_m=[4, 7], depth_m=[5, 8], rooms_per_body=[1, 1], footprint_family='FP-RECT', structure_system='masonry', materials={'frame': 'MAT-STONE-DRY', 'infill': 'MAT-STONE-DRY', 'cladding': 'MAT-MUD-PLASTER', 'roof_frame': 'MAT-TIMBER-POST'}),
    'AM-MISS-B02': dict(elevation_family='platform', details=['earth_mound', 'platform', 'posts', 'hearth']),
    'AM-MESO-B04': dict(layout='courtyard', footprint_family='FP-U', bodies=[3, 3], width_m=[12, 18], depth_m=[14, 20], details=['party_walls', 'patio', 'passage_gate']),
    'AM-MESO-B13': dict(layout='kancha', bodies=[3, 5], width_m=[24, 36], depth_m=[24, 36], details=['artificial_island', 'water', 'garden', 'separate_bodies']),
    'AS-SIB-B05': dict(roof_system='RF-GABLE', materials={'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-BARK'}),
    'AM-PNW-B03': dict(roof_system='RF-GABLE', roof_pitch_deg=[10, 20], elevation_family='sunken'),
    'AM-PNW-B04': dict(materials={'cladding': 'MAT-WOOD-SHINGLES', 'infill': 'MAT-WOOD-SHINGLES'}, roof_pitch_deg=[10, 25], rooms_per_body=[1, 1], details=['open_sides', 'posts', 'shore_access']),
    'AM-PNW-B07': dict(materials={'cladding': 'MAT-WOOD-SHINGLES', 'infill': 'MAT-WOOD-SHINGLES'}, roof_pitch_deg=[10, 20], rooms_per_body=[1, 1], details=['open_sides', 'posts', 'shore_access']),
    'AM-SOUTH-B06': dict(roof_system='RF-GABLE', materials={'infill': 'MAT-WOOD-SHINGLES', 'cladding': 'MAT-THATCH'}),
}


def apply_parameters(data, changes):
    for field, value in changes.items():
        if field == 'materials':
            data[field].update(copy.deepcopy(value))
        else:
            data[field] = copy.deepcopy(value)


def component(identifier, parent, role='dwelling', count=(1, 1), placement='main',
              size=(0.25, 0.4), depth_size=None, **changes):
    data = copy.deepcopy(PROFILES[parent])
    apply_parameters(data, changes)
    access = 'exterior_stair' if data['elevation_family'] == 'stilt' else 'internal_stair' if data['floors'][1] > 1 else 'none'
    support = dict(kind='posts', material='MAT-RAISED-POST', height_m=[1.2, 2.5]) if data['elevation_family'] == 'stilt' else dict(kind='ground', material=None, height_m=[0, 0])
    return dict(id=identifier, role=role, count=list(count), placement=placement,
                width_ratio=list(size), depth_ratio=list(depth_size or size),
                footprint_family=data['footprint_family'], roof_system=data['roof_system'],
                roof_spec=roof_spec(data['roof_system']), roof_pitch_deg=data['roof_pitch_deg'],
                overhang_m=data['overhang_m'],
                materials=data['materials'], structure_system=data['structure_system'],
                envelope=changes.get('envelope', 'walled'), floors=data['floors'], level_height_m=level_height(data),
                rooms_per_body=data['rooms_per_body'],
                vertical_access=access, vertical_routes=routes(access, data['floors'][1]),
                support=support, level_materials=[], wall_thickness_m=data['wall_thickness_m'],
                courtyard_ratio=data['courtyard_ratio'])


def routes(kind, floors):
    if kind == 'none':
        return []
    placement = 'peripheral' if kind in ['exterior_stair', 'ladder'] else 'main'
    return [dict(kind=kind, from_level=level, to_level=level + 1, placement=placement,
                 min_width_m=0.65 if kind in ['ladder', 'roof_hatch'] else 0.9)
            for level in range(max(1, floors - 1))]


# Source descriptions do not provide measured dimensions. These declared
# graphic ranges reserve whole rooms and native stair runs after walls and
# setbacks for the full unchanged programme, including variation=.65 batches.
BATCH_DIMENSION_DEFAULTS = {
    'AF-NILE-B08': dict(width_m=[26,36], depth_m=[24,36]),
    'AF-WEST-B05': dict(width_m=[38,48], depth_m=[56,72]),
    'AF-WEST-B10': dict(width_m=[38,48], depth_m=[56,72]),
    'AF-EAST-B08': dict(width_m=[50,65], depth_m=[20,28]),
    'AS-CHI-B14': dict(width_m=[30,40], depth_m=[20,28]),
    'AM-AND-B07': dict(width_m=[48,60], depth_m=[72,90]),
}


def complete_parameters(identifier, data, role):
    apply_parameters(data, BATCH_DIMENSION_DEFAULTS.get(identifier, {}))
    if identifier in {'AF-NILE-B04', 'AF-MAG-B08'}:
        dimensions = [14, 18] if identifier == 'AF-NILE-B04' else [22, 28]
        data.update(layout='hut_compound', footprint_family='FP-CLUSTER-ROUND',
                    bodies=[3, 5], floors=[1, 1], rooms_per_body=[1, 1],
                    width_m=dimensions, depth_m=dimensions)
    if identifier == 'EUR-MED-B04':
        data['overhang_m'] = [0, 0]
        if 'front_porch' not in data['details']:
            data['details'].append('front_porch')
    # Remove inherited specifics not justified by either primary source.
    unsupported = {
        'AS-JAP-B01': ['wood_floor', 'earth_floor_kitchen'],
        'AS-JAP-B02': ['earth_floor_kitchen'],
        'EUR-NOR-B08': ['guy_ropes'], 'AS-STEP-B01': ['guy_ropes'],
        'AM-WOODS-B03': ['guy_ropes'], 'AS-SIB-B06': ['guy_ropes'],
        'AM-MESO-B12': ['corbelled_vault'], 'AS-CHI-B03': ['dougong'],
        'AF-SAHEL-B09': ['successive_courts'],
        'AM-ARC-B08': ['multiple_doors'],
        'AM-MESO-B01': ['limestone_base'],
    }.get(identifier, [])
    data['details'] = [trait for trait in data['details'] if trait not in unsupported]
    if identifier in ['AS-JAP-B02', 'AS-KOR-B02', 'AS-KOR-B05']:
        data['rooms_per_body'] = [2, max(2, data['rooms_per_body'][1])]
    if identifier == 'AF-EAST-B06':
        data['materials']['coating'] = 'MAT-PLASTER-LIME'
    if identifier == 'AF-MAG-B10':
        data['materials'].update(infill='MAT-WOVEN-TEXTILE', coating='MAT-WOVEN-TEXTILE', cladding='MAT-WOVEN-TEXTILE')
    if identifier == 'AM-ARC-B06':
        data['details'].append('bone_posts')
    if identifier == 'AS-SIB-B08':
        data.update(roof_system='RF-FLAT', roof_pitch_deg=[0, 0])
    if identifier == 'AS-SIB-B02':
        # Source dome/low-cone on a real 1.2 m hide drum; this existing RF04
        # operator carries the independently covered inner sleeping tent.
        data.update(roof_system='RF-DOME-CONE', allowed_roofs=['RF-DOME-CONE'])
    if identifier == 'AF-NILE-B08':
        data.update(layout='high_hall', elevation_family='regular', overhang_m=[0, 0], courtyard_ratio=[0, 0])
        data['details'] = [t for t in data['details'] if t != 'courtyard']
    if identifier == 'ATL-CEL-B09':
        data['materials']['coating'] = ''
        data['overhang_m'] = [0, 0]
    if identifier == 'AM-MESO-B07':
        data.update(floors=[1, 1], structure_system='masonry', wall_thickness_m=[1.5, 1.6], overhang_m=[0, 0])
        data['materials'].update(frame='MAT-STONE-MORTAR', infill='MAT-STONE-MORTAR', roof_frame='MAT-STONE-MORTAR')
    if identifier == 'AS-MIDE-B03':
        data.update(roof_system='RF-VAULT', roof_pitch_deg=[0, 0])
    if identifier == 'AF-SAHEL-B05':
        data['layout'] = 'courtyard'
    if identifier == 'AF-SAHEL-B11':
        data.update(width_m=[6, 10], depth_m=[6, 10], overhang_m=[0, 0])
    if identifier == 'AS-IND-B13':
        data['overhang_m'] = [0, 0]
    if any(t in data['details'] for t in ['thick_walls','thick_stone_walls','thick_earth_walls']):
        data['wall_thickness_m'] = [0.8, 1.2]
    if identifier == 'AM-MESO-B10':
        data['materials']['base'] = 'MAT-LIMESTONE'
    if identifier == 'AS-MIDE-B09':
        # The source gives a patio and ventilated tower, not a storey count.
        # A one-storey programme admits a continuous shaft without cutting
        # unmodelled intermediate floors.
        data['floors'] = [1, 1]
    data['variant_id'] = 'default'
    data['roof_spec'] = roof_spec(data['roof_system'], data['details'])
    if identifier == 'AS-ISL-B10':
        # Dimensions are graphic defaults, not archaeological measurements.
        # The serial longitudinal programme needs L >= 1.2 W after its axis.
        data['depth_m'] = [19.2,28]
        data['roof_spec'].update(axis='longitudinal',horns=dict(layout='serial_tiers',count='four',
                                  central_span_ratio=0.5,rise_ratio=0.25,outer_rise_scale=1.15,confidence='stylized'))
    if identifier == 'AS-STEP-B01':
        data['overhang_m'] = [0,0]
    if identifier == 'AS-SIB-B02':
        data['roof_spec'].update(drum_height_m=1.2, dome_rise_ratio=0.65)
    # Auxiliary cover dimensions are stylized construction defaults, exported
    # for inspection rather than inferred from cultural identifiers at runtime.
    data['gallery_cover'] = gallery_defaults(data)
    if identifier in {'AS-JAP-B01', 'EUR-MED-B04'}:
        data['gallery_cover']['facade_mode'] = 'residential' if identifier == 'AS-JAP-B01' else 'wall_bearing'
    if identifier == 'AF-SAHEL-B05':
        data['gallery_cover'].update(enabled=True, pitch_deg=10.0)
        data['gallery_cover']['spec']['parapet_height_m'] = 0.0
    if identifier in {'AS-CHI-B13', 'MED-ANT-B02'}:
        data['roof_spec']['triangulation'] = 'boundary'
    if identifier == 'AS-CHI-B13':
        data['gallery_cover']['spec']['triangulation'] = 'boundary'
    data['level_height_m'] = level_height(data)
    if identifier == 'AS-MIDE-B03':
        data['level_height_m'] = 4.6
    if 'high_walls' in data['details']:
        data['level_height_m'] = max(data['level_height_m'], 4.0)
    if identifier == 'AM-MESO-B07':
        data['level_height_m'] = 4.6
    data['detail_spec'] = detail_defaults(data)
    data['court_program'] = court_defaults(identifier, data)
    data['portal_profile'] = None
    data['site_gate_profile'] = None
    data['structural_spec'] = structure_defaults(identifier, data)
    data['components'] = []
    data['notes'] = []
    inspired = INSPIRED_ONLY_RECIPES.get(identifier)
    if inspired and 'level_height_m' in inspired:
        data['level_height_m'] = inspired['level_height_m']
    if identifier in BATCH_DIMENSION_DEFAULTS:
        data['notes'].append('Dimensions graphiques stylisées explicites : pièces entières et vraies volées après murs/retraits, sans réduction des corps, pièces ou étages ; aucune mesure archéologique déduite.')
    if identifier == 'AS-MIDE-B03':
        data['notes'].append('Hauteur de niveau4,6m stylisée : naissance de voûte au-dessus des portails2,05m et de leur linteau, retombée0,05×portée réelle ; aucune porte réduite.')
    # Conservative defaults are construction rules, not inferences from labels.
    data['enclosure_family'] = 'none'
    data['envelope'] = {'flexible_frame': 'membrane', 'earth_shell': 'shell',
                        'snow_shell': 'shell', 'rockcut': 'rockcut'}.get(data['structure_system'], 'walled')
    if identifier == 'AS-STEP-B01':
        # A real felt-clad vertical lattice cylinder supports the dome.
        # Walled describes that enclosing cylinder, not masonry construction.
        data['envelope'] = 'walled'
        data['materials']['base'] = ''
    data['support'] = dict(kind='ground', material=None, height_m=[0, 0])
    data['vertical_access'] = 'internal_stair' if data['floors'][1] > 1 else 'none'
    data['level_materials'] = []
    data['shell'] = None
    data['cells'] = [0, 0]
    if data['layout'] == 'great_house':
        data['cells'] = data['bodies']
        data['bodies'] = [3, 8]
    if data['layout'] == 'pueblo':
        data['cells'] = data['bodies']
        data['bodies'] = [1, min(4, data['cells'][0])]
    if data['layout'] == 'ring':
        data['cells'] = data['bodies']
        data['bodies'] = [1, 1]
    if data['layout'] in ['courtyard', 'peristyle', 'atrium', 'iwan_court', 'excavated']:
        wings = 3 if data['footprint_family'] == 'FP-U' else 2 if data['footprint_family'] == 'FP-L' else 4
        data['bodies'] = [wings, wings]
    if data['layout'] in ['courtyard', 'peristyle', 'atrium', 'iwan_court', 'siheyuan', 'kancha', 'multiyard', 'hut_compound', 'kraal']:
        data['enclosure_family'] = 'earth_wall' if data['structure_system'] in ['earth_wall', 'earth_shell'] else 'stone_wall'
    if identifier == 'AM-MESO-B13':
        # Chinampa source specifies fill/piles/canals, no enclosing masonry.
        data['enclosure_family'] = 'none'
    if data['layout'] == 'hut_compound':
        data['enclosure_family'] = 'thorn_fence' if data['structure_system'] != 'earth_wall' else 'earth_wall'
    if identifier in {'AF-NILE-B04', 'AF-MAG-B08'}:
        data['enclosure_family'] = 'none'
    if data['elevation_family'] == 'stilt':
        data['support'] = dict(kind='posts', material='MAT-RAISED-POST', height_m=[1.2, 2.5])
        data['materials']['base'] = ''
        data['vertical_access'] = 'exterior_stair'
    if data['elevation_family'] == 'floating':
        data['support'] = dict(kind='raft', material='MAT-BAMBOO', height_m=[0.3, 0.6])
        data['materials']['base'] = ''
        data['vertical_access'] = 'none'
    if data['elevation_family'] in ['sunken', 'excavated']:
        data['vertical_access'] = 'exterior_stair'
    if data['layout'] in ['pueblo', 'great_house']:
        data['vertical_access'] = 'ladder'
    if data['layout'] == 'bridge':
        data['support'] = dict(kind='piers', material='MAT-STONE-MORTAR', height_m=[2, 4])
    if data['envelope'] == 'membrane':
        data['materials']['base'] = ''
    if data['envelope'] == 'shell' and data['structure_system'] == 'snow_shell':
        data['materials']['base'] = 'MAT-ICE-SNOW'
    data['level_materials'] = level_material_defaults(identifier, data)
    if identifier == 'AS-CHI-B02':
        data['components'] = [component('north_hall', 'pavilion', placement='north', size=(0.55, 0.7), depth_size=(0.18, 0.25), roof_system='RF-GABLE'),
                              component('side_halls', 'pavilion', count=(2, 2), placement='peripheral', size=(0.18, 0.22), depth_size=(0.4, 0.5), roof_system='RF-GABLE'),
                              component('south_gate', 'pavilion', role='spatial_component', placement='south', size=(0.2, 0.3), depth_size=(0.12, 0.16), roof_system='RF-GABLE', rooms_per_body=[0, 0])]
    if identifier == 'AS-JAP-B03':
        data['components'] = [component('central_hall', 'shinden', placement='central', size=(0.35, 0.5), depth_size=(0.18, 0.25)),
                              component('side_halls', 'shinden', count=(2, 4), placement='peripheral', size=(0.2, 0.35), depth_size=(0.35, 0.5))]
        # Low, common supports keep the connecting galleries on a real shared
        # walk plane; independent random heights would detach their endpoints.
        data['support'] = dict(kind='posts', material='MAT-RAISED-POST', height_m=[0.45, 0.45])
        for part in data['components']:
            part['support'] = copy.deepcopy(data['support'])
        data['notes'].append('Pilotis bas et galeries sur un plan commun de 0,45 m : cote stylisée, non mesure archéologique.')
    if identifier == 'AF-SAHEL-B03':
        data['components'] = [component('round_dwellings', 'round', count=(2, 4), placement='peripheral', size=(0.14, 0.22), materials={'frame': 'MAT-COB', 'infill': 'MAT-COB'}, structure_system='earth_wall'),
                              component('square_dwellings', 'earth', count=(2, 5), placement='peripheral', size=(0.14, 0.22))]
    if identifier == 'AF-SAHEL-B08':
        data['components'] = [component('stepped_dwellings', 'earth', count=(6, 12), placement='main', size=(0.2, 0.3)),
                              component('granaries', 'round', role='domestic_annex', count=(1, 3), placement='rear', size=(0.1, 0.16), details=[], elevation_family='stilt', materials={'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE'}, structure_system='earth_wall')]
        data['bodies'] = [7, 15]
    if identifier == 'AF-SAHEL-B09':
        data['components'] = [component('conical_vestibule', 'round', role='domestic_annex', placement='facing_main',
                                        size=(0.18, 0.26), depth_size=(0.1, 0.16), rooms_per_body=[1, 1],
                                        materials={'frame': 'MAT-COB', 'infill': 'MAT-COB'}, structure_system='earth_wall')]
    if identifier == 'AF-SAHEL-B10':
        data['components'] = [component('mobile_tents', 'nomad', count=(3, 8), placement='peripheral', size=(0.16, 0.24), materials={'infill': 'MAT-REED', 'coating': 'MAT-REED', 'cladding': 'MAT-REED'}, envelope='membrane')]
    if identifier == 'AM-PUEB-B10':
        data['components'] = [component('dwellings', 'earth', count=(8, 18), placement='main', size=(0.15, 0.25)),
                              component('kiva', 'earth_lodge', role='non_domestic', placement='adjacent', size=(0.3, 0.45), roof_system='RF-FLAT', roof_pitch_deg=[0, 0], materials={'cladding': 'MAT-MUD-PLASTER'}, footprint_family='FP-ROUND')]
        data['components'][-1]['vertical_access'] = 'roof_hatch'
        data['bodies'] = [9, 19]
    if identifier == 'AS-SEA-B03':
        data['components'] = [component('raised_halls', 'stilt', count=(3, 5), placement='peripheral', size=(0.25, 0.4), roof_system='RF-GABLE')]
        data['support'] = dict(kind='posts', material='MAT-RAISED-POST', height_m=[1.2, 2.5])
    if identifier == 'AS-SEA-B04':
        data['components'] = [component('long_hall', 'court_tile', placement='north', size=(0.6, 0.75), depth_size=(0.18, 0.25), footprint_family='FP-RECT'),
                              component('farm_annexes', 'court_tile', role='domestic_annex', count=(2, 4), placement='rear', size=(0.14, 0.22), depth_size=(0.18, 0.26), footprint_family='FP-RECT', floors=[1, 1], rooms_per_body=[1, 1], roof_system='RF-GABLE', materials={'cladding': 'MAT-TILE-CLAY', 'infill': 'MAT-BAMBOO'})]
    if identifier == 'AS-ISL-B04':
        data['components'] = [component('granary', 'saddle', role='domestic_annex', placement='facing_main', size=(1, 1), rooms_per_body=[1, 1])]
    if identifier == 'EUR-MED-B07':
        data['components'] = [component('main_house', 'masonry', size=(0.55, 0.7)),
                              component('tower', 'tower', placement='adjacent', size=(0.2, 0.3))]
    if any(part['role'] in ['dwelling', 'residential_ensemble'] and part['placement'] != 'facing_main' for part in data['components']):
        # Principal bodies count excludes stores, gates and ritual annexes.
        principal = [part for part in data['components'] if part['role'] in ['dwelling', 'residential_ensemble'] and part['placement'] != 'facing_main' and part['id'] != 'upper_frame']
        data['bodies'] = [sum(part['count'][i] for part in principal) for i in range(2)]
    if identifier == 'ATL-CEL-B08':
        data['vertical_access'] = 'intramural_stair'
        data['enclosure_family'] = 'stone_wall'
        data['shell'] = dict(outer_wall_m=2.0, gallery_m=1.5, inner_wall_m=1.2, inner_diameter_m=8.0)
    if role == 'domestic_annex':
        data['details'] = [trait for trait in data['details'] if trait not in ['hearth', 'multiple_hearths', 'multiple_households', 'central_hearth']]
    kind = COMPONENT_KINDS.get(identifier)
    if kind and kind not in ['covered_bridge', 'floating_hall', 'open_pavilion', 'open_community_hall', 'assembly_hall']:
        data.update(roof_system='uncovered', allowed_roofs=[], roof_pitch_deg=[0, 0], bodies=[0, 0], rooms_per_body=[0, 0], floors=[1, 1], vertical_access='none', components=[])
        data['envelope'] = 'open'
    if kind in ['covered_bridge', 'floating_hall', 'open_pavilion', 'open_community_hall', 'assembly_hall']:
        data.update(rooms_per_body=[0, 0], floors=[1, 1], vertical_access='none')
        data['envelope'] = 'open'
        data['details'] = [trait for trait in data['details'] if trait not in ['hearth', 'multiple_hearths', 'multiple_households']]
    if kind == 'livestock_enclosure':
        data['enclosure_family'] = 'thorn_fence'
    if kind == 'palisade':
        data['enclosure_family'] = 'timber_palisade'
    if kind in ['open_court', 'prestige_wall', 'puuc_facade']:
        data['enclosure_family'] = 'stone_wall' if kind != 'open_court' else 'earth_wall'
    if kind in ['prestige_wall', 'puuc_facade']:
        data['materials'].update(frame='MAT-STONE-ASHLAR', infill='MAT-STONE-ASHLAR')
    if kind in ['windbreak', 'drying_rack']:
        data['materials'].update(frame='MAT-TIMBER-POST', infill='MAT-WOOD-SHINGLES')
    geometry, notes = [], []
    for detail in data['details']:
        if detail in TRAITS:
            geometry.append(detail)
        elif detail in NOTES:
            notes.append(detail)
        else:
            raise ValueError(f'Unknown architectural trait {identifier}: {detail}')
    data['details'] = geometry
    data['notes'] = notes
    if inspired:
        data['notes'].append(inspired['parameter_note'])
    if identifier == 'AF-SAHEL-B09':
        data['notes'].append('Vestibule conique du groupe à cours : position, plan rond, dimensions et chaume de couverture stylisés, sans mesure archéologique.')
    if identifier == 'AS-STEP-B01':
        data['notes'].append('Cylindre de treillis bois revêtu de feutre : enveloppe verticale fermée à 2,8 m stylisés portant RF-DOME sans débord afin de joindre le couronnement ; hauteur des baguettes dérivée du mur réel, sans maçonnerie ni changement de toiture source.')
    if identifier == 'AS-ISL-B10':
        data['notes'].append('Quatre cornes sur trois selles longitudinales : dimensions stylisées, axe du bras natif long et profondeur minimale 19,2 m = 1,2 × largeur maximale ; débord à plateau aux pointes, sans mesure archéologique.')
    if identifier == 'AF-NILE-B04':
        data['notes'].append('Le cylindre reçoit le dôme; une voûte en berceau longitudinale ne correspond pas à son plan rond.')
    if identifier in {'AF-NILE-B04', 'AF-MAG-B08'}:
        data['notes'].append('Trois à cinq réserves groupées autour d’un vide commun : quantité et dimensions stylisées, rôle annexe Storage et même propriétaire, sans foyer ni clôture inventée.')
    if identifier == 'AS-JAP-B01':
        data['notes'].append('Une à deux annexes de réserve à l’arrière : quantité et dimensions stylisées, niveau de 2,8 m et petit débord de chaume ; aucun logement supplémentaire.')
    if identifier == 'EUR-MED-B04':
        data['notes'].append('Appentis RF-SHED joint au mur, rive haute portée par les murs réels et rive basse par poteaux ; débord principal nul et dimensions stylisées, tuile ou lauze du bundle conservée.')
    if identifier == 'OC-PAC-B10':
        data['notes'].append('Plan de barque représenté par une ellipse native très allongée aux extrémités arrondies ; abstraction stylisée vérifiée sur la géométrie réelle.')
    if identifier == 'AM-MESO-B07':
        data['notes'].append('Voûtes sous terrasse : un niveau de 4,6 m et murs de 1,5–1,6 m sont des mesures stylisées compatibles avec les appuis, non des dimensions archéologiques.')
    if identifier == 'AS-MIDE-B09':
        data['notes'].append('Un niveau habitable stylisé conserve un conduit continu jusqu’au badgir ; le nombre d’étages n’est pas précisé par la source.')
    if identifier == 'AS-JAP-B03':
        data['notes'].append('Pilotis bas et galeries sur un plan commun de 0,45 m : cote stylisée, non mesure archéologique.')
    if data['court_program']:
        data['notes'].append('Cours classées : le nombre de 3 à Abomey est sourcé ; ailleurs nombre, proportions et dimensions du programme sont des choix de construction stylisés. Tous les corps et pièces sont conservés.')
    data['vertical_routes'] = routes(data['vertical_access'], data['floors'][1])
    for part in data['components']:
        part['vertical_routes'] = routes(part['vertical_access'], part['floors'][1])
    data['enclosures'] = [] if data['enclosure_family'] == 'none' else [dict(family=data['enclosure_family'], placement='peripheral', gate_width_m=1.5)]
    if kind in ['livestock_enclosure', 'palisade']:
        # The spatial component itself builds its declared fence and gate.
        # A second fence around the lot would invent an unrelated enclosure.
        data['enclosures'] = []
    if identifier in ['AF-SOUTH-B05', 'AF-SAHEL-B10']:
        data['enclosures'].append(dict(family='thorn_fence', placement='central', gate_width_m=1.2))
    if not data['components'] and data['bodies'][1] > 0:
        data['components'] = [dict(id='main', role=role, count=data['bodies'], placement='main',
                                   width_ratio=[1, 1], depth_ratio=[1, 1],
                                   footprint_family=data['footprint_family'], roof_system=data['roof_system'],
                                   roof_spec=copy.deepcopy(data['roof_spec']), roof_pitch_deg=data['roof_pitch_deg'], overhang_m=data['overhang_m'],
                                   materials=copy.deepcopy(data['materials']), structure_system=data['structure_system'],
                                   envelope=data['envelope'], floors=data['floors'], level_height_m=data['level_height_m'], rooms_per_body=data['rooms_per_body'],
                                   vertical_access=data['vertical_access'], vertical_routes=copy.deepcopy(data['vertical_routes']),
                                   support=copy.deepcopy(data['support']), level_materials=copy.deepcopy(data['level_materials']),
                                   wall_thickness_m=data['wall_thickness_m'], courtyard_ratio=data['courtyard_ratio'])]
    if identifier == 'AS-JAP-B01':
        data['components'][0]['id'] = 'main_house'
        annex = component('rear_annexes', 'farm', role='domestic_annex', count=(1, 2),
                          placement='rear', size=(0.4, 0.6), depth_size=(0.4, 0.6),
                          footprint_family='FP-RECT', floors=[1, 1], rooms_per_body=[1, 1],
                          roof_system='RF-REED-HIP', overhang_m=[0.1, 0.15],
                          materials=copy.deepcopy(data['materials']),
                          structure_system=data['structure_system'])
        annex['level_height_m'] = 2.8
        data['components'].append(annex)
    data['allowed_roofs'] = [] if data['roof_system'] == 'uncovered' else [data['roof_system']]
    data['allowed_footprints'] = [data['footprint_family']]
    data['portal_profile'] = portal_defaults(identifier, data)
    data['site_gate_profile'] = site_gate_defaults(identifier, data)
    return data


def variant(label, **changes):
    return dict(label=label, changes=changes)


# Every bundle carries a complete resulting parameter set. These explicit source
# alternatives are not independent menus whose Cartesian product is historical.
V = {
    'flat_earth': variant('Terrasse de bois et terre', roof_system='RF-FLAT', roof_pitch_deg=[0, 0], materials={'cladding': 'MAT-MUD-PLASTER'}, details=['parapet', 'scupper']),
    'flat_stone': variant('Terrasse sur maçonnerie', roof_system='RF-FLAT', roof_pitch_deg=[0, 0], materials={'cladding': 'MAT-STONE-DRY'}, details=['parapet']),
    'gable_tile': variant('Deux pans de tuiles', roof_system='RF-GABLE', roof_pitch_deg=[20, 40], materials={'cladding': 'MAT-TILE-CLAY'}),
    'gable_thatch': variant('Deux pans de chaume', roof_system='RF-GABLE', roof_pitch_deg=[35, 55], materials={'cladding': 'MAT-THATCH'}),
    'gable_wood': variant('Deux pans de bois', roof_system='RF-GABLE', roof_pitch_deg=[15, 40], materials={'cladding': 'MAT-WOOD-SHINGLES'}),
    'gable_bark': variant('Deux pans d’écorce', roof_system='RF-GABLE', roof_pitch_deg=[20, 40], materials={'cladding': 'MAT-BARK'}),
    'gable_turf': variant('Deux pans de tourbe', roof_system='RF-GABLE', roof_pitch_deg=[20, 40], materials={'cladding': 'MAT-TURF'}),
    'gable_slate': variant('Deux pans de lauzes/ardoises', roof_system='RF-GABLE', roof_pitch_deg=[25, 45], materials={'cladding': 'MAT-SLATE'}),
    'eaves_slate': variant('Grand toit débordant de lauzes', roof_system='RF-EAVES', roof_pitch_deg=[25, 45], materials={'cladding': 'MAT-SLATE'}),
    'hip_thatch': variant('Croupe de chaume', roof_system='RF-HIP', roof_pitch_deg=[35, 55], materials={'cladding': 'MAT-THATCH'}),
    'hip_palm': variant('Croupe de palmes', roof_system='RF-HIP', roof_pitch_deg=[35, 55], materials={'cladding': 'MAT-PALM'}),
    'hip_tile': variant('Croupe tuilée', roof_system='RF-HIP', roof_pitch_deg=[25, 45], materials={'cladding': 'MAT-TILE-CLAY'}),
    'eaves_tile': variant('Toit tuilé à grands avant-toits', roof_system='RF-EAVES', roof_pitch_deg=[25, 45], materials={'cladding': 'MAT-TILE-CLAY'}),
    'vault_adobe': variant('Voûte de briques crues', roof_system='RF-VAULT', roof_pitch_deg=[0, 0], materials={'roof_frame': 'MAT-ADOBE', 'cladding': 'MAT-ADOBE'}),
    'vault_brick': variant('Voûte de briques cuites', roof_system='RF-VAULT', roof_pitch_deg=[0, 0], materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK', 'roof_frame': 'MAT-BURNT-BRICK', 'cladding': 'MAT-BURNT-BRICK'}, structure_system='masonry'),
    'vault_stone': variant('Voûte de pierre', roof_system='RF-VAULT', roof_pitch_deg=[0, 0], materials={'roof_frame': 'MAT-STONE-MORTAR', 'cladding': 'MAT-STONE-DRY'}),
    'dome_adobe': variant('Coupole de briques crues', roof_system='RF-DOME', roof_pitch_deg=[0, 0], materials={'roof_frame': 'MAT-ADOBE', 'cladding': 'MAT-ADOBE'}),
    'dome_brick': variant('Coupole de briques cuites', roof_system='RF-DOME', roof_pitch_deg=[0, 0], materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK', 'roof_frame': 'MAT-BURNT-BRICK', 'cladding': 'MAT-BURNT-BRICK'}, structure_system='masonry'),
    'dome_turf': variant('Dôme de perches et tourbe', roof_system='RF-DOME', materials={'cladding': 'MAT-TURF'}),
    'dome_coral': variant('Dôme de maçonnerie corallienne', roof_system='RF-DOME', roof_pitch_deg=[0, 0], materials={'roof_frame': 'MAT-CORAL', 'cladding': 'MAT-CORAL', 'coating': 'MAT-PLASTER-LIME'}),
    'reed_cladding': variant('Couverture de roseaux', materials={'cladding': 'MAT-REED'}, roof_pitch_deg=[35, 55]),
    'prestige_brackets': variant('Consoles dougong selon le statut', details=['dougong']),
    'dome_hide': variant('Dôme de perches et peaux', roof_system='RF-DOME', materials={'cladding': 'MAT-HIDE', 'infill': 'MAT-HIDE', 'coating': 'MAT-HIDE'}, structure_system='flexible_frame', envelope='membrane'),
    'felt_membrane': variant('Membrane de feutre', materials={'cladding': 'MAT-FELT', 'infill': 'MAT-FELT', 'coating': 'MAT-FELT'}),
    'hide_membrane': variant('Membrane de peaux', materials={'cladding': 'MAT-HIDE', 'infill': 'MAT-HIDE', 'coating': 'MAT-HIDE'}),
    'palm_cladding': variant('Couverture de palmes', materials={'cladding': 'MAT-PALM'}, roof_pitch_deg=[35, 55]),
    'thatch_cladding': variant('Couverture de chaume', materials={'cladding': 'MAT-THATCH'}, roof_pitch_deg=[35, 55]),
    'wood_cladding': variant('Couverture de bardeaux', materials={'cladding': 'MAT-WOOD-SHINGLES'}),
    'bark_cladding': variant('Couverture d’écorce', materials={'cladding': 'MAT-BARK'}),
    'slate_cladding': variant('Couverture de lauzes', materials={'cladding': 'MAT-SLATE'}, roof_pitch_deg=[25, 45]),
    'tile_cladding': variant('Couverture de tuiles', materials={'cladding': 'MAT-TILE-CLAY'}, roof_pitch_deg=[25, 45]),
    'rect_gable': variant('Plan rectangulaire à deux pans', footprint_family='FP-RECT', roof_system='RF-GABLE', roof_pitch_deg=[35, 55]),
    'rect_flat': variant('Plan rectangulaire à terrasse', footprint_family='FP-RECT', roof_system='RF-FLAT', roof_pitch_deg=[0, 0], materials={'cladding': 'MAT-MUD-PLASTER'}),
    'oval_plan': variant('Plan ovale', footprint_family='FP-OVAL'),
    'round_plan': variant('Plan circulaire', footprint_family='FP-ROUND'),
    'u_court': variant('Trois ailes en U', footprint_family='FP-U', layout='courtyard', bodies=[3, 3]),
    'quadrangle': variant('Ferme en quadrilatère', footprint_family='FP-COURT', layout='courtyard', bodies=[4, 4]),
    'square_ring': variant('Anneau habité carré', footprint_family='FP-COURT'),
    'd_plan': variant('Grande maison en D', footprint_family='FP-APSIDAL'),
    'sunken_yard': variant('Cour creusée et cellules périphériques', layout='excavated', footprint_family='FP-ROCKCUT', elevation_family='excavated', details=['sunken_courtyard', 'cut_cells', 'entry_stairs']),
    'oval_shed': variant('Abri ovale en appentis', footprint_family='FP-OVAL', roof_system='RF-SHED', materials={'cladding': 'MAT-BARK'}),
    'shed_thatch': variant('Appentis de chaume des cellules de travail', roof_system='RF-SHED', roof_pitch_deg=[25, 40], materials={'cladding': 'MAT-THATCH'}),
    'round_cone': variant('Petit cylindre à cône de chaume', footprint_family='FP-ROUND', roof_system='RF-CONE', materials={'cladding': 'MAT-THATCH'}, roof_pitch_deg=[35, 55]),
    'three_storeys': variant('Trois niveaux — variante inspirée', floors=[3, 3]),
    'four_storeys': variant('Quatre niveaux — variante inspirée', floors=[4, 4]),
}
VARIANT_ASSIGNMENTS = {
    'MED-ANT-B01': 'flat_earth', 'MED-ANT-B05': 'flat_earth',
    'MED-ANT-B13': 'three_storeys four_storeys',
    'ATL-CEL-B01': 'oval_plan', 'ATL-CEL-B02': 'oval_plan', 'ATL-CEL-B04': 'oval_plan rect_gable',
    'EUR-MED-B01': 'rect_gable', 'EUR-MED-B03': 'slate_cladding', 'EUR-MED-B04': 'slate_cladding',
    'EUR-MED-B06': 'quadrangle', 'EUR-MED-B07': 'flat_stone', 'EUR-MED-B08': 'gable_tile',
    'EUR-MED-B10': 'eaves_slate', 'EUR-NOR-B01': 'gable_thatch', 'EUR-NOR-B02': 'gable_turf',
    'EUR-NOR-B07': 'dome_turf dome_hide', 'EUR-NOR-B09': 'gable_wood',
    'EUR-EAST-B02': 'gable_tile', 'EUR-EAST-B03': 'gable_wood',
    'AF-MAG-B04': 'flat_earth', 'AF-MAG-B09': 'gable_tile',
    'AS-MIDE-B02': 'vault_adobe', 'AS-MIDE-B03': 'vault_brick', 'AS-MIDE-B04': 'vault_stone',
    'AS-MIDE-B06': 'dome_adobe vault_brick dome_brick', 'AS-MIDE-B10': 'gable_tile',
    'AS-STEP-B01': 'round_plan', 'AS-STEP-B02': 'felt_membrane', 'AS-STEP-B07': 'flat_earth',
    'AF-SAHEL-B05': 'vault_adobe', 'AF-SAHEL-B07': 'dome_adobe',
    'AF-SAHEL-B10': 'hide_membrane', 'AF-WEST-B01': 'flat_earth', 'AF-WEST-B02': 'tile_cladding',
    'AF-WEST-B09': 'shed_thatch',
    'AF-SOUTH-B06': 'rect_gable', 'AF-SOUTH-B08': 'palm_cladding', 'AF-SOUTH-B09': 'rect_gable',
    'AF-EAST-B02': 'gable_wood', 'AF-EAST-B03': 'palm_cladding', 'AF-EAST-B04': 'rect_flat', 'AF-EAST-B06': 'dome_coral',
    'AS-IND-B01': 'gable_thatch flat_earth', 'AS-IND-B03': 'flat_earth', 'AS-IND-B10': 'flat_earth',
    'AS-HIM-B04': 'eaves_slate', 'AS-CHI-B03': 'hip_tile prestige_brackets', 'AS-CHI-B05': 'flat_earth',
    'AS-CHI-B08': 'tile_cladding', 'AS-CHI-B10': 'vault_brick sunken_yard', 'AS-CHI-B13': 'square_ring',
    'AS-KOR-B02': 'hip_thatch', 'AS-KOR-B05': 'hip_tile',
    'AS-JAP-B01': 'gable_thatch', 'AS-JAP-B03': 'wood_cladding', 'AS-JAP-B04': 'gable_wood',
    'AS-JAP-B05': 'bark_cladding', 'AS-JAP-B09': 'tile_cladding',
    'AS-SEA-B01': 'gable_thatch', 'AS-SEA-B02': 'thatch_cladding', 'AS-SEA-B05': 'gable_thatch',
    'AS-ISL-B02': 'wood_cladding', 'AS-ISL-B05': 'palm_cladding', 'AS-ISL-B07': 'tile_cladding', 'AS-ISL-B09': 'oval_plan',
    'OC-PAC-B03': 'reed_cladding', 'OC-PAC-B05': 'palm_cladding', 'OC-AUS-B01': 'vegetal_vault', 'OC-AUS-B02': 'round_plan',
    'AM-ARC-B01': 'round_hide_cone', 'AM-ARC-B02': 'flat_earth', 'AM-ARC-B03': 'flat_earth',
    'AM-ARC-B04': 'hide_membrane', 'AM-ARC-B06': 'flat_earth dome_turf', 'AM-ARC-B07': 'round_bark_cone',
    'AM-WOODS-B02': 'gable_bark', 'AM-WOODS-B07': 'bark_cladding',
    'AM-PUEB-B03': 'd_plan', 'AM-PUEB-B06': 'flat_earth', 'AM-MESO-B01': 'thatch_cladding',
    'AM-MESO-B04': 'gable_wood', 'AM-AND-B01': 'rect_gable', 'AM-AND-B05': 'rect_gable',
    'AM-TROP-B01': 'palm_cladding', 'AM-TROP-B03': 'hip_palm', 'AM-TROP-B04': 'palm_cladding',
    'AS-SIB-B01': 'bark_cladding', 'AS-SIB-B03': 'gable_wood', 'AS-SIB-B04': 'flat_earth',
    'AM-PNW-B04': 'gable_bark', 'AM-SOUTH-B04': 'dome_hide', 'AM-SOUTH-B05': 'bark_cladding',
    'AM-SOUTH-B07': 'hide_membrane',
}


V.update(
    vegetal_vault=variant('Voûte basse végétale et écorce', roof_system='RF-THATCH-VAULT', materials={'cladding': 'MAT-BARK'}),
    round_hide_cone=variant('Tente conique en peaux', footprint_family='FP-ROUND', roof_system='RF-TENT', materials={'cladding': 'MAT-HIDE', 'infill': 'MAT-HIDE', 'coating': 'MAT-HIDE', 'base': ''}, envelope='membrane'),
    round_bark_cone=variant('Cône bas d’écorce', footprint_family='FP-ROUND', roof_system='RF-CONE', materials={'cladding': 'MAT-BARK', 'infill': 'MAT-BARK'}, roof_pitch_deg=[20, 40]),
    stone_walls=variant('Murs de moellons et chaux', structure_system='masonry', materials={'frame': 'MAT-STONE-MORTAR', 'infill': 'MAT-STONE-MORTAR', 'coating': 'MAT-PLASTER-LIME'}),
    dry_stone_walls=variant('Murs de pierre sèche', structure_system='masonry', materials={'frame': 'MAT-STONE-DRY', 'infill': 'MAT-STONE-DRY'}),
    adobe_walls=variant('Murs de briques crues', structure_system='earth_wall', materials={'frame': 'MAT-ADOBE', 'infill': 'MAT-ADOBE', 'coating': 'MAT-MUD-PLASTER'}),
    cob_walls=variant('Murs de bauge', structure_system='earth_wall', materials={'frame': 'MAT-COB', 'infill': 'MAT-COB', 'coating': 'MAT-MUD-PLASTER'}),
    rammed_walls=variant('Murs de pisé', structure_system='earth_wall', materials={'frame': 'MAT-RAMMED-EARTH', 'infill': 'MAT-RAMMED-EARTH', 'coating': 'MAT-MUD-PLASTER'}),
    brick_walls=variant('Murs de briques cuites', structure_system='masonry', materials={'frame': 'MAT-BURNT-BRICK', 'infill': 'MAT-BURNT-BRICK', 'coating': 'MAT-PLASTER-LIME'}),
    timber_wattle=variant('Ossature bois et torchis', structure_system='post_beam', materials={'frame': 'MAT-TIMBER-POST', 'infill': 'MAT-WATTLE-DAUB', 'coating': 'MAT-MUD-PLASTER'}),
    brick_infill=variant('Colombage à remplissage de briques', materials={'infill': 'MAT-BURNT-BRICK'}),
    bamboo_frame=variant('Ossature et panneaux de bambou', structure_system='post_beam', materials={'frame': 'MAT-BAMBOO', 'infill': 'MAT-BAMBOO', 'roof_frame': 'MAT-BAMBOO'}),
)
MATERIAL_VARIANT_ASSIGNMENTS = {
    'MED-ANT-B01': 'adobe_walls brick_walls', 'MED-ANT-B02': 'brick_walls',
    'MED-ANT-B03': 'brick_walls', 'MED-ANT-B04': 'brick_walls',
    'ATL-CEL-B06': 'stone_walls', 'EUR-MED-B01': 'stone_walls',
    'EUR-MED-B02': 'stone_walls brick_walls', 'EUR-MED-B03': 'brick_infill',
    'EUR-MED-B09': 'brick_walls', 'EUR-MED-B12': 'stone_walls',
    'EUR-NOR-B09': 'dry_stone_walls', 'EUR-EAST-B02': 'stone_walls',
    'AF-MAG-B01': 'rammed_walls', 'AF-MAG-B02': 'stone_walls',
    'AF-MAG-B03': 'brick_walls rammed_walls', 'AF-MAG-B05': 'rammed_walls',
    'AS-MIDE-B01': 'stone_walls', 'AS-MIDE-B02': 'brick_walls',
    'AS-MIDE-B06': 'vault_brick', 'AS-MIDE-B12': 'stone_walls',
    'AS-STEP-B04': 'brick_walls', 'AF-SAHEL-B02': 'cob_walls',
    'AF-SAHEL-B03': 'rammed_walls', 'AF-SAHEL-B07': 'cob_walls',
    'AF-SOUTH-B01': 'cob_walls', 'AF-SOUTH-B03': 'cob_walls adobe_walls',
    'AF-SOUTH-B06': 'cob_walls', 'AF-EAST-B01': 'dry_stone_walls',
    'AF-EAST-B04': 'adobe_walls', 'AS-IND-B01': 'adobe_walls timber_wattle brick_walls',
    'AS-IND-B02': 'adobe_walls', 'AS-IND-B03': 'stone_walls',
    'AS-IND-B04': 'bamboo_frame', 'AS-IND-B10': 'stone_walls',
    'AS-HIM-B01': 'adobe_walls', 'AS-CHI-B01': 'brick_infill',
    'AS-CHI-B04': 'brick_infill', 'AS-CHI-B08': 'bamboo_frame',
    'AS-SEA-B01': 'bamboo_frame', 'AS-SEA-B03': 'bamboo_frame',
    'AS-SEA-B04': 'brick_walls', 'AS-ISL-B01': 'bamboo_frame',
    'AS-ISL-B07': 'bamboo_frame', 'OC-PAC-B08': 'bamboo_frame',
    'AM-PUEB-B02': 'stone_walls', 'AM-AND-B01': 'adobe_walls',
    'AM-AND-B02': 'adobe_walls', 'AM-AND-B03': 'stone_walls',
}
for identifier, keys in MATERIAL_VARIANT_ASSIGNMENTS.items():
    existing = VARIANT_ASSIGNMENTS.get(identifier, '').split()
    VARIANT_ASSIGNMENTS[identifier] = ' '.join(dict.fromkeys(existing + keys.split()))


def level_material_defaults(identifier, data):
    # Storeys remain a coherent part of the resolved material bundle.
    if identifier in ['EUR-MED-B10', 'AS-HIM-B04']:
        ground = copy.deepcopy(data['materials'])
        ground.update(frame='MAT-STONE-MORTAR', infill='MAT-STONE-MORTAR')
        return [dict(from_level=0, to_level=0, materials=ground),
                dict(from_level=1, to_level=11, materials=copy.deepcopy(data['materials']))]
    if identifier == 'ATL-CEL-B02':
        upper = copy.deepcopy(data['materials'])
        upper.update(frame='MAT-TIMBER-POST', infill='MAT-WATTLE-DAUB')
        return [dict(from_level=0, to_level=0, materials=copy.deepcopy(data['materials'])),
                dict(from_level=1, to_level=11, materials=upper)]
    return []


def variants_for(identifier, parameters, role):
    variants = []
    for key in VARIANT_ASSIGNMENTS.get(identifier, '').split():
        data = copy.deepcopy(parameters)
        changes = copy.deepcopy(V[key]['changes'])
        additional_details = changes.pop('details', [])
        data['details'] += [detail for detail in additional_details if detail not in data['details']]
        apply_parameters(data, changes)
        data['variant_id'] = key
        data['roof_spec'] = roof_spec(data['roof_system'], data['details'])
        data['gallery_cover'] = gallery_defaults(data)
        if identifier in {'AS-JAP-B01', 'EUR-MED-B04'}:
            data['gallery_cover']['facade_mode'] = 'residential' if identifier == 'AS-JAP-B01' else 'wall_bearing'
        if identifier == 'AF-SAHEL-B05':
            data['gallery_cover'].update(enabled=True, pitch_deg=10.0)
            data['gallery_cover']['spec']['parapet_height_m'] = 0.0
        if identifier in {'AS-CHI-B13', 'MED-ANT-B02'}:
            data['roof_spec']['triangulation'] = 'boundary'
        if identifier == 'AS-CHI-B13':
            data['gallery_cover']['spec']['triangulation'] = 'boundary'
        data['level_height_m'] = level_height(data)
        if identifier == 'AS-MIDE-B03':
            data['level_height_m'] = 4.6
        inspired = INSPIRED_ONLY_RECIPES.get(identifier)
        if inspired:
            # Authored inspired floor variants retain their declared height,
            # and each adjacent-level route must reach the resulting top floor.
            # Do this before copying the bundle into its main component.
            data['level_height_m'] = inspired.get('level_height_m', data['level_height_m'])
            data['vertical_routes'] = routes(data['vertical_access'], data['floors'][1])
        data['detail_spec'] = detail_defaults(data)
        data['level_materials'] = level_material_defaults(identifier, data)
        data['structural_spec'] = structure_defaults(identifier, data)
        data['court_program'] = court_defaults(identifier, data)
        data['portal_profile'] = portal_defaults(identifier, data)
        data['site_gate_profile'] = site_gate_defaults(identifier, data)
        data['allowed_roofs'] = [] if data['roof_system'] == 'uncovered' else [data['roof_system']]
        data['allowed_footprints'] = [data['footprint_family']]
        # Main components mirror their resolved bundle. Specialized components
        # keep their independently specified roofing and materials.
        if (len(data['components']) == 1 and data['components'][0]['id'] == 'main') or identifier == 'AS-JAP-B01':
            part = data['components'][0]
            for field in ['footprint_family', 'roof_system', 'roof_spec', 'roof_pitch_deg', 'overhang_m', 'materials', 'structure_system', 'floors', 'level_height_m', 'rooms_per_body', 'envelope', 'vertical_access', 'level_materials', 'wall_thickness_m', 'support', 'vertical_routes']:
                part[field] = copy.deepcopy(data[field])
            part['count'] = data['bodies']
        if data['roof_system'] in ['RF-FLAT', 'RF-STEP']:
            data['roof_pitch_deg'] = [0, 0]
        variants.append(dict(id=key, label=V[key]['label'], parameters=data,
                             confidence='stylized' if inspired else 'source_preset'))
    return variants


# Local chronology is explicit where the source gives one. Unknown dates remain
# null; A/M filters here are broad atlas flags, never archaeological guarantees.
ERA_OVERRIDES = {
    'AF-NILE-B03': ['A'], 'AS-IND-B02': ['A'], 'AS-MIDE-B02': ['A'],
    'AM-MESO-B03': ['A'], 'AS-JAP-B03': ['M'], 'AM-PUEB-B03': ['M'],
    'AM-PUEB-B05': ['M'], 'AM-PUEB-B09': ['M'],
}
KNOWN_WINDOWS = {
    'AM-MESO-B03': (1, 700, 'Teotihuacan : Ier–VIIe siècle dans le source.'),
    'AM-MESO-B07': (700, 1000, 'Contexte Puuc : VIIIe–Xe siècle dans le source.'),
    'AM-MESO-B11': (700, 1000, 'Contexte Puuc : VIIIe–Xe siècle dans le source.'),
    'AM-MESO-B12': (700, 1000, 'Contexte Puuc : VIIIe–Xe siècle dans le source.'),
}


def chronology(identifier, pack, context):
    inspired = INSPIRED_ONLY_RECIPES.get(identifier)
    if inspired:
        return (copy.deepcopy(inspired['temporal']), inspired['chronology_note'],
                inspired['chronology_confidence'])
    eras = ERA_OVERRIDES.get(identifier, ['M'] if pack == 'AM-MISS' or
                            (pack == 'AM-AND' and identifier not in ['AM-AND-B01', 'AM-AND-B06', 'AM-AND-B09', 'AM-AND-B11', 'AM-AND-B12', 'AM-AND-B13']) else PACK_ERAS.get(pack, ['A', 'M']))
    years = KNOWN_WINDOWS.get(identifier)
    return (dict(eras=eras, tradition_long=years is None and pack not in PACK_ERAS,
                 late_only=identifier in LATE_IDS, from_year=years[0] if years else None,
                 to_year=years[1] if years else None),
            years[2] if years else context['columns'][-1],
            'source_period' if years or identifier in ERA_OVERRIDES or pack == 'AM-MISS' else 'broad_tradition')


MATERIAL_PATTERNS = {
    'WATTLE-DAUB': 'earth', 'COB': 'earth', 'ADOBE': 'earth', 'RAMMED-EARTH': 'earth',
    'MUD-PLASTER': 'earth', 'TIMBER-POST': 'wood', 'LOG': 'wood', 'STONE-DRY': 'stone',
    'STONE-MORTAR': 'stone', 'STONE-ASHLAR': 'stone', 'THATCH': 'thatch', 'REED': 'thatch',
    'TILE-CLAY': 'tile', 'WOOD-SHINGLES': 'wood', 'SLATE': 'stone', 'HALF-TIMBER': 'wood',
    'BURNT-BRICK': 'stone', 'BAMBOO': 'wood', 'PALM': 'thatch', 'RAISED-POST': 'wood',
    'PLASTER-LIME': 'earth', 'CORAL': 'stone', 'BASALT': 'stone', 'BARK': 'wood',
    'FELT': 'fabric', 'HIDE': 'fabric', 'TURF': 'earth', 'CHALK': 'stone',
    'SHELLSTONE': 'stone', 'CLINKER': 'stone', 'ICE-SNOW': 'snow', 'MEGALITH': 'stone',
    'WOOD-MORTISE': 'wood', 'ROCKCUT': 'stone', 'DRIFTWOOD': 'wood',
}


def detail_defaults(data):
    if not any(trait in data['details'] for trait in ['wood_floor', 'ondol', 'guy_ropes', 'oblique_large_posts', 'insulated_rooms', 'ventilation_channels', 'windcatcher', 'narrow_windows', 'carved_windows', 'lattice_windows', 'ventilation', 'dougong', 'regional_corner_turrets']):
        return None
    return dict(confidence='stylized', floor_material='MAT-WOOD-MORTISE' if 'wood_floor' in data['details'] else 'MAT-STONE-MORTAR' if 'ondol' in data['details'] else 'MAT-COB', floor_thickness_m=0.1,
                flue_material='MAT-BURNT-BRICK', flue_width_m=0.18, flue_depth_m=0.15,
                rope_material='MAT-CORDAGE' if 'guy_ropes' in data['details'] else None,
                rope_diameter_m=0.025, rope_anchor_extension_ratio=0.4, diagonal_lean_ratio=0.2,
                window_sill_m=1.05, window_height_m=0.65, window_width_m=0.65, narrow_window_width_m=0.3)


def court_defaults(identifier, data):
    if identifier == 'AF-SAHEL-B05':
        return dict(courts=[dict(rank=1,ratio=1.0,aspect=1.0)],topology='axial',
                    threshold=dict(width_m=1.6,wall_m=0.35,height_m=2.8,material='MAT-COB'),
                    iwans=None,compartments=2,portico=dict(span_m=0.85,post_m=0.12),
                    north_hall=None,body_footprint=None,confidence='stylized')
    if identifier == 'AS-MIDE-B03':
        return dict(courts=[dict(rank=1, ratio=1.0, aspect=1.0)],topology='axial',
                    threshold=dict(width_m=1.6,wall_m=0.35,height_m=2.8,material='MAT-BURNT-BRICK'),
                    iwans=dict(count=4,min_open_ratio=0.8,bearing_ratio=0.05),compartments=0,
                    portico=None,north_hall=None,body_footprint='FP-RECT',confidence='stylized')
    counts = {'AF-SAHEL-B09': 1, 'AF-WEST-B05': 2, 'AF-WEST-B10': 3,
              'AS-IND-B13': 3, 'AS-CHI-B11': 3, 'AS-KOR-B08': 3,
              'AM-MESO-B03': 3, 'AM-AND-B07': 2}
    count = counts.get(identifier)
    if count is None:
        return None
    return dict(courts=[dict(rank=rank + 1, ratio=1.0, aspect=0.8) for rank in range(count)],
                topology='axial', threshold=dict(width_m=1.6, wall_m=0.35,
                height_m=3.6 if identifier == 'AF-WEST-B10' else 2.8, material=data['materials']['frame']),
                iwans=None, compartments=0,
                portico=dict(span_m=0.85, post_m=0.18) if any(t in data['details'] for t in ['gallery', 'wood_galleries']) else None,
                north_hall=dict(height_m=4.2, depth_m=9.0) if identifier == 'AS-CHI-B11' else None,
                body_footprint='FP-U' if identifier == 'AS-IND-B13' else 'FP-RECT', confidence='stylized')


def structure_defaults(identifier, data):
    bank = any(t in data['details'] for t in ['earth_bank', 'turf_bank'])
    walls=[]
    if any(t in data['details'] for t in ['thick_walls','thick_stone_walls','thick_earth_walls','high_walls']):
        walls.append(dict(role='exterior',min_thickness_m=data['wall_thickness_m'][0],
                          min_height_m=data['level_height_m'],material=data['materials']['infill'],from_level=0,to_level=data['floors'][1]-1))
    if 'high_enclosure' in data['details']:
        walls.append(dict(role='enclosure',min_thickness_m=0.45,min_height_m=3.6,
                          material=data['materials']['infill'],from_level=0,to_level=0))
    if 'double_wall' in data['details']:
        walls.append(dict(role='shell',min_thickness_m=1.2,min_height_m=data['level_height_m'],
                          material=data['materials']['infill'],from_level=0,to_level=data['floors'][1]-1))
    if any(t in data['details'] for t in ['stone_base','basalt_base','limestone_base','stone_earth_platform']):
        walls.append(dict(role='base',min_thickness_m=data['wall_thickness_m'][0],min_height_m=0.25,
                          material=data['materials']['base'],from_level=0,to_level=0))
    if 'stone_ground_floor' in data['details']:
        walls.append(dict(role='exterior',min_thickness_m=data['wall_thickness_m'][0],min_height_m=data['level_height_m'],
                          material='MAT-STONE-MORTAR',from_level=0,to_level=0))
    retaining=identifier in ['AF-SAHEL-B08','AS-HIM-B02']
    lattice='lattice' in data['details']
    log_joints='log_corners' in data['details']
    if identifier not in ['AF-NILE-B03', 'AF-NILE-B08', 'AS-SEA-B12', 'AS-SIB-B02'] and not bank and not walls and not retaining and identifier!='AM-MESO-B13' and not lattice and not log_joints:
        return None
    return dict(confidence='stylized', walls=walls,
                lightwell=dict(count=2, width_m=1.2, depth_m=1.2, border_m=0.15, material='MAT-ADOBE') if identifier == 'AF-NILE-B03' else None,
                bank=dict(width_m=0.8,height_m=0.4,material='MAT-TURF' if 'turf_bank' in data['details'] else 'MAT-COB',base_depth_m=0.15,gate_width_m=1.6) if bank else None,
                inner_tent=dict(width_ratio=0.65, depth_ratio=0.65, wall_height_m=1.8, roof_rise_m=0.5,
                                membrane_material='MAT-HIDE',frame_material='MAT-TIMBER-POST',door_width_m=0.9,door_height_m=1.35,
                                membrane_thickness_m=0.025,post_width_m=0.08,post_spacing_m=1.5) if identifier == 'AS-SIB-B02' else None,
                mooring=dict(count=3, material='MAT-CORDAGE', diameter_m=0.025, anchor_offset_m=2.0,
                             anchor_depth_m=1.0, anchor_material='MAT-TIMBER-POST', anchor_width_m=0.3, anchor_height_m=0.5) if identifier == 'AS-SEA-B12' else None,
                island=dict(height_m=0.6,water_depth_m=0.3,pile_depth_m=0.8,margin_m=2.0,pile_spacing_m=3.0,canal_width_m=2.0,garden_ratio=0.35,
                            material='MAT-COB',pile_material='MAT-TIMBER-POST') if identifier=='AM-MESO-B13' else None,
                retaining=dict(thickness_m=0.35,material='MAT-STONE-DRY',terrain_slope_deg=8.0,
                               terrace_rise_m=0.45,base_depth_m=0.2) if retaining else None,
                **({'high_hall':dict(core_level_height_m=4.2,wing_order=['east','west','north','south'],
                    passage_width_m=0.85,joint_overhang_m=0.0,terrace_core_door='declared',confidence='stylized')}
                    if identifier=='AF-NILE-B08' else {}),
                **({'lattice':dict(bay_width_m=1.2,rows=1,batten_width_m=0.035,batten_depth_m=0.035,
                                  material='MAT-WOOD-MORTISE',max_pieces=256)} if lattice else {}),
                **({'log_joints':dict(courses=4,course_spacing_m=0.22,diameter_m=0.14,
                                     extension_m=0.2,material='MAT-LOG')} if log_joints else {}))


def portal_entry(identifier, width=1.05, top=None, head=2.05, sill=0.0, clear=1.9):
    return dict(id=identifier, shape='trapezoid' if top is not None and top != width else 'rect',
                width_m=width, top_width_m=top if top is not None else width,
                head_m=head, sill_m=sill, min_clear_height_m=clear)


def portal_defaults(identifier, data):
    details = data['details']
    if data['bodies'][1] == 0 or data['envelope'] == 'open':
        return None
    entries, count, placement = [portal_entry('entry')], [1, 600], 'distributed'
    if 'trapezoidal_doors' in details:
        entries = [portal_entry('trapezoidal-entry', width=1.1, top=0.8)]
    elif 'differentiated_gates' in details:
        entries = [portal_entry('small-entry', width=1.0), portal_entry('large-entry', width=1.4, head=2.2)]
        count, placement = [2, 600], 'differentiated'
    elif 'low_entry' in details:
        entries, count = [portal_entry('low-entry', width=0.9, head=1.35, clear=1.2)], [1, 1]
    elif 'low_threshold' in details:
        entries, count = [portal_entry('low-threshold',width=1.05,head=2.05,sill=0.2,clear=1.8)], [1,1]
    elif 'single_door' in details:
        count = [1, 1]
    elif 'many_court_doors' in details:
        count, placement = [3, 600], 'court'
    elif 'multiple_doors' in details:
        count = [2, 600]
    else:
        return None
    return dict(entries=entries, count=count, placement=placement, confidence='stylized')


def site_gate_defaults(identifier, data):
    if 'single_gate' in data['details']:
        return dict(entries=[portal_entry('main-gate', width=1.6)], count=[1, 1], placement='axial', confidence='stylized')
    if any(t in data['details'] for t in ['axial_gates', 'passage_gate']):
        program = data.get('court_program')
        count = len(program['courts']) if program and not program['iwans'] else 1
        return dict(entries=[portal_entry('axial-gate', width=1.5)], count=[count, count], placement='axial', confidence='stylized')
    return None


def gallery_defaults(data):
    covered = any(trait in data['details'] for trait in ['gallery', 'covered_gallery', 'inner_gallery', 'connecting_galleries', 'galleries', 'wood_galleries', 'carved_gallery', 'veranda', 'continuous_veranda', 'porch', 'front_porch', 'front_shop_gallery', 'entry_gallery', 'portico', 'low_portico', 'arcade', 'columns'])
    return dict(enabled=covered, rf='RF-SHED', spec=roof_spec('RF-SHED'), height_m=2.2,
                width_m=1.5 if data['layout'] == 'ring' else 1.2 if data['layout'] == 'shinden' else 1.0 if data['layout'] in ['peristyle', 'atrium', 'iwan_court'] else 0.85,
                pitch_deg=10.0, max_span_m=3.0, support_spacing_m=1.5)


def level_height(data):
    cover = gallery_defaults(data)
    if not cover['enabled']:
        return 2.8
    return round(max(2.8, cover['height_m'] + max(data['overhang_m']) * math.tan(math.radians(max(data['roof_pitch_deg'])))
                     + cover['width_m'] * math.tan(math.radians(cover['pitch_deg'])) + 0.1), 3)


def roof_spec(roof, details=()):
    # Graphical heuristics, exported in every bundle; not archaeological measures.
    result = dict(axis='longitudinal', tiers=3, tier_inset_ratio=0.15, tier_rise_m=1.0,
                  drum_height_m=0.7, gambrel_break_ratio=0.55, gambrel_lower_pitch_deg=55.0,
                  saddle_rise_ratio=0.18, step_count=7, shell_sections=12,
                  parapet_height_m=0.4, drainage_side=2, dome_rise_ratio=1.0,
                  oculus_ratio=0.0, curve_lift_ratio=0.12, tent_crown_ratio=0.08,
                  shell_cross_rise_ratio=0.7, shell_long_rise_ratio=0.18,
                  round_segments=32, curve_sections=12)
    if roof == 'RF-SNOW':
        result['dome_rise_ratio'] = 0.8
    if roof == 'RF-SHELL':
        result.update(shell_cross_rise_ratio=0.8, shell_long_rise_ratio=0.15)
        if 'ogival_shell' in details:
            result['shell'] = dict(profile='ogival', rib_width_m=0.15, rib_depth_m=0.1,
                                   rib_spacing_m=1.5, material='MAT-COB')
            result['shell_cross_rise_ratio'] = 1.2
    if roof == 'RF-DOME':
        result['dome_rise_ratio'] = 0.65
    if roof in ['RF-DOME', 'RF-DOME-CONE'] and any(trait in details for trait in ['crown', 'high_crown']):
        result['oculus_ratio'] = 0.12
    if 'corbelled_dome' in details:
        result['corbel'] = dict(profile='dome', courses=32, rise_m=3.2, cap_span_m=0.8,
                                cap_thickness_m=0.25, min_bearing_m=0.1, material='MAT-STONE-DRY')
    if 'inward_roof' in details:
        result['drainage']='inward'
    if 'corbelled_vault' in details and roof == 'RF-FLAT':
        result['corbel'] = dict(profile='barrel', courses=10, rise_m=1.6, cap_span_m=0.8,
                                cap_thickness_m=0.25, min_bearing_m=0.1, material='MAT-STONE-MORTAR')
    return result

# Explicit correspondences in source order. A trade or storage activity attaches
# to a room or an existing form; it does not create a new architectural culture.
# Fields: kind | recipe IDs | geometric requirements | room/component usage.
FUNCTIONAL_ROWS = '''
form|ATL-CEL-B01|hearth|dwelling
form|OC-PAC-B02||dwelling
form|EUR-MED-B01||dwelling
form|EUR-EAST-B01|porch|dwelling
form|EUR-MED-B01||seasonal_dwelling
form|AM-SOUTH-B07|shore_access|dwelling
form|EUR-MED-B01||seasonal_dwelling
form|AM-PUEB-B05|rock_overhang|dwelling
form|AS-HIM-B10|cliff_cells|dwelling
form|AM-ARC-B02|earth_bank|dwelling
form|AM-PUEB-B06|pit|dwelling
form|EUR-MED-B01||dwelling
form|EUR-MED-B01||dwelling_storage
form|AF-NILE-B08|high_central_hall|dwelling
form|EUR-MED-B12|bays|dwelling
form|EUR-MED-B12|few_partitions|dwelling
form|EUR-NOR-B01|bays|dwelling
form|EUR-MED-B06|byre|dwelling_farm
form|EUR-MED-B06|byre|dwelling_livestock
form|AF-MAG-B02|courtyard|dwelling
form|EUR-MED-B06|courtyard|dwelling_farm
form|AF-WEST-B01|gallery|dwelling
form|EUR-EAST-B01|porch|dwelling
form|EUR-MED-B04|shed|dwelling
form|EUR-MED-B04|stair|dwelling
form|AS-ISL-B07|raised_posts|dwelling
form|AS-SEA-B01|raised_posts|dwelling
form|AS-SEA-B05|water|dwelling
form|AS-HIM-B04|gallery|dwelling
form|AS-STEP-B01||mobile_dwelling
form|AS-STEP-B01|crown|mobile_dwelling
form|AF-MAG-B10|guy_ropes|mobile_dwelling
form|AS-STEP-B02|poles|communal_mobile_dwelling
form|AM-ARC-B02|earth_bank|dwelling
form|EUR-EAST-B01|log_corners|dwelling
form|AF-MAG-B04|masonry_joints|dwelling
form|AF-MAG-B01||dwelling
form|EUR-MED-B02|party_walls|dwelling
form|EUR-MED-B02|party_walls|dwelling
form|EUR-MED-B02|rear_yard|dwelling
form|EUR-MED-B02||dwelling
form|EUR-MED-B05||dwelling
form|EUR-MED-B03|jetty|dwelling
form|EUR-MED-B05|shopfront|dwelling_shop
usage|AF-WEST-B09|work_cells|dwelling_workshop
usage|MED-ANT-B04|shopfront|dwelling_shop
form|AF-MAG-B02|passage_gate|dwelling
form|AS-CHI-B11|successive_courts|dwelling
form|AF-MAG-B02|courtyard|dwelling
form|AF-MAG-B01|roof_access|dwelling
form|AM-PUEB-B02|setbacks|dwelling
form|EUR-MED-B02|side_corridor|dwelling
form|AF-NILE-B02|exterior_stair|dwelling
form|MED-ANT-B03|covered_gallery|dwelling
usage|MED-ANT-B04|multiple_households|dwelling
usage|AF-WEST-B09|work_cells|dwelling_workshop
usage|EUR-MED-B05|shopfront|dwelling_shop
usage|MED-ANT-B03|courtyard|prestige_dwelling
usage|MED-ANT-B11|courtyard|farm_dwelling
form|MED-ANT-B05|gallery|dwelling
form|MED-ANT-B05|portico|dwelling
form|MED-ANT-B05|courtyard|dwelling
form|MED-ANT-B02|atrium|dwelling
form|MED-ANT-B02|impluvium|dwelling
form|MED-ANT-B03|covered_gallery|dwelling
form|MED-ANT-B04|multiple_households|dwelling
usage|MED-ANT-B04|shopfront|dwelling_shop
usage|EUR-MED-B05|shopfront|dwelling_shop
form|AS-MIDE-B01|courtyard|dwelling
form|AS-STEP-B02|guy_ropes|dwelling
component|AF-MAG-B02|courtyard|domestic_yard
component|AF-MAG-B02|enclosure|enclosed_yard
component|EUR-MED-B06|garden|vegetable_garden
component|EUR-MED-B06|garden|herb_garden
component|MED-ANT-B11|garden|orchard
component|MED-ANT-B11|garden|vineyard
usage|EUR-MED-B06||food_storage
usage|EUR-MED-B04|pit|underground_storage
usage|AS-MIDE-B06|vault_cells|vaulted_storage
usage|EUR-MED-B02||attic_storage
usage|EUR-MED-B01||food_storage
component|EUR-MED-B06|shed|firewood_storage
component|EUR-MED-B04|shed|tool_storage
usage|EUR-MED-B06|barn|tool_storage
component|EUR-MED-B06|shed|cart_storage
component|EUR-MED-B06|hearth|bread_oven
usage|AS-ISL-B05|detached_annex|separate_kitchen
usage|AM-PNW-B04||food_smoking
usage|AM-PNW-B04||fruit_drying
component|EUR-MED-B06|well|well
component|AF-MAG-B02|fountain|cistern
component|AF-MAG-B03|fountain|yard_basin
usage|EUR-MED-B06|detached_annex|latrine
component|EUR-MED-B06|pit|cesspit
component|EUR-MED-B06|drain|soakaway
component|AF-MAG-B03|fountain|wash_basin
usage|MED-ANT-B03|fountain|domestic_bath
component|AF-WEST-B08|domestic_shrine|domestic_shrine
component|AS-ISL-B05|family_shrine|domestic_altar
usage|AF-SAHEL-B07||pigeon_loft
usage|EUR-MED-B06|detached_annex|kennel
component|EUR-MED-B06|garden|apiary
component|MED-ANT-B03|covered_gallery|pergola
form|EUR-MED-B06|courtyard|farm_dwelling
form|EUR-MED-B06|enclosure|farm_dwelling
form|EUR-MED-B12|barn|farm_dwelling
form|EUR-MED-B06|courtyard|farm_dwelling
form|EUR-MED-B06|courtyard|farm_dwelling
usage|EUR-MED-B06|barn|grain_storage
usage|EUR-MED-B06|barn|tithe_storage
usage|EUR-MED-B06|barn|hay_storage
component|EUR-MED-B06|yard|threshing_floor
form|ATL-CEL-B05|raised_posts|grain_storage
form|EUR-NOR-B05|raised_posts|grain_storage
form|AF-MAG-B07|stone_cells|collective_grain_storage
component|AF-SAHEL-B07|pit|underground_grain_storage
form|AF-NILE-B04|silo|grain_storage
usage|EUR-MED-B06|shed|tool_storage
usage|EUR-MED-B06|byre|cattle_shelter
usage|EUR-MED-B06|byre|horse_shelter
usage|EUR-MED-B06|byre|sheep_shelter
usage|EUR-MED-B06|byre|goat_shelter
usage|EUR-MED-B06|byre|pig_shelter
usage|EUR-MED-B06|detached_annex|poultry_shelter
component|EUR-MED-B06|enclosure|poultry_yard
usage|EUR-MED-B06|detached_annex|rabbit_shelter
usage|EUR-MED-B06|detached_annex|hunting_kennel
component|AF-SOUTH-B02|enclosure|pasture_enclosure
component|AF-SOUTH-B02|livestock_pen|livestock_pen
component|AF-EAST-B07|livestock_pen|livestock_sorting
component|AF-SOUTH-B02|fountain|animal_water
usage|EUR-MED-B06|barn|loft_hay_storage
component|EUR-MED-B06|yard|haystack
usage|EUR-MED-B06|shed|animal_feeding
form|AS-HIM-B04||seasonal_dwelling
usage|AS-HIM-B04||seasonal_dairy
usage|EUR-MED-B06||dairy
usage|EUR-MED-B06||cheese_making
component|AF-SOUTH-B02|enclosure|seasonal_sheep_enclosure
usage|EUR-MED-B06|shed|timber_drying
usage|EUR-MED-B06|open_work_yard|sawmill
component|EUR-MED-B06|pit|saw_pit
component|EUR-MED-B06|hearth|charcoal_mound
component|EUR-MED-B06|hearth|lime_kiln
component|EUR-MED-B06|garden|apiary
'''.strip().splitlines()


def inspired_source_reference(identifier):
    metadata = INSPIRED_ONLY_RECIPES.get(identifier)
    if not metadata:
        return []
    path = metadata['source']
    headings = [i for i, line in enumerate((ROOT / path).read_text(encoding='utf-8').splitlines(), 1)
                if line.startswith('## ' + identifier + ' ')]
    if len(headings) != 1:
        raise ValueError(f'Expected one provenance heading for {identifier} in {path}')
    return [dict(path=path, line=headings[0])]


def build(source=None):
    # Supplying an extracted inventory permits an in-memory preparation check
    # without writing recipes.json or source-inventory.json.
    if source is None:
        source = json.loads((DATA / 'source-inventory.json').read_text(encoding='utf-8'))
    by_id = {entry['id']: entry for entry in source['entries']}
    catalogue = dict(schema_version='2', catalogue_version='atlas-houses-3',
                     sources=source['sources'], packs=[], materials=[], recipes=[], coverage=[],
                     geometry_traits=[dict(id=identifier, operator=operator, status='planned')
                                      for identifier, operator in sorted(TRAITS.items())],
                     functional_mappings=[])
    for pack in source['packs']:
        catalogue['packs'].append(dict(**pack, eras=PACK_ERAS.get(pack['id'], ['A', 'M']),
                                     confidence='stylized', sources=[source['sources'][0]['path']]))
    for entry in source['entries']:
        if entry['id'].startswith('MAT-'):
            catalogue['materials'].append(dict(id=entry['id'], label=entry['label'],
                                              roles=MATERIAL_ROLES[entry['id'][4:]],
                                              pattern=MATERIAL_PATTERNS[entry['id'][4:]], origin='atlas', source_ref=None))
    catalogue['materials'] += [dict(id='MAT-WOVEN-TEXTILE', label='Textile tissé (source bâtiment)', roles=['infill', 'coating', 'cladding'], pattern='fabric', origin='source_building', source_ref='AF-MAG-B10'),
                              dict(id='MAT-BONE', label='Os porteurs (source bâtiment)', roles=['frame', 'support', 'base'], pattern='stone', origin='source_building', source_ref='AM-ARC-B01 AM-ARC-B06'),
                              dict(id='MAT-CORDAGE', label='Cordage, fibre non précisée (source bâtiment)', roles=['rope'], pattern='fabric', origin='source_building', source_ref='AF-MAG-B10 AS-SIB-B02 AS-STEP-B02 AS-SEA-B12'),
                              dict(id='MAT-LIMESTONE',label='Calcaire (source bâtiment)',roles=['base'],pattern='stone',origin='source_building',source_ref='AM-MESO-B10')]
    if len(FUNCTIONAL_ROWS) != len(source['functional_forms']):
        raise ValueError(f'Functional mapping has {len(FUNCTIONAL_ROWS)} rows, expected {len(source["functional_forms"])}')
    for row, entry in zip(FUNCTIONAL_ROWS, source['functional_forms']):
        kind, references, traits, usage = row.split('|')
        identifiers = references.split()
        for identifier in identifiers:
            if identifier not in by_id:
                raise ValueError(f'Unknown functional recipe {identifier}')
        for trait in traits.split():
            if trait not in TRAITS:
                raise ValueError(f'Unknown functional trait {trait}')
        catalogue['functional_mappings'].append(dict(label=entry['label'], source_line=entry['source_line'],
                                                    kind=kind, recipe_ids=identifiers, traits=traits.split(),
                                                    usage=usage, status='planned'))
    mapped = set()
    for pack, sequence in ASSIGNMENTS.items():
        roles = ROLE_ASSIGNMENTS[pack].split()
        contexts = CONTEXT_ASSIGNMENTS[pack].split()
        if len(sequence.split()) != len(roles) or len(roles) != len(contexts):
            raise ValueError(f'Explicit roles/contexts length mismatch in {pack}')
        for number, token in enumerate(sequence.split(), 1):
            identifier = f'{pack}-B{number:02}'
            entry = by_id[identifier]
            mapped.add(identifier)
            marker = token[0] if token[0] in '@+!~' else ''
            key = token[1:] if marker else token
            role = ROLE_CODES[roles[number - 1]]
            supported = role not in ['non_domestic', 'landscape']
            reason = ('Habitation ou ensemble résidentiel décrit par la colonne emprise/élévation.' if role in ['dwelling', 'residential_ensemble', 'communal_dwelling', 'mixed_residential'] else
                      'Dépendance ou composant architectural/domestique, sélection explicite sans tirage résidentiel.' if supported else
                      'Monument ou ouvrage sans programme résidentiel : réservé à une étape hors moteur maisons.')
            catalogue['coverage'].append(dict(id=identifier, role=role, reason=reason,
                                             profile=key if supported else None,
                                             status='planned' if supported else 'outside_houses'))
            if not supported:
                continue
            parameters = copy.deepcopy(PROFILES[key])
            apply_parameters(parameters, OVERRIDES.get(identifier, {}))
            apply_parameters(parameters, CORRECTIONS.get(identifier, {}))
            parameters = complete_parameters(identifier, parameters, role)
            variants = variants_for(identifier, parameters, role)
            context_number, pattern = contexts[number - 1].split(':')
            context_id = f'{pack}-S{context_number}'
            context = by_id[context_id]
            pattern_id = 'SET-' + pattern
            if pattern_id not in by_id:
                raise ValueError(f'Unknown settlement pattern: {pattern_id}')
            temporal, chronology_note, chronology_confidence = chronology(identifier, pack, context)
            roof_confidence = ('uncertain' if identifier in ['ATL-CEL-B08', 'OC-AUS-B03', 'AF-EAST-B08'] else
                               'not_applicable' if parameters['roof_system'] == 'uncovered' else 'source_preset')
            roof_confidence = INSPIRED_ONLY_RECIPES.get(identifier, {}).get('roof_confidence', roof_confidence)
            catalogue['recipes'].append(dict(
                id=identifier, pack_id=pack, label=entry['label'], priority=entry['priority'],
                role=role, profile=key, parameters=parameters, variants=variants,
                component_kind=COMPONENT_KINDS.get(identifier), temporal=temporal,
                confidence='stylized', roof_confidence=roof_confidence,
                sources=[dict(path=source['sources'][0]['path'], line=entry['source_line']),
                         dict(path=source['sources'][0]['path'], line=context['source_line'])] +
                        inspired_source_reference(identifier),
                source_description=entry['columns'],
                settlement_pattern=pattern_id, settlement_archetype=context_id,
                subtradition=context['label'], context_note=context['columns'][-1],
                chronology_note=chronology_note, chronology_confidence=chronology_confidence,
                compound_pattern='LOT-FARM' if identifier in ['EUR-MED-B06', 'EUR-NOR-B09', 'AS-CHI-B05'] else LOT_BY_LAYOUT[parameters['layout']],
                surface_language=entry['columns'][-1],
                weight=0 if role in ['domestic_annex', 'spatial_component'] or identifier in PRESTIGE_IDS else
                       50 if entry['priority'] == 'P0' else 25 if entry['priority'] == 'P1' else 10,
            ))
            if identifier in TRADITION_ASSIGNMENTS:
                catalogue['recipes'][-1]['tradition_id'] = TRADITION_ASSIGNMENTS[identifier]
            if identifier in INSPIRED_ONLY_IDS:
                catalogue['recipes'][-1]['inspired_only'] = True
    source_buildings = {identifier for identifier in by_id if re.search(r'-B\d+$', identifier)}
    if mapped != source_buildings:
        raise ValueError(f'Catalogue/source mismatch: missing {source_buildings - mapped}, extra {mapped - source_buildings}')
    if not (set(TRADITION_ASSIGNMENTS) | INSPIRED_ONLY_IDS) <= {r['id'] for r in catalogue['recipes']}:
        raise ValueError('Unknown executable recipe in tradition/inspired-only assignments')
    return catalogue


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    catalogue = build()
    content = json.dumps(catalogue, ensure_ascii=False, indent=2) + '\n'
    destination = DATA / 'recipes.json'
    if args.check:
        if not destination.exists() or destination.read_text(encoding='utf-8') != content:
            raise SystemExit('Recipes stale: run python rust/scripts/house-recipes.py')
    else:
        destination.write_text(content, encoding='utf-8', newline='\n')
    print(f"{len(catalogue['coverage'])} classified entries; {len(catalogue['recipes'])} designed recipes")
