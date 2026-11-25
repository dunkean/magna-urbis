/** Working equipment is selected by the engine's archetype. The same job can occupy
 * quite different buildings in different cultures. Hyphenated names also serve farmsteads. */
const groups = {
  lodging:
    'field_shelter farm_steward farm_worker_hut summer_pasture_hut shepherd_hut logger_hut forest_camp_lodge ranger_lodge hunting_lodge miners_barracks mine_overseer_house waterworks_keeper harbour_master_house ferry_keeper_house bridge_keeper_house village_assembly_hall road_hospice healer_house schoolhouse court_house cemetery_keeper_house public_guesthouse council_house roadside_inn caravanserai waystation trade_office porter_shelter monastic_dormitory monastic_refectory monastic_infirmary monastic_scriptorium monastery_guesthouse hermitage house longhouse roundhouse ger hut pit_house farmhouse isolated_farm inn isolated_inn',
  grain: 'barn_harvest barn_hay barn_tithe granary_ground granary_raised granary_fortified seed_store farm_warehouse date_store rice_store root_crop_store fodder_barn animal_feed_shed monastery_barn granary raised_granary barn hayrick',
  bench: 'farm_workhouse tool_shed cart_shed orchard_shed vegetable_garden_shed veterinary_shelter mining_toolhouse town_maintenance_shed weigh_house shed lean_to covered_yard stilt_river_workshop',
  drying: 'hop_drying_house fruit_drying_house malt_house oast_house brick_drying_shed ice_house',
  mill: 'water_gristmill wind_gristmill animal_gristmill boat_gristmill tidal_gristmill hand_grinding_house rice_pounding_shed threshing_barn mill isolated_mill',
  trough: 'byre horse_stable sheepfold goat_shelter pigsty camel_stable yak_shelter reindeer_shelter llama_shelter hunting_kennel military_stable posting_stable pack_animal_shelter stable',
  birds: 'poultry_house dovecote pigeon_tower',
  vessels: 'dairy_house cheese_house winery_cellar brewery vinegar_house candlemaker_shop soapmaker_shop fish_oil_house arcane_alchemy_tower',
  press: 'oil_press_house wine_press_house cider_press_house sugarcane_press papermill fulling_mill fulling_workshop',
  kiln: 'bakery communal_oven_house pottery_kiln_house brick_kiln_house glasshouse glass_annealing_house gypsum_kiln_house lime_kiln_house limeburners_hut charcoal_burner_hut pitch_boiling_hut temple_kitchen bakehouse cook_house kitchen',
  smoke: 'smokehouse_meat butcher_house salting_house fish_smokehouse fish_salting_house eel_processing_house shellfish_processing_hut lizardfolk_stilt_smokehouse',
  timber: 'sawpit_shelter mechanical_sawmill woodcutters_workshop lumber_drying_shed timber_warehouse bark_processing_shed woodcarver_workshop rafting_shed woodworker_shop carpenter_shed',
  apiary: 'beekeepers_shelter',
  hoist: 'mine_head_shelter mine_winch_house dwarven_ore_elevator',
  adit: 'mine_adit_shelter',
  ore: 'ore_sorting_shed ore_washing_house ore_crushing_house ore_storehouse charcoal_fuel_shed goblin_sorting_hall clay_diggers_shed',
  forge: 'mine_smithy bloomery_shelter smelting_house refining_workshop assay_house mint_workshop smithy farrier_shop smith_toolshop foundry hydraulic_hammer_shop metalworking_shop locksmith_shop dwarven_deep_smelter goblin_scrap_forge hammer_mill',
  stone: 'quarry_tool_shed stonecutters_shed stone_store giant_megalithic_store',
  crane: 'quarry_crane_house',
  pottery: 'potter_workshop tileworks',
  water: 'salt_boiling_house waterwheel_pump_house water_lifting_shed irrigation_gate_house well_house cistern_house fountain_house thermae nymphaeum hammam sabil onsen well_pavilion stone_wellhead public_bathhouse public_washhouse public_latrine holy_well well sweat_bath bath',
  net: 'fisher_hut fish_drying_shed net_loft sailmakers_loft ropewalk_shed',
  boat: 'boat_house canoe_house shipwright_workshop boat_repair_shed river_barge_shed',
  store: 'fish_merchant_store canal_warehouse river_port_warehouse sea_port_warehouse merchant_store salt_storehouse monastery_store ritual_storehouse refuse_store arsenal arcane_reagent_store elven_tree_store merfolk_coral_store necropolis_bone_store storeroom storehouse',
  market: 'fish_market_hall market_hall',
  wheels: 'wheelwright_shop cooper_shop wagon_repair_shop',
  loom: 'basket_workshop mat_weaving_house weaving_house spinning_shed silk_reeling_house cloth_drying_house tailor_shop felt_workshop drow_silk_workshop',
  hides: 'wool_washing_house dyehouse tannery skin_curing_shed leather_workshop parchment_workshop shoemaker_shop saddler_shop',
  guard: 'tollhouse customs_house checkpoint_guardhouse beach_guard_house fire_watch_house watchtower signal_tower coast_beacon_tower border_guardpost rural_gatehouse roadblock_house military_barracks fortified_outpost watch_hut farm_tower tower gatehouse isolated_tower',
  shrine:
    'wayside_shrine ceremonial_hall monastic_main_sanctuary monastic_cloister chapel_nave chapel_belfry country_prayer_hall minaret shinto_shrine buddhist_hall hindu_temple pagoda stupa hof_hall classical_shrine spirit_hall roadside_oratory pilgrim_chapel cemetery_chapel summit_temple cliff_monastery rock_cut_sanctuary shrine isolated_shrine roadside_temple',
  memorial: 'mortuary_house ossuary mausoleum funeral_pyre_shelter marabout_tomb wayside_marker calvary megalith barrow summit_cairn tomb_monument memorial_column sacred_grove',
  fungi: 'myconid_spore_hall myconid_fungal_dryer spore_store cultivation',
  resin: 'resin_collector_hut elven_resin_workshop arcane_energy_house',
} as const;
export type RuralTrade = keyof typeof groups;
const profiles = new Map<string, RuralTrade>();
for (const [profile, names] of Object.entries(groups)) {
  for (const name of names.split(' ')) profiles.set(name.replaceAll('_', '-'), profile as RuralTrade);
}
export function ruralTrade(use: string): RuralTrade | undefined {
  return profiles.get(use.replaceAll('_', '-'));
}

