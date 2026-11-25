//! Settlement kinds, from a lone building or a ruin to a metropolis of wards.
//!
//! The kind is resolved once per site from the population, the culture, the
//! site archetype found by settlement placement (`harbor`, `bridge`, `hilltop`,
//! `spur`, `pass`, `island`…), the programme context (isolated roles, the
//! settlement's condition) and an explicit `settlementForm`. It sets the macro
//! grammar: centres, quarters, walls, epochs and street skeleton. Quarters,
//! parcels, programme and buildings then run unchanged.
//!
//! The quarter pipeline is a town grammar: given eight people it still draws
//! four quarters, a ring road and outbound connectors. The small kinds (single
//! building, ruin, farmstead, camp, hamlet, street village) are therefore laid
//! out here directly, as plots fronting a road, a track or a lane, with the
//! same `Layout` contract (quarters, blocks, streets, phases, structure).
use crate::urban::warnings;
use super::{
    Block, GrowthPhase, Layout, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanCenter, UrbanDistrict, UrbanEvent, UrbanMetrics, UrbanStructure, composition,
    geometry as g, macroplan, profiles, roles, routing,
};
use crate::rng::Rng;
use crate::settlements::demographics;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// One building alone: mill, inn, tower, shrine, wayside temple.
    Single,
    /// One ruined building (a lone farm or isolated structure in ruins).
    Ruin,
    /// House, barn and yard on one plot, a track to the road.
    Farmstead,
    /// Tents or huts in a ring around an open centre (nomadic cultures).
    Camp,
    /// A few farms along a track or a road, no walls.
    Hamlet,
    /// One ribbon of long plots along the road, cross-lanes to the fields.
    StreetVillage,
    /// Grouped around a green or a church.
    NucleatedVillage,
    /// Market town, open or palisaded.
    MarketTown,
    /// Walled town with gates and faubourgs.
    WalledTown,
    /// City: several growth rings, an old circuit, faubourgs.
    City,
    /// Metropolis: several centres (wards), older wall rings turned boulevards,
    /// faubourgs and absorbed villages along the radials.
    Metropolis,
}
const ALL: [Kind; 11] = [
    Kind::Single,
    Kind::Ruin,
    Kind::Farmstead,
    Kind::Camp,
    Kind::Hamlet,
    Kind::StreetVillage,
    Kind::NucleatedVillage,
    Kind::MarketTown,
    Kind::WalledTown,
    Kind::City,
    Kind::Metropolis,
];
impl Kind {
    pub fn id(self) -> &'static str {
        match self {
            Kind::Single => "single",
            Kind::Ruin => "ruin",
            Kind::Farmstead => "farmstead",
            Kind::Camp => "camp",
            Kind::Hamlet => "hamlet",
            Kind::StreetVillage => "street-village",
            Kind::NucleatedVillage => "nucleated-village",
            Kind::MarketTown => "market-town",
            Kind::WalledTown => "walled-town",
            Kind::City => "city",
            Kind::Metropolis => "metropolis",
        }
    }
    /// French label for the UI.
    pub fn label(self) -> &'static str {
        match self {
            Kind::Single => "Bâtiment isolé",
            Kind::Ruin => "Ruine",
            Kind::Farmstead => "Ferme isolée",
            Kind::Camp => "Campement",
            Kind::Hamlet => "Hameau",
            Kind::StreetVillage => "Village-rue",
            Kind::NucleatedVillage => "Village groupé",
            Kind::MarketTown => "Bourg",
            Kind::WalledTown => "Ville close",
            Kind::City => "Cité",
            Kind::Metropolis => "Métropole",
        }
    }
    pub fn from_id(id: &str) -> Option<Self> {
        ALL.into_iter().find(|k| k.id() == id)
    }
    /// Laid out by `lay_out`, without the quarter grammar.
    pub fn small(self) -> bool {
        matches!(
            self,
            Kind::Single
                | Kind::Ruin
                | Kind::Farmstead
                | Kind::Camp
                | Kind::Hamlet
                | Kind::StreetVillage
        )
    }
    /// A small kind laid out round the site's own centre: a user-fixed
    /// foundation keeps this plan (the others slide along their road).
    pub fn centred(self) -> bool {
        self == Kind::Camp
    }
}
/// French label of a layout archetype (a kind id); empty when unknown.
pub fn label(id: &str) -> &'static str {
    Kind::from_id(id).map_or("", Kind::label)
}

