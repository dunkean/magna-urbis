//! Contextual demand from demographics, functions, resources and the service catalogue.

use crate::urban::{Layout, composition, roles, warnings, culture::CultureMapping};

use super::{Demand, ProgrammeContext, ProgrammeFunctions, camps};

/// Tokens with a real consumer (`programme_tokens.json`, shared with the UI
/// suggestions). Any other imported string is kept in the context and has no
/// effect: no economic need is invented for an unknown token. Lore applies
/// only its first recognised entry.
fn recognised_token(kind: &str, token: &str) -> bool {
    static TOKENS: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    TOKENS.get_or_init(|| serde_json::from_str(include_str!("../programme_tokens.json")).expect("programme tokens"))[kind]
        .get(token)
        .is_some()
}
/// Provenance tag of a demand another culture builds (the `monuments` facet
/// of the style sheet), followed by that culture's id.
pub(super) const STYLE: &str = "style:";
pub(super) fn demand(key: &str, function: &str, amount: f64, domestic: bool, why: String) -> Demand {
    Demand {
        id: format!("{key}/demand/{function}"),
        function: function.into(),
        unit: if domestic {
            "domesticUnits"
        } else {
            "usefulAreaM2"
        }
        .into(),
        requested: amount,
        target_area: if domestic { amount * 70.0 } else { amount },
        target_frontage: match function {
            "warehouse" => 9.0,
            "collective" => 8.0,
            "market" => 8.0,
            _ => 4.0,
        },
        provenance: vec![why],
        requires: if function == "warehouse" {
            vec!["navigableAccess".into()]
        } else {
            vec![]
        },
        parcel_capacity: 0.0,
        built_capacity: 0.0,
        open_capacity: 0.0,
        deficit: amount,
        reasons: vec![],
        role: String::new(),
        sites: 0,
        site: String::new(),
        landmark: false,
        district: String::new(),
        placement: String::new(),
    }
}
/// Role id of demands created before the service catalogue.
pub(super) fn default_role(function: &str) -> &'static str {
    match function {
        "domestic" => "dwelling",
        "mixed" => "dwelling.shop",
        "market" => "commerce.market",
        "common" => "open.common",
        "workshop" => "craft.workshop",
        "warehouse" => "commerce.warehouse",
        _ => "civic.hall",
    }
}

