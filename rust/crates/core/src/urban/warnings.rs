//! Short English warnings for display and detailed diagnostics for profiling.

use std::{collections::BTreeSet, fmt, ops::Range};

pub(crate) fn log_warning_detail(_detail: fmt::Arguments<'_>) {
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var_os("URBAN_PROFILE").is_some() {
        eprintln!("  warning: {_detail}");
    }
}

pub(crate) fn is_population_shortfall(line: &str) -> bool {
    line.starts_with("Population ") && line.ends_with(" — housing shortfall")
}

pub(crate) fn quarter_outline_key(line: &str) -> Option<usize> {
    let (key, _) = line.strip_prefix("Quarter edit Q")?.split_once(' ')?;
    key.parse().ok()
}

/// A cached parcel cut can be reused at a different block index.
pub(super) fn block_warning_index(line: &str, block: usize) -> Option<Range<usize>> {
    const PREFIX: &str = "Block ";
    let (index, _) = line.strip_prefix(PREFIX)?.split_once(' ')?;
    (index.parse::<usize>().ok() == Some(block)).then_some(PREFIX.len()..PREFIX.len() + index.len())
}

pub(crate) fn warning_detail_text(detail: fmt::Arguments<'_>) -> String {
    detail.to_string()
}

pub(crate) const QUARTER_STAIRS: &str = "Quarter stairs — streets too steep";
pub(crate) const CANALS_PREFIX: &str = "Canals: ";

pub(crate) fn clustered_street_village() -> String {
    log_warning_detail(format_args!(
        "The street village uses a clustered core because no road runs through the site."
    ));
    "Clustered village — no through road".into()
}

pub(crate) fn no_suburbs() -> String {
    log_warning_detail(format_args!(
        "The site’s approaches cannot support suburbs. Their budget remains visible in the composition."
    ));
    "No suburbs — unsuitable approaches".into()
}

pub(crate) fn flanked_wall() -> String {
    log_warning_detail(format_args!(
        "A bastioned trace is infeasible on this outline, so the flanked enclosure is retained."
    ));
    "Flanked wall — bastioned trace infeasible".into()
}

pub(crate) fn concentric_wall() -> String {
    log_warning_detail(format_args!(
        "An attached enclosure is infeasible on this outline, so the concentric enclosure is retained."
    ));
    "Concentric wall — attached trace infeasible".into()
}

pub(crate) fn dry_core_missing() -> String {
    log_warning_detail(format_args!("No dry core is available, so the town’s land budget remains unallocated."));
    "No town core — no dry land".into()
}

pub(crate) fn buildable_core_missing() -> String {
    log_warning_detail(format_args!(
        "No accessible buildable core is available, so the programme remains unallocated."
    ));
    "No town core — inaccessible land".into()
}

pub(crate) fn town_terraces() -> String {
    log_warning_detail(format_args!(
        "The site is too steep for streets, so the town gains land via stairs and terraces."
    ));
    "Stairs and terraces — steep site".into()
}

pub(crate) fn ribbon_without_access() -> String {
    log_warning_detail(format_args!(
        "No physically viable internal axis was found for the linear foundation, leaving its access unresolved."
    ));
    "No village access — unsuitable terrain".into()
}

pub(crate) fn ribbon_without_regional_road() -> String {
    log_warning_detail(format_args!(
        "No regional road lies nearby. A linear foundation supplies the ribbon’s internal axis without a confirmed regional connection."
    ));
    "Village lane only — no regional road".into()
}

pub(crate) fn land_shortfall(allocated: f64, target: f64, percent: f64) -> String {
    log_warning_detail(format_args!(
        "Constrained footprint: {allocated:.0} m² allocated out of {target:.0} m² planned ({percent:.1} % short)."
    ));
    format!("Town land {percent:.1} % short — site constraints")
}

pub(crate) fn automatic_land_budget(density: f64, densities: &str) -> String {
    log_warning_detail(format_args!(
        "Automatic land budget: {density:.1} people per gross hectare on average. Densities by era (core to edge): {densities} people/ha. This is a composition budget rather than built capacity."
    ));
    format!("Land budget {density:.1} people/ha — automatic density")
}