/// Site archetypes where a small town is worth a wall, or a village clusters.
const DEFENSIVE: [&str; 4] = ["hilltop", "spur", "pass", "island"];
/// Cultures whose villages are enclosed by definition: the draw that leaves most villages open skips them.
const FORTIFIED_VILLAGES: [&str; 10] = [
    "kraal", "maori-pa", "guarani-village", "mississippian", "native-iroquoian",
    "nubian-fortified", "ksar-oasis", "levantine-tell", "celtic-oppidum", "norse-ringfort",
];

fn culture<'a>(site: &'a Site, cfg: &'a LayoutConfig) -> &'a str {
    if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    }
}

mod camp_profiles;
pub(in crate::urban) use camp_profiles::{native_camp, ring_camp, ring_geometry, camp_ring_max, camp_unit_max, ring_extent, court_extent, camp_growth_land};
use camp_profiles::{organic_camp, cultural_camp};

pub(super) fn resolve(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> Kind {
    if let Some(kind) = Kind::from_id(&cfg.settlement_form) {
        return kind;
    }
    let culture = culture(site, cfg);
    let pop = site.population;
    let state = cfg.programme.state.as_str();
    let role = cfg.programme.intent.as_str();
    if roles::is_isolated(role) {
        return if state == "ruined" {
            Kind::Ruin
        } else if role == "isolated-farm" {
            Kind::Farmstead
        } else {
            Kind::Single
        };
    }
    // The automatic grammar follows the shared demographic class
    // (settlements/demographic_classes.json): one classification, no second set
    // of population bands. Only the town class keeps grammar sub-steps (walls,
    // district city) that depend on culture and site, not on a new class.
    let class = demographics::class_of(pop);
    if class == "farmstead" {
        return if state == "ruined" {
            Kind::Ruin
        } else {
            Kind::Farmstead
        };
    }
    if cfg.settlement_form == "auto" && pop < 5000 && cultural_camp(culture, pop, cfg) {
        return Kind::Camp;
    }
    match class {
        "hamlet" => return Kind::Hamlet,
        "village" => {
            let kind = match cfg.settlement_form.as_str() {
                "ribbon" => Kind::StreetVillage,
                "nucleated" => Kind::NucleatedVillage,
                _ => village_form(site, cfg, culture, roads),
            };
            // Beside a larger neighbour, a string with no free stretch long
            // enough for its households gathers inside the core left to it.
            return if kind == Kind::StreetVillage && !string_fits(site, cfg, roads) { Kind::NucleatedVillage } else { kind };
        }
        "city" => return Kind::City,
        "metropolis" | "megacity" => return Kind::Metropolis,
        _ => {}
    }
    let fortifies = profiles::fortification(
        profiles::settlement_profile(culture, pop, 3),
        requested_enclosure(cfg),
        pop,
    ) != "none";
    let defensive = DEFENSIVE.contains(&cfg.site_archetype.as_str());
    if pop < 5000 {
        if fortifies && (pop >= 2500 || defensive) {
            Kind::WalledTown
        } else {
            Kind::MarketTown
        }
    } else if fortifies {
        Kind::WalledTown
    } else {
        Kind::City
    }
}
/// Enclosure type precedence: explicit type (`wall`, `palisade`, `none`) >
/// explicit style (its family: a bastioned style asks for a wall) > named
/// profile (`culture`, resolved by `profiles::fortification`) > grammar default
/// (`effective`: no enclosure for small kinds and market towns). Style
/// precedence is in `fortification::resolve`: explicit style of the same family
/// > the culture's style table (population, period, prosperity).
pub(in crate::urban) fn requested_enclosure(cfg: &LayoutConfig) -> &str {
    if cfg.fortification == "culture" && cfg.fortification_style != "auto" {
        super::fortification::family(&cfg.fortification_style)
    } else {
        &cfg.fortification
    }
}

/// Street village where a through road carries the place (bridge, pass,
/// valley floor) and the culture has no clustered village form; clustered on
/// heights, islands and shores; otherwise a deterministic draw per site.
fn village_form(site: &Site, cfg: &LayoutConfig, culture: &str, roads: &[Street]) -> Kind {
    let form = composition::culture_data(culture, site.population)["village"]["form"]
        .as_str()
        .unwrap_or("auto");
    // A culture whose village has an enclosure grammar of its own (oval, square,
    // organic, terraced) is a clustered village; the street ribbon is for the
    // cultures that have no village plan.
    let shaped = !composition::culture_data(culture, site.population)["village"]["enclosure"]["shape"]
        .is_null();
    if form != "auto" || shaped || nearest(site.center, roads, site.radius.max(80.0)).is_none() {
        return Kind::NucleatedVillage;
    }
    match cfg.site_archetype.as_str() {
        "hilltop" | "spur" | "island" | "harbor" | "lakeshore" => Kind::NucleatedVillage,
        "bridge" | "pass" => Kind::StreetVillage,
        // A ribbon of a few hundred inhabitants is already a kilometre of road: past 350
        // people the village gathers round its centre instead.
        _ if site.population >= 350 => Kind::NucleatedVillage,
        "valley" => Kind::StreetVillage,
        _ => {
            if Rng::new(&format!("settlement-kind:{}", site.key)).chance(0.5) {
                Kind::StreetVillage
            } else {
                Kind::NucleatedVillage
            }
        }
    }
}

/// The configuration the kind applies: only fields left on their automatic
/// value change (`suburbs: auto`, `peripheralRoad: auto`, `fortification:
/// culture`, the default three epochs, `programme.intent: settlement`). The kind id is
/// written to `settlement_form`, so resolving the effective config again gives
/// the same kind.
pub(super) fn effective(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> (LayoutConfig, Kind) {
    let kind = resolve(site, cfg, roads);
    let mut c = cfg.clone();
    // Saved pre-refactor scenes keep their former geometry.
    if cfg.footprint.mechanism == "legacy" {
        return (c, kind);
    }
    // An explicit style is an override: it fixes the enclosure type before the
    // grammar's « no wall below a market town » default (which only replaces `culture`).
    c.fortification = requested_enclosure(cfg).into();
    c.settlement_form = kind.id().into();
    let default_epochs = cfg.footprint.epochs == super::FootprintConfig::default().epochs;
    let set = |field: &mut String, when: &str, value: &str| {
        if field == when {
            *field = value.into();
        }
    };
    match kind {
        Kind::Single | Kind::Ruin | Kind::Farmstead | Kind::Camp | Kind::Hamlet => {
            set(&mut c.suburbs, "auto", "none");
            set(&mut c.peripheral_road, "auto", "none");
            // Native camp grammars own their enclosure (e.g. the kraal hedge).
            // A legacy camp still keeps the former generic, unfortified plan.
            let native_camp = kind == Kind::Camp
                && native_camp(culture(site, cfg), site.population, cfg);
            if !native_camp {
                set(&mut c.fortification, "culture", "none");
            }
            if default_epochs {
                c.footprint.epochs = 1;
            }
            if matches!(kind, Kind::Farmstead | Kind::Ruin) && c.programme.intent == "settlement" {
                c.programme.intent = "isolated-farm".into();
            }
        }
        Kind::StreetVillage | Kind::NucleatedVillage => {
            set(&mut c.suburbs, "auto", "none");
            set(&mut c.peripheral_road, "auto", "none");
            // A culture's wall belongs to its towns: only a few villages are enclosed, by a deterministic
            // draw per site (likelier on defensive sites and for larger villages), except where the
            // enclosure is the settlement's identity (ringforts, pā, kraals, ksour, palisaded villages).
            if c.fortification == "culture" && !FORTIFIED_VILLAGES.contains(&culture(site, cfg)) {
                let grown = ((site.population as f64 - 200.0) / 1000.0).clamp(0.0, 1.0);
                let base = if DEFENSIVE.contains(&cfg.site_archetype.as_str()) { 0.3 } else { 0.08 };
                if !Rng::new(&format!("village-wall:{}", site.key)).chance(base + 0.15 * grown) {
                    c.fortification = "none".into();
                }
            }
            if default_epochs {
                c.footprint.epochs = 1;
            }
        }
        Kind::MarketTown => {
            set(&mut c.fortification, "culture", "none");
            set(&mut c.suburbs, "auto", "few");
            // A small bourg grew in two periods (founding, market growth); a
            // larger one keeps the default three, its faubourg included.
            if default_epochs && site.population < 2500 {
                c.footprint.epochs = 2;
            }
        }
        Kind::WalledTown | Kind::City => {}
        Kind::Metropolis => {
            set(&mut c.suburbs, "auto", "many");
            if default_epochs {
                c.footprint.epochs = 4;
            }
        }
    }
    (c, kind)
}

/// After the programme: restore the user's configuration,
/// and fade the streets of an abandoned or ruined place to tracks (the plan
/// stays; widths and frontage contacts are unchanged).
/// Record the kind as the layout archetype, before the programme reads it.
pub(super) fn stamp(layout: &mut Layout, kind: Kind, original: &LayoutConfig) {
    if original.footprint.mechanism != "legacy" {
        layout.archetype = kind.id().into();
    }
}
pub(super) fn finish(layout: &mut Layout, kind: Kind, original: &LayoutConfig) {
    if original.footprint.mechanism == "legacy" {
        return;
    }
    layout.config = Some(original.clone());
    let state = layout
        .programme
        .as_ref()
        .map_or(original.programme.state.as_str(), |p| {
            p.context.state.as_str()
        });
    if matches!(state, "abandoned" | "ruined") {
        for s in &mut layout.streets {
            if matches!(
                s.role.as_str(),
                "street"
                    | "lane"
                    | "market"
                    | "gate-street"
                    | "ring"
                    | "peripheral"
                    | "outbound"
                    | "processional"
                    | "quay"
                    | "wall-lane"
            ) {
                s.role = "track".into();
            }
        }
        layout.warnings.push(warnings::tracks_for_decay(kind.id(), state));
    }
}

// ---------------------------------------------------------------------------
// Small kinds, laid out directly.

mod street_geometry;
use street_geometry::{dist, at, unit, perp, arc, slice, point_at, Near, nearest, side, settle, street, track};
mod frontage_plan;
use frontage_plan::{WHOLE_PLOT, MILL_REACH, bank, plot_size, Plan, wanted_homes, linear_homes, string_fits, field_lane, linear};
mod small_layout;
pub(super) use small_layout::lay_out;
mod isolated_sites;
use isolated_sites::homestead;
mod camps;
use camps::camp;
/// A large nomad camp grown past one ring (`campGrowth`): one tent piece per
/// tent on both sides of each ring track. `concentric`: full rings around a
/// first ring of about 60 tents, joined by four radial tracks; `clusters`:
/// camps of about 40 tents around the first one, each its own ring and
/// common, joined to it by a track.
#[path = "kinds_camp_variation.rs"]
pub(in crate::urban) mod camp_variation;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod field_lane_tests;
#[cfg(test)]
mod demographic_morphology_tests;
#[path = "kinds_street_village.rs"]
mod street_village;

#[cfg(test)]
#[path = "scenario_matrix_tests.rs"]
mod scenario_matrix_tests;

#[cfg(test)]
#[path = "kinds_camp_mapping_tests.rs"]
mod camp_kind_mapping_tests;

#[cfg(test)]
#[path = "kinds_camp_consumer_activation_tests.rs"]
mod camp_consumer_tests;
#[cfg(test)]
#[path = "camps_pnw_replay_tests.rs"]
mod camps_pnw_replay_tests;
