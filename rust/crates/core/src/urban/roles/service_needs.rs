//! Service demand, counts, and layout-specific adjustments.

use super::*;

/// One building role to place: `sites` distinct buildings of `area` useful m² each.
#[derive(Clone, Debug)]
pub struct ServiceNeed {
    pub entry: ServiceEntry,
    pub sites: usize,
    pub area: f64,
}
/// Large, open or landmark programmes keep a whole block before cadastral cuts;
/// small trades take an ordinary plot after them.
pub fn reserves_block(e: &ServiceEntry) -> bool {
    e.landmark || e.area[1] >= 1500.0 || matches!(e.function.as_str(), "market" | "common")
}

/// Services for a settlement, with the cultural nucleus promoted to the central
/// landmark (`catalogue.json` cultures[c].nucleus.kind / area).
pub fn services(culture: &str, population: u32) -> Vec<ServiceNeed> {
    services_with_functions(culture, population, super::super::programme::ProgrammeFunctions::default())
}
/// Services at the catalogue's default singular density (1).
pub fn services_with_functions(culture: &str, population: u32, functions: super::super::programme::ProgrammeFunctions) -> Vec<ServiceNeed> {
    services_scaled(culture, population, functions, 1.0)
}
/// Count scale of one entry under the singular density (`LayoutConfig::
/// singular_density`, 0..3). Open land (markets, commons) and the nucleus
/// landmark keep the catalogue's count. At 0 the other entries survive only
/// when the town's explicit functions raise them (`required`), at their
/// catalogue count.
fn density_scale(e: &ServiceEntry, density: f64, nucleus: bool, required: bool) -> Option<f64> {
    if nucleus || matches!(e.function.as_str(), "market" | "common") {
        return Some(1.0);
    }
    let k = if density.is_finite() { density.clamp(0.0, 3.0) } else { 1.0 };
    if k > 0.0 {
        Some(k)
    } else if required {
        Some(1.0)
    } else {
        None
    }
}
/// Combinable effects are applied once per catalogue entry. Shared count
/// effects use their maximum; no Cartesian duplicate service demands.
/// A culture's own entries (`cultureServices`) replace the family entry of
/// the same role. `density` divides `per` and the population thresholds (by
/// its square root) and multiplies `max`; singular entries (per = 0) stay one.
pub fn services_scaled(
    culture: &str,
    population: u32,
    functions: super::super::programme::ProgrammeFunctions,
    density: f64,
) -> Vec<ServiceNeed> {
    use std::borrow::Cow;
    let pop = f64::from(population);
    let cat = catalogue();
    let mut entries: Vec<Cow<'static, ServiceEntry>> = cat
        .families
        .get(family(culture))
        .into_iter()
        .flatten()
        .chain(&cat.rural)
        .map(Cow::Borrowed)
        .collect();
    for e in cat.culture_services.get(culture).into_iter().flatten() {
        match entries.iter_mut().find(|x| x.role == e.role) {
            Some(x) => *x = Cow::Borrowed(e),
            None => entries.push(Cow::Borrowed(e)),
        }
    }
    entries.retain(|e| e.max_pop <= 0.0 || pop <= e.max_pop);
    let nucleus = &super::super::catalogue()["cultures"][culture]["nucleus"];
    let nucleus_role = nucleus["kind"].as_str().and_then(|k| cat.nucleus.get(k));
    if let Some(role) = nucleus_role {
        let area = nucleus["area"]
            .as_array()
            .and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]))
            .filter(|a| a[1] > 0.0);
        if let Some(e) = entries.iter_mut().find(|e| &e.role == role) {
            let e = e.to_mut();
            e.landmark = true;
            e.site = "nucleus".into();
            e.min_pop = e.min_pop.min(200.0);
            if let Some(a) = area
                && e.per_capita == 0.0
            {
                e.area = a;
            }
        } else if let Some(a) = area {
            let open = matches!(
                role.as_str(),
                "commerce.market" | "commerce.maidan" | "civic.forum"
            );
            entries.insert(
                0,
                Cow::Owned(ServiceEntry {
                    role: role.clone(),
                    function: if open { "market" } else { "collective" }.into(),
                    per: 0.0,
                    min_pop: 200.0,
                    max: 1,
                    site: "nucleus".into(),
                    area: a,
                    per_capita: 0.0,
                    landmark: true,
                    district: if open { "market" } else { "religious" }.into(),
                    requires: String::new(),
                    max_pop: 0.0,
                    town_pop: 0.0,
                    culture: String::new(),
                }),
            );
        }
    }
    entries
        .into_iter()
        .filter_map(|e| {
            let mut mult: f64 = 1.0;
            let mut min_pop = e.min_pop;
            if e.role.starts_with("commerce.") && e.function == "collective" { mult = 1.0 + functions.commerce; }
            if ["elite.", "civic.", "defence."].iter().any(|p| e.role.starts_with(p)) { min_pop *= 1.0 - 0.75 * functions.capital; }
            if e.role == "craft.mill" { mult = mult.max(1.0 + functions.riverine); }
            if e.role.starts_with("craft.") { mult = mult.max(1.0 + functions.artisan); }
            if e.role.starts_with("storage.") { mult = mult.max(1.0 + functions.agricultural); }
            let k = density_scale(&e, density, nucleus_role == Some(&e.role), mult > 1.0)?;
            min_pop /= k.sqrt();
            // Below its threshold, an entry with a `townPop` keeps a few
            // landmark buildings (1 to `EARLY_SITES`), rising with population.
            let town_pop = e.town_pop / k.sqrt();
            let early = pop < min_pop;
            if early && (e.town_pop <= 0.0 || pop < town_pop) {
                return None;
            }
            let mut e = e.into_owned();
            e.min_pop = if early { town_pop } else { min_pop };
            if early {
                let sites = (1.0 + ((pop / town_pop).ln() / 3f64.ln()).floor()).min(EARLY_SITES).min(e.max.max(1) as f64) as usize;
                let t = ((pop / town_pop).log10() / 2.0).clamp(0.0, 1.0);
                let area = e.area[0] + (e.area[1] - e.area[0]) * t;
                return Some(ServiceNeed { entry: e, sites: sites.max(1), area });
            }
            if e.function == "market" { e.per_capita *= 1.0 + 2.0 * functions.commerce; }
            let base = if e.per > 0.0 {
                (pop * k / e.per).floor().max(1.0)
            } else {
                1.0
            };
            let cap = (e.max.max(1) as f64 * k).round().max(1.0);
            // Buildings are indivisible: floor after applying intensity to
            // both count and cap. A tiny positive weight never doubles a site.
            let sites = ((base * mult).floor() as usize).clamp(1, (cap * mult).floor() as usize);
            let area = if e.per_capita > 0.0 {
                (pop * e.per_capita / sites as f64).clamp(e.area[0], e.area[1])
            } else {
                let t = ((pop / e.min_pop.max(1.0)).log10() / 2.0).clamp(0.0, 1.0);
                e.area[0] + (e.area[1] - e.area[0]) * t
            };
            Some(ServiceNeed {
                entry: e,
                sites,
                area,
            })
        })
        .collect()
}