// A multipart works can put a quarryman's archetype on its crane, a miller's on
// its dwelling, etc. The physical part takes precedence where it describes a job.
const partTrades: Readonly<Record<string, RuralTrade>> = {
  'cutting-shed': 'stone',
  'shaft-house': 'adit',
  'gin-house': 'hoist',
  'ore-shed': 'ore',
  'ore-store': 'ore',
  'mill-dwelling': 'lodging',
  'mill-hut': 'mill',
  'mill-store': 'grain',
  'drying-loft': 'drying',
  'fuel-shed': 'timber',
  'shaft-furnace': 'forge',
  'smelt-house': 'forge',
  'boiling-house': 'vessels',
  'smith-hut': 'forge',
  'glass-shop': 'kiln',
  'glass-house': 'kiln',
  'hack-shed': 'drying',
  'boat-shed': 'boat',
  'fisher-house': 'net',
  'smoke-house': 'smoke',
  'press-cellar': 'vessels',
  'press-house': 'press',
  'mill-body': 'mill',
  'asbad-room': 'mill',
  'lodge-stable': 'trough',
  'lodge-kennel': 'trough',
  'lodge-hall': 'lodging',
  'shepherd-hut': 'lodging',
  'hermit-cell': 'lodging',
  'garden-shed': 'bench',
  'well-basin': 'water',
};
export function partTrade(use: string, form: string): RuralTrade | undefined {
  if (form === 'shop-body' && ['potter-workshop', 'pottery-kiln-house'].includes(use.replaceAll('_', '-'))) return 'pottery';
  return partTrades[form] ?? ruralTrade(use);
}