pub(crate) fn separate_port_wall() -> String {
    log_warning_detail(format_args!("The link to the port is impassable, so a separate circuit is retained."));
    "Separate port wall — no viable link".into()
}

pub(crate) fn port_outside_wall() -> String {
    log_warning_detail(format_args!(
        "The shore is impassable for the port enclosure, so the quarter remains outside the walls."
    ));
    "Port outside walls — impassable shore".into()
}

pub(crate) fn incompatible_wall_style(style: &str, kind: &str) -> String {
    log_warning_detail(format_args!(
        "Fortification style “{style}” is incompatible with {kind}, so the cultural style is retained."
    ));
    format!("Wall style {style} skipped — incompatible fortification")
}

pub(crate) fn wall_style_for_relief(style: &str) -> String {
    log_warning_detail(format_args!("The terrain requires a flanked enclosure in place of the {style} trace."));
    "Flanked wall — steep site".into()
}

pub(crate) fn stilt_water_share(share: f64, target: f64) -> String {
    log_warning_detail(format_args!(
        "Stilt occupation is {share:.0} % over water. The shore and terrain limit the target of {target:.0} %."
    ));
    format!("Stilt land {share:.0}/{target:.0} % — shore constraints")
}

pub(crate) fn tracks_for_decay(kind: &str, state: &str) -> String {
    log_warning_detail(format_args!("The streets of {kind} were reduced to tracks ({state})."));
    "Streets became tracks — settlement decay".into()
}

pub(crate) fn plain_village_ribbon(homes: f64, need: f64, more: f64) -> String {
    log_warning_detail(format_args!(
        "The site-read street village was too short ({homes:.0} of {need:.0} households), so a plain ribbon was used ({more:.0} households)."
    ));
    format!("Village ribbon {more:.0}/{need:.0} households — short road")
}

pub(crate) fn regional_approach_steep() -> String {
    log_warning_detail(format_args!("An impassable regional approach cannot be connected on this slope."));
    "No road connection — steep approach".into()
}

pub(crate) fn quarter_stairs() -> String {
    log_warning_detail(format_args!("The slope is too steep for quarter streets, so stairs divide the quarters."));
    QUARTER_STAIRS.into()
}

pub(crate) fn no_quarter_road() -> String {
    log_warning_detail(format_args!("The terrain is too constrained for a drivable route to reach this quarter."));
    "No road access — constrained terrain".into()
}

pub(crate) fn house_slope_relaxed(percent: f64) -> String {
    log_warning_detail(format_args!(
        "The site is too steep for the ordinary rules, so houses are allowed on steeper slopes, with stepped foundations ({percent:.0} % relaxation)."
    ));
    format!("House slope limits eased {percent:.0} % — steep site")
}

pub(crate) fn farms_clustered(before: f64, target: f64, housed: f64) -> String {
    log_warning_detail(format_args!(
        "There was no land for farms along the lane ({before:.0} of {target:.0} households housed), so they were grouped around the centre ({housed:.0} households housed)."
    ));
    format!("Farms clustered, {housed:.0}/{target:.0} households — narrow roadside")
}

pub(crate) fn footprint_expanded(before: f64, target: f64, factor: f64, housed: f64) -> String {
    log_warning_detail(format_args!(
        "The plan was too tight ({before:.0} of {target:.0} households housed), so the town was laid out on {factor:.0} times the land ({housed:.0} households housed)."
    ));
    format!("Town expanded ×{factor:.0}, {housed:.0}/{target:.0} households — cramped plan")
}

pub(crate) fn no_housing() -> String {
    log_warning_detail(format_args!(
        "The site or the culture’s layout rules leave no buildable lots. Try another site, a larger radius or another culture."
    ));
    "No housing — no buildable lots".into()
}

pub(crate) fn regional_access_restored() -> String {
    log_warning_detail(format_args!("Regional access was restored after the town footprint was moved."));
    "Road access restored — footprint moved".into()
}

pub(crate) fn isolated_streets_removed(count: usize) -> String {
    log_warning_detail(format_args!("Removed {count} isolated street fragments."));
    format!("Streets removed: {count} — disconnected fragments")
}