/// Most buildings of one role a town may request (`ProgrammeContext::counts`).
pub const MAX_ROLE_COUNT: u32 = 64;

/// Catalogue row of a role for a culture: the culture's own entry, its
/// family's, the rural and harbour rows, then any other family's.
fn catalogue_entry(culture: &str, role: &str) -> Option<&'static ServiceEntry> {
    let cat = catalogue();
    let find = |list: &'static [ServiceEntry]| list.iter().find(|e| e.role == role);
    cat.culture_services.get(culture).and_then(|l| find(l.as_slice()))
        .or_else(|| cat.families.get(family(culture)).and_then(|l| find(l.as_slice())))
        .or_else(|| find(cat.rural.as_slice()))
        .or_else(|| find(cat.harbour.as_slice()))
        .or_else(|| cat.families.values().chain(cat.culture_services.values()).find_map(|l| find(l.as_slice())))
}
/// Whether a role has a catalogue row a count can build.
pub fn countable_role(role: &str) -> bool {
    catalogue_entry("", role).is_some()
}
/// Sites per role of a list of needs (the automatic draw before requests).
pub fn site_counts(needs: &[ServiceNeed]) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    for need in needs {
        *out.entry(need.entry.role.clone()).or_insert(0) += need.sites as u32;
    }
    out
}
/// Applies requested building counts (`ProgrammeContext::counts`) to a
/// place's needs: an exact number of sites, bypassing population thresholds,
/// caps, density and functions. 0 removes the role (the nucleus landmark
/// included). A role the place does not draw takes its catalogue row from any
/// family, built in the place's own culture. In a hybrid place the count
/// replaces every community's entry and all sites go to the place's culture.
/// Returns the requested roles without a catalogue row.
pub fn resolve_counts(needs: &mut Vec<ServiceNeed>, counts: &BTreeMap<String, u32>, culture: &str, population: u32) -> Vec<String> {
    let mut unknown = vec![];
    for (role, &n) in counts {
        let n = n.min(MAX_ROLE_COUNT) as usize;
        let mut found = false;
        needs.retain_mut(|need| {
            if need.entry.role != *role {
                return true;
            }
            let keep = n > 0 && !found;
            found = true;
            if keep {
                need.sites = n;
                need.entry.culture.clear();
            }
            keep
        });
        if found || n == 0 {
            continue;
        }
        let Some(entry) = catalogue_entry(culture, role) else {
            unknown.push(role.clone());
            continue;
        };
        let mut entry = entry.clone();
        entry.culture.clear();
        let pop = f64::from(population);
        let area = if entry.per_capita > 0.0 {
            (pop * entry.per_capita / n as f64).clamp(entry.area[0], entry.area[1])
        } else {
            let t = ((pop / entry.min_pop.max(1.0)).log10() / 2.0).clamp(0.0, 1.0);
            entry.area[0] + (entry.area[1] - entry.area[0]) * t
        };
        needs.push(ServiceNeed { entry, sites: n, area });
    }
    unknown
}