pub(super) fn initial_demands(
    layout: &Layout,
    population: u32,
    context: &ProgrammeContext,
    cultural_functions: &str,
    cultures: &[CultureMapping],
    warnings: &mut Vec<String>,
) -> (Vec<Demand>, ProgrammeFunctions, bool) {
    let n = f64::from(population);
    let role = if context.functions.is_some() { "explicit" } else { "automatic" };
    let functions = context.functions.unwrap_or_else(|| ProgrammeFunctions::automatic(population, cultural_functions == "communal", context.navigable_access));
    if context.functions.is_some_and(ProgrammeFunctions::active) && roles::is_isolated(&context.intent) {
        warnings.push(warnings::isolated_functions());
    }
    // A hamlet has no shop: its few households farm.
    let mixed_share = if population < 150 {
        0.0
    } else { functions.mixed_share(population) };
    let occupancy = roles::settlement_occupancy(&layout.culture, population);
    // Households of the cultural size (extended families in courtyard cultures).
    let households = n / occupancy.household_size;
    let mut demands = vec![
        demand(
            &layout.key,
            "domestic",
            households * (1.0 - mixed_share),
            true,
            format!(
                "population:{population}; profile:{} persons/domesticUnit; culture:{}; period:{}",
                occupancy.household_size, layout.culture, context.period
            ),
        ),
        demand(
            &layout.key,
            "mixed",
            households * mixed_share,
            true,
            format!("functions:{role}; mixed household share:{mixed_share}"),
        ),
    ];
    demands.push(demand(
        &layout.key,
        "common",
        (n * functions.commons_per_capita(cultural_functions == "communal"))
        .max(30.0),
        false,
        format!("functions:{role}; culture profile:{cultural_functions}; open common, no building"),
    ));
    let known_work = context
        .resources
        .iter()
        .filter(|r| recognised_token("resources", r))
        .cloned()
        .collect::<Vec<_>>();
    if let Some(work_area) = functions.workshop_area(population, !known_work.is_empty()) {
        let mut d = demand(
            &layout.key,
            "workshop",
            work_area,
            false,
            format!("functions:{role}; known resources:{}", known_work.join(",")),
        );
        if !known_work.is_empty() {
            d.requires
                .push(format!("knownResource:{}", known_work.join("|")));
        }
        demands.push(d);
    }
    // A river or sea pixel never creates this demand or its access evidence.
    let warehouse_area = functions.warehouse_area(population);
    if let Some(warehouse_area) = warehouse_area {
        demands.push(demand(
            &layout.key,
            "warehouse",
            warehouse_area,
            false,
            format!(
                "declared port siting:{}; functions:{role}",
                context.navigable_access
            ),
        ));
    }
    if let Some(token) = context
        .lore
        .iter()
        .find(|s| recognised_token("lore", s))
    {
        let mut d = demand(
            &layout.key,
            "collective",
            (n * 0.8).max(250.0),
            false,
            format!("explicit lore:{}; first recognised entry applied:{token}; other entries kept without effect", context.lore.join(",")),
        );
        d.role = format!("lore.{token}");
        d.landmark = true;
        demands.push(d);
    }
    let isolated_rule = roles::isolated(&context.intent);
    let isolated = isolated_rule.is_some();
    if !isolated {
        // Data-driven building roles, landmarks first so they win central land.
        let mut needs = roles::services_for_layout(layout, population, functions);
        needs.sort_by_key(|s| !s.entry.landmark);
        for need in needs {
            let e = &need.entry;
            let mut d = demand(
                &layout.key,
                &e.function,
                need.area * need.sites as f64,
                false,
                format!(
                    "services:{}; population:{population}; {} site(s) of {:.0} m²; site:{}",
                    roles::family(&layout.culture),
                    need.sites,
                    need.area,
                    e.site
                ),
            );
            let main_market = e.function == "market" && e.per == 0.0;
            d.id = if main_market && !demands.iter().any(|x| x.id.ends_with("/demand/market")) {
                format!("{}/demand/market", layout.key)
            } else if e.culture.is_empty() {
                format!("{}/demand/{}", layout.key, e.role)
            } else {
                // Another culture's building (style sheet): its own demand, built in that culture.
                d.provenance.push(format!("{STYLE}{}", e.culture));
                format!("{}/demand/{}@{}", layout.key, e.role, e.culture)
            };
            if demands.iter().any(|x| x.id == d.id) {
                continue;
            }
            d.target_area = need.area;
            if e.function == "warehouse" {
                d.requires.clear();
            }
            if e.requires == "water" {
                d.requires.push("waterfront".into());
            }
            if e.function == "collective" && !roles::reserves_block(e) {
                d.target_frontage = 5.0;
            }
            d.role = e.role.clone();
            d.sites = need.sites;
            d.site = e.site.clone();
            d.landmark = e.landmark;
            d.district = e.district.clone();
            d.placement = if roles::reserves_block(e) {
                "block"
            } else {
                "parcel"
            }
            .into();
            demands.push(d);
        }
    }
    composition::gate_demands(layout, &mut demands);
    if let Some(rule) = isolated_rule {
        // A named site is an intention for one native structure, not a town
        // whose household demand is inferred from its visitor/population field.
        let farm = rule.function == "domestic";
        let minimum_area = cultures.first().map_or(0.0, |c| c.admissibility.min_area);
        let function = rule.function.as_str();
        let mut d = demand(
            &layout.key,
            function,
            if farm {
                1.0
            } else {
                (n * 0.8).max(minimum_area * 0.55)
            },
            farm,
            format!(
                "Explicit isolated site:{}; one structure; population:{population} is not a housing target",
                context.intent
            ),
        );
        d.target_area = if farm {
            minimum_area
        } else {
            d.requested / 0.55
        };
        d.role = rule.role.clone();
        d.landmark = rule.landmark;
        demands = vec![d];
    }
    // Size the land plan for the full population before decay vacates homes.
    for d in &mut demands {
        if d.requires.iter().any(|r| r == "navigableAccess") { d.site = "quay".into(); }
        if d.role.is_empty() {
            d.role = default_role(&d.function).into();
        }
        camps::explain(layout, population, d, context);
        if context.functions.is_some() && !isolated {
            d.provenance.push(format!("Explicit combined functions:{}", serde_json::to_string(&functions).expect("validated finite function weights")));
        }
    }
    (demands, functions, isolated)
}

pub(super) fn capacity(a: f64, d: &Demand) -> f64 {
    if d.unit == "domesticUnits" {
        // Village and legacy fallback: one household per plot. Allocation uses
        // the per-plot household capacity computed from floor area instead.
        1.0
    } else if matches!(d.function.as_str(), "market" | "common") {
        a
    } else {
        a * 0.55
    }
}