pub(crate) fn wall_neighbour(name: Option<&str>) -> String {
    if let Some(name) = name {
        log_warning_detail(format_args!(
            "The enclosure was not raised because its circuit would cross the land of {name}."
        ));
        format!("No wall — neighbour too close: {name}")
    } else {
        log_warning_detail(format_args!(
            "The enclosure was not raised because its circuit would cross a neighbouring town’s land."
        ));
        "No wall — neighbour too close".into()
    }
}

pub(crate) fn land_neighbours(names: &str) -> String {
    log_warning_detail(format_args!("No free land remains beside {names}, so the town is announced empty."));
    format!("Town empty — land claimed by {names}")
}

pub(crate) fn housing_neighbours(housed: f64, target: f64, names: &str) -> String {
    log_warning_detail(format_args!(
        "The land of {names} limits this town. {housed:.0} of {target:.0} households were housed."
    ));
    format!("Households {housed:.0}/{target:.0} — land claimed by {names}")
}

pub(crate) fn parcel_coverage(block: usize, residual: f64, overlap: f64) -> String {
    log_warning_detail(format_args!(
        "Block {block} has {residual:.3} m² of residual parcel coverage and {overlap:.3} m² of overlap."
    ));
    format!("Block {block} — {residual:.3} m² gap, {overlap:.3} m² overlap")
}

pub(crate) fn parcel_area_residual(block: usize, area: f64) -> String {
    log_warning_detail(format_args!("Block {block}: cadastral area residual {area:.3} m²."));
    format!("Block {block} — {area:.3} m² cadastral residual")
}

pub(crate) fn open_block(block: usize) -> String {
    log_warning_detail(format_args!(
        "Block {block} lacks continuous contact with a street, so its land is left as open space."
    ));
    format!("Block {block} left open — no street contact")
}

pub(crate) fn missing_native_recipe(culture: &str, period: &str) -> String {
    log_warning_detail(format_args!("No supported native recipe for culture:{culture}; period:{period}."));
    format!("No native recipe — {culture}, {period}")
}

pub(crate) fn isolated_functions() -> String {
    log_warning_detail(format_args!(
        "Urban functions are retained but do not apply to an isolated settlement. Only its intent is applied."
    ));
    "Town functions skipped — isolated site".into()
}

pub(crate) fn port_storage_deficit() -> String {
    log_warning_detail(format_args!(
        "A port function was requested without a measured navigable frontage (a quay on a wide enough channel). Port storage remains a deficit. The function does not create water, channels or quays."
    ));
    "Port storage missing — no navigable shore".into()
}

pub(crate) fn stepped_activity(step: f64) -> String {
    log_warning_detail(format_args!(
        "Buildings at this steep activity site are kept on stepped foundations, with up to {step:.2} m of height difference per building."
    ));
    format!("Stepped foundations, {step:.2} m rise — steep site")
}

pub(crate) fn isolated_farm_reserve() -> String {
    log_warning_detail(format_args!(
        "No lot meets the ordinary rules for the isolated farm, so its land is reserved as drawn."
    ));
    "Farm land reserved — no suitable lot".into()
}

pub(crate) fn lot_override_missing(id: &str) -> String {
    log_warning_detail(format_args!(
        "The override for lot “{id}” was skipped because the lot could not be found."
    ));
    format!("Lot {id} override skipped — lot missing")
}

pub(crate) fn lot_override_invalid(id: &str) -> String {
    log_warning_detail(format_args!("The override for lot “{id}” is invalid."));
    format!("Lot {id} override skipped — invalid use")
}

pub(crate) fn households_scattered(count: usize) -> String {
    log_warning_detail(format_args!(
        "Redistributed {count} households to vacant frontages without increasing the population."
    ));
    format!("Households moved: {count} — vacant frontages")
}

pub(crate) fn strict_cultural_borrowing() -> String {
    log_warning_detail(format_args!("Strict mode refuses declared cultural borrowing."));
    "Cultural borrowing blocked — strict mode".into()
}

pub(crate) fn walled_land_reduced() -> String {
    log_warning_detail(format_args!(
        "The walled footprint was reduced to fill its blocks within the +30 % population margin."
    ));
    "Walled area reduced — housing within +30 %".into()
}

pub(crate) fn vacant_land_released(quarters: usize, blocks: usize) -> String {
    log_warning_detail(format_args!(
        "Vacant land returned to the countryside: {quarters} quarters and {blocks} edge blocks."
    ));
    format!("Vacant land released — {quarters} quarters, {blocks} outer blocks")
}