/// Quay services exist in every culture, but only a built port requests them.
/// The layout's singular density scales the family and harbour counts.
pub fn services_for_layout(layout: &Layout, population: u32, functions: super::super::programme::ProgrammeFunctions) -> Vec<ServiceNeed> {
    let density = layout.config.as_ref().map_or(1.0, |c| c.singular_density);
    let mut needs = match super::super::forms::sheet::monuments(layout) {
        // A hybrid place (`monuments` facet): each community brings the singular
        // and utility buildings a place of its size and culture has.
        Some(shares) => shares
            .into_iter()
            .flat_map(|(culture, share)| {
                let foreign = culture != layout.culture;
                let mut needs = services_scaled(culture, (population as f64 * share).round() as u32, functions, density);
                if foreign {
                    for need in &mut needs {
                        need.entry.culture = culture.to_owned();
                    }
                }
                needs
            })
            .collect(),
        None => services_scaled(&layout.culture, population, functions, density),
    };
    if layout.config.as_ref().is_some_and(|c| c.power_high_ground) {
        high_ground_services(&mut needs);
    }
    if !layout.streets.iter().any(|s| s.role == "quay") { return needs; }
    let mut entries: Vec<ServiceEntry> = needs.iter().map(|n| n.entry.clone()).collect();
    for e in &catalogue().harbour {
        if entries.iter().any(|n| n.role == e.role || e.function == "warehouse" && n.site == "quay" && n.function == e.function) { continue; }
        entries.push(e.clone());
    }
    for e in entries.into_iter().skip(needs.len()) {
        let Some(k) = density_scale(&e, density, false, functions.port > 0.0) else { continue };
        if population < (e.min_pop / k.sqrt()) as u32 { continue; }
        let sites = if e.per > 0.0 { (population as f64 * k / e.per).floor().max(1.0) as usize } else { 1 };
        let cap = ((e.max as f64 * k).round() as usize).max(1);
        let area = e.area[0] + (e.area[1] - e.area[0]) * ((population as f64 / e.min_pop).log10() / 2.0).clamp(0.0, 1.0);
        needs.push(ServiceNeed { sites: sites.min(cap), area, entry: e });
    }
    for need in &mut needs {
        if need.entry.role == "craft.boatshed" { need.entry.site = "quay".into(); need.entry.district = "port".into(); need.entry.landmark = population >= 3000; }
        // A port's customs house and ropewalk stand on its quays, not at a land gate.
        if matches!(need.entry.role.as_str(), "civic.customs" | "craft.ropewalk") { need.entry.site = "quay".into(); need.entry.district = "port".into(); }
    }
    needs
}

fn high_ground_services(needs: &mut [ServiceNeed]) {
    for need in needs {
        let e = &mut need.entry;
        if e.landmark && (e.role.starts_with("worship.") && (e.site == "nucleus" || e.per == 0.0 && e.site != "edge")
            || e.role.starts_with("defence.") && e.site == "hill"
            || e.role.starts_with("elite.") && matches!(e.site.as_str(), "hill" | "nucleus")) {
            e.site = "summit".into();
        }
    }
}