pub(crate) fn landing_abandoned() -> String {
    log_warning_detail(format_args!(
        "The selected bank houses fewer households than the original site, so the settlement stays at its original site and the landing is dropped."
    ));
    "Landing skipped — fewer homes".into()
}

pub(crate) fn no_buildable_quarters() -> String {
    log_warning_detail(format_args!("No quarter can be built at this site within the given radius."));
    "No buildable quarters — site and radius".into()
}

pub(crate) fn housing_blocks_left_open(count: usize) -> String {
    log_warning_detail(format_args!("Left {count} blocks as open space because they exceeded housing demand."));
    format!("{count} blocks left open — surplus housing land")
}

pub(crate) fn streetless_blocks_left_open(count: usize) -> String {
    log_warning_detail(format_args!("Left {count} blocks without street frontage as open space."));
    format!("{count} blocks left open — no street frontage")
}

pub(crate) fn unserved_quarters(count: usize, area: f64) -> String {
    log_warning_detail(format_args!(
        "Returned {count} quarters without drivable access to the countryside ({area:.0} m² counted as a deficit)."
    ));
    format!("{count} quarters released — no road access")
}

pub(crate) fn quarter_role_missing(key: &str) -> String {
    log_warning_detail(format_args!(
        "The role override for quarter “{key}” was skipped because the quarter could not be found."
    ));
    format!("Quarter {key} role override skipped — quarter missing")
}

pub(crate) fn quays_outside_port(outside: f64, total: f64) -> String {
    log_warning_detail(format_args!(
        "{outside:.0} m of quay frontage out of {total:.0} m is outside the port district, in the central quarter or on another bank."
    ));
    format!("Quays outside port district — {outside:.0}/{total:.0} m")
}

pub(crate) fn slope_densified() -> String {
    log_warning_detail(format_args!(
        "Smaller plots and taller houses within the culture’s limits were tried before extending onto the slopes."
    ));
    "Denser housing — steep site".into()
}

pub(crate) fn slope_terraces() -> String {
    log_warning_detail(format_args!(
        "Contour terraces with stepped foundations extend housing onto the flanks the town had left aside."
    ));
    "Housing terraces — steep slopes".into()
}

pub(crate) fn slope_frontage() -> String {
    log_warning_detail(format_args!("Terraced plots line both sides of the existing roads on the flanks."));
    "Roadside terraces — steep slopes".into()
}

pub(crate) fn slope_shortfall(housed: f64, target: f64) -> String {
    let percent = (housed / target * 100.0).floor();
    log_warning_detail(format_args!(
        "Usable terraces and the culture’s maximum density can accommodate only {housed:.0} of {target:.0} requested households."
    ));
    format!("Housing {percent:.0} % — steep site")
}

pub(crate) fn spring_site_missing(x: f64, y: f64, reach: f64) -> String {
    log_warning_detail(format_args!(
        "Spring at {x:.1},{y:.1}: no dry accessible water-building site within {reach} m."
    ));
    format!("Spring unused — no accessible site within {reach} m")
}

pub(crate) fn unbuilt_blocks_released(count: usize) -> String {
    log_warning_detail(format_args!("Returned {count} unbuilt blocks to fields, along with their streets."));
    format!("{count} blocks returned to fields — unbuilt land")
}

pub(crate) fn population_shortfall(achieved: u32, target: u32) -> String {
    log_warning_detail(format_args!("Population target not reached: {achieved}/{target} inhabitants."));
    format!("Population {achieved}/{target} — housing shortfall")
}

pub(crate) fn building_deficit(slope: usize, shape: usize, source: usize, households: f64) -> String {
    let count = slope + shape + source;
    log_warning_detail(format_args!(
        "{count} lots with no admissible native building ({slope} due to slope, {shape} due to shape, {source} due to a missing functional source). {households:.1} households were not housed, and no smaller building was substituted."
    ));
    format!("Unbuilt lots: {count}, unhoused households: {households:.1} — no fitting building")
}

pub(crate) fn canals(length: f64, locks: usize) -> String {
    format!("Canals: {length:.0} m — {locks} locks")
}

pub(crate) fn waterfront_uses_removed(roles: &BTreeSet<String>) -> String {
    let count = roles.len();
    let dropped = roles.iter().map(String::as_str).collect::<Vec<_>>().join(", ");
    log_warning_detail(format_args!(
        "Water-related demands were removed because no waterfront was measured: {dropped}. No river is created."
    ));
    format!("{count} water uses dropped — no waterfront")
}

/// A requested building count names a role without a catalogue row.
pub(crate) fn count_role_unknown(role: &str) -> String {
    format!("Building count {role} ignored — unknown building type")
}

pub(crate) fn is_count_shortfall(line: &str) -> bool {
    line.starts_with("Building count ") && line.ends_with(" — no suitable site")
}

/// A forced building count left short after allocation.
pub(crate) fn programme_count_short(role: &str, placed: u32, requested: u32) -> String {
    format!("Building count {role}: {placed}/{requested} placed — no suitable site")
}

pub(crate) fn planned_capacity(percent: f64, steps: &[String], limited: bool) -> String {
    log_warning_detail(format_args!(
        "Planned capacity: {} — {percent:.0} % of households can be housed{}.",
        if steps.is_empty() {
            "tissue as drawn".to_owned()
        } else {
            steps.join(", ")
        },
        if limited {
            "; terrain or cultural limits constrain the footprint"
        } else {
            ""
        }
    ));
    if limited {
        format!("Planned capacity {percent:.0} % — site or density limits")
    } else {
        format!("Planned capacity {percent:.0} % — adapted plan")
    }
}

pub(crate) fn parcel_capacity(percent: f64, steps: &[String]) -> String {
    let steps = steps.join(", ");
    log_warning_detail(format_args!(
        "Estimated lot capacity after allocation: {steps} — the model covers {percent:.0} % of household demand. Resident capacity was not assessed."
    ));
    format!("Lot capacity {percent:.0} % — model estimate")
}

pub(crate) fn cave_blocks_removed(count: usize) -> String {
    log_warning_detail(format_args!("{count} blocks on cave rock removed."));
    format!("Blocks removed: {count} — solid cave rock")
}

pub(crate) fn manual_site_blocked(key: &str) -> String {
    log_warning_detail(format_args!("{key}: the manual position is wet or on solid rock."));
    format!("{key} skipped — water or rock")
}

pub(crate) fn cave_population_reduced(key: &str, requested: u32, placed: u32) -> String {
    log_warning_detail(format_args!(
        "{key}: lowered from {requested} to {placed} inhabitants to fit its cave chamber."
    ));
    format!("{key}: {placed}/{requested} people — small cave chamber")
}

pub(crate) fn cave_site_missing(key: &str, requested: u32) -> String {
    log_warning_detail(format_args!(
        "{key} ({requested} inhabitants) was not placed because no open cave floor remains."
    ));
    format!("{key} unplaced ({requested} people) — no cave floor")
}

pub(crate) fn site_missing(key: &str, requested: u32) -> String {
    log_warning_detail(format_args!("{key} ({requested} inhabitants): no suitable position available."));
    format!("{key} unplaced ({requested} people) — no suitable site")
}

pub(crate) fn map_population_reduced(key: &str, requested: u32, placed: u32) -> String {
    log_warning_detail(format_args!(
        "{key}: lowered from {requested} to {placed} inhabitants because there was no room for it on the map."
    ));
    format!("{key}: {placed}/{requested} people — map too small")
}

pub(crate) fn manual_site_unsuitable(key: &str) -> String {
    log_warning_detail(format_args!(
        "{key}: manual position bypasses slope, flood or buildable-land preferences."
    ));
    format!("{key}: pinned site kept — terrain constraints")
}

pub(crate) fn water_site_missing(key: &str, site: &str) -> String {
    log_warning_detail(format_args!(
        "{key}: no {site} site on the water, even on a narrow or steep shore. The town was placed away from the water without this role."
    ));
    format!("{key}: no {site} — unsuitable shore")
}

pub(crate) fn requested_site_missing(key: &str, site: &str) -> String {
    log_warning_detail(format_args!("{key}: no {site} site available. Another available site was sampled."));
    format!("{key}: alternate site — no suitable {site}")
}

pub(crate) fn cave_sites_missing(count: usize) -> String {
    log_warning_detail(format_args!("{count} places were not placed because no open cave floor remains."));
    format!("Places unplaced: {count} — no cave floor")
}

pub(crate) fn activity_access_limit(count: usize, limit: usize) -> String {
    log_warning_detail(format_args!("{count} activity sites beyond {limit} get no access path."));
    format!("{count} activity sites unserved — limit {limit}")
}

pub(crate) fn activity_outside_map(key: &str, x: f64, y: f64) -> String {
    log_warning_detail(format_args!(
        "Activity site {key} is outside the map at ({x:.1}, {y:.1}), so it has no access path."
    ));
    format!("No path to {key} — outside the map")
}

pub(crate) fn activity_approach_thinned(key: &str, before: usize, after: usize) -> String {
    log_warning_detail(format_args!("Activity site {key}: approach of {before} points thinned to {after}."));
    format!("{key} approach {after}/{before} points — route simplified")
}

pub(crate) fn settlements_unreachable(count: usize) -> String {
    log_warning_detail(format_args!("{count} settlements cannot be reached by road."));
    format!("{count} settlements unreachable — no road access")
}

pub(crate) fn wet_road_sections(count: usize) -> String {
    log_warning_detail(format_args!("{count} road sections over open water were removed."));
    format!("Road sections removed: {count} — open water")
}

pub(crate) fn dead_road_sections(count: usize) -> String {
    log_warning_detail(format_args!("{count} dead-end road sections without a destination were removed."));
    format!("Road sections removed: {count} — no destination")
}

pub(crate) fn map_exits(obtained: usize, total: usize, detail: &str) -> String {
    log_warning_detail(format_args!("Map exits: {obtained} of {total} obtained ({detail})."));
    format!("Map exits: {obtained}/{total} — site constraints")
}

pub(crate) fn quarter_edit_missing(quarter: &str) -> String {
    log_warning_detail(format_args!(
        "Quarter edit Q{quarter} was ignored because the quarter could not be found."
    ));
    format!("Quarter edit Q{quarter} — quarter missing")
}

pub(crate) fn quarter_redraw_missing(quarter: usize) -> String {
    log_warning_detail(format_args!("Quarter Q{quarter} is missing from the redrawn plan."));
    format!("Quarter edit Q{quarter} — absent from redraw")
}

pub(crate) fn quarter_redraw_unstable(quarter: usize) -> String {
    log_warning_detail(format_args!(
        "Quarter Q{quarter} could not be redrawn because its outline is unstable between layouts."
    ));
    format!("Quarter edit Q{quarter} — unstable outline")
}

pub(crate) fn quarter_shape_ignored(quarter: usize, reason: &str) -> String {
    log_warning_detail(format_args!("Quarter edit Q{quarter}: outline ignored ({reason})."));
    format!("Quarter edit Q{quarter} — outline kept: {reason}")
}

pub(crate) fn quarter_clipped_neighbours(quarter: usize, count: usize) -> String {
    log_warning_detail(format_args!(
        "The new shape of Q{quarter} clipped {count} blocks in neighbouring quarters."
    ));
    format!("Quarter edit Q{quarter} — {count} neighbouring blocks clipped")
}

pub(crate) fn quarter_street_intrusion(quarter: usize) -> String {
    log_warning_detail(format_args!(
        "A street in the new layout of Q{quarter} encroached on a neighbouring block, so it was removed."
    ));
    format!("Quarter edit Q{quarter} — street crossed neighbouring block")
}

pub(crate) fn quarter_streets_skipped(quarter: usize, count: usize) -> String {
    log_warning_detail(format_args!(
        "Removed {count} streets in the new layout of Q{quarter} that ran along a neighbouring block."
    ));
    format!("Quarter edit Q{quarter} — {count} streets removed at neighbours")
}

pub(crate) fn quarter_no_blocks(quarter: usize) -> String {
    log_warning_detail(format_args!("The new layout of Q{quarter} leaves no buildable blocks."));
    format!("Quarter edit Q{quarter} — no buildable blocks")
}

pub(crate) fn quarter_blocks_unchanged(quarter: usize) -> String {
    log_warning_detail(format_args!("Redrawing Q{quarter} did not change any block. Only the lots changed."));
    format!("Quarter edit Q{quarter} — only lots changed")
}

pub(crate) fn quarters_deleted(quarters: usize, streets: usize) -> String {
    log_warning_detail(format_args!("The edit removed {quarters} quarters and {streets} local streets."));
    format!("Quarter edit — {quarters} quarters, {streets} local streets removed")
}

pub(crate) fn services_displaced(count: usize) -> String {
    log_warning_detail(format_args!("Moved {count} services without reserved blocks to individual lots."));
    format!("Quarter edit — {count} services moved to lots")
}

pub(crate) fn lot_split_ignored(id: &str, reason: &str) -> String {
    log_warning_detail(format_args!("Lot edit {id}: split ignored ({reason})."));
    format!("Lot edit {id} — split skipped: {reason}")
}

pub(crate) fn lot_part_unserved(id: &str, part: usize) -> String {
    log_warning_detail(format_args!("Part {part} of lot {id} has no street access."));
    format!("Lot edit {id} — part {part} lacks street access")
}

pub(crate) fn lot_edit_missing(id: &str) -> String {
    log_warning_detail(format_args!("Lot {id} could not be found. Its quarter may have changed."));
    format!("Lot edit {id} — lot missing")
}

pub(crate) fn lot_shape_ignored(id: &str, reason: &str) -> String {
    log_warning_detail(format_args!("Lot edit {id}: outline ignored ({reason})."));
    format!("Lot edit {id} — outline kept: {reason}")
}

pub(crate) fn lot_neighbour_unserved(id: &str, neighbour: &str) -> String {
    log_warning_detail(format_args!(
        "The new outline of lot {id} would cut off street access for lot {neighbour}."
    ));
    format!("Lot edit {id} — lot {neighbour} would lose street access")
}

pub(crate) fn lot_absorbed(id: &str, absorbed: &str) -> String {
    log_warning_detail(format_args!("Lot {id} absorbed lot {absorbed}."));
    format!("Lot edit {id} — absorbed lot {absorbed}")
}

pub(crate) fn public_lot_kept(id: &str) -> String {
    log_warning_detail(format_args!(
        "Lot {id} holds a service or a public space. Its deletion was ignored. Edit the quarter instead."
    ));
    format!("Lot edit {id} — protected public lot")
}

pub(crate) fn lot_left_garden(id: &str) -> String {
    log_warning_detail(format_args!(
        "Lot {id} was left as a garden because there was no neighbouring lot to merge it into."
    ));
    format!("Lot edit {id} — garden, no neighbour to merge")
}

pub(crate) fn lot_no_admissible_use(id: &str) -> String {
    log_warning_detail(format_args!("Lot {id} has no admissible use for a new draw."));
    format!("Lot edit {id} — no eligible use")
}

pub(crate) fn block_edit_ignored(block: usize, reason: &str) -> String {
    log_warning_detail(format_args!("Block edit {block}: ignored ({reason})."));
    format!("Block edit {block} — skipped: {reason}")
}

pub(crate) fn block_part_missing(key: &str) -> String {
    log_warning_detail(format_args!("Block edit {key} was ignored because the part could not be found."));
    format!("Block edit {key} — part missing")
}

pub(crate) fn quarter_split_ignored(quarter: usize, reason: &str) -> String {
    log_warning_detail(format_args!("Quarter edit {quarter}: parts ignored ({reason})."));
    format!("Quarter edit {quarter} — split skipped: {reason}")
}

pub(crate) fn quarter_part_missing(key: &str) -> String {
    log_warning_detail(format_args!("Quarter edit {key} was ignored because the part could not be found."));
    format!("Quarter edit {key} — part missing")
}

pub(crate) fn public_blocks_kept(key: impl fmt::Display, count: usize) -> String {
    log_warning_detail(format_args!("Kept {count} blocks holding a service or a public space in quarter {key}."));
    format!("Quarter edit {key} — {count} public blocks kept")
}

pub(crate) fn block_slivers_dropped(quarter: usize, count: usize, minimum: f64) -> String {
    log_warning_detail(format_args!("Quarter edit {quarter}: {count} block slivers under {minimum} m² dropped."));
    format!("Quarter edit {quarter} — {count} blocks below {minimum} m² dropped")
}
