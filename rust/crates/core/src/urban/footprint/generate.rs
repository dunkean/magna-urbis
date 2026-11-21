//! Size and place a town footprint, then assemble its phases and diagnostics.
use super::archetypes::{
    self, compatible_foundation, family, fit_rectangle, geometric_foundation, mechanism, planned,
};
use super::epochs::{budget, epoch_densities, epoch_fractions};
use super::geometry::{area, dry, union};
use super::growth::{Growth, Service, accessible};
use super::ribbon::{internal_ribbon_guides, ribbon};
use super::site::{buildable_grade, cave_floor_share, centers, geography, orientation, summit_access};
use super::survey::capacity_epochs_surveyed;
use super::{Footprint, capacity, crossings, sparse, terrain};
use crate::rng::Rng;
use crate::urban::{
    LayoutConfig, Morph, Site, Street, Surface, UrbanCenter, UrbanEvent, UrbanMetrics, UrbanStructure,
    composition, geometry as g, kinds, macroplan, neighbours, profiles, routing, warnings,
};
use std::f64::consts::PI;

pub(in crate::urban) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    morph: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
) -> Footprint {
    let rng = Rng::new(seed).fork("urban-footprint-v1");
    let neighbour_land = neighbours::Mask::of(site);
    let (nominal, density) = budget(site, cfg, morph, radius);
    // Adaptive capacity: the footprint is sized for the households its own
    // tissue can hold (densified first, then extended within a bound).
    let (mut plan_epochs, survey) = capacity_epochs_surveyed(site, cfg, morph, nominal, surface);
    // The house slope gate the accessible growth measures its land with.
    let gate = survey.map(|s| s.gate);
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let mut plan = capacity::plan(site, cfg, &plan_epochs, nominal, None);
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  capacity.plan: {:.0} ms",
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
    let target = nominal * plan.as_ref().map_or(1.0, |p| p.extension);
    // A camp grown past one figure (`campGrowth`) takes the land its rows
    // or its daughter camps need; the default figure keeps the sized land.
    let target = kinds::camp_growth_land(site, cfg, morph).map_or(target, |land| target.max(land));
    let density = density * nominal / target;
    let radius = (target / PI).sqrt();
    let geography = geography(site, cfg, surface, radius);
    let family = family(site, cfg, geography, radius);
    // A planned walled culture on uneven land keeps its rectangle wherever a
    // rectangle, slid, turned or lengthened, still finds four fifths of
    // buildable land;
    // only then does the town fall back to an organic outline.
    let family = if family != "rectangle" && cfg.footprint.family == "auto" && geometric_foundation(site, cfg) {
        let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
        let p = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
        let aspect = if p.enclosure == "square" { 1.0 } else { cfg.footprint.aspect };
        let fitted = p.enclosure != "circle" && fit_rectangle(site.center, target, aspect, orientation(site, cfg, surface, roads),
            p.orientation == "cardinal", buildable_grade(site, cfg), radius, surface).2 >= 0.8;
        if fitted { "rectangle" } else { family }
    } else {
        family
    };
    let mechanism = mechanism(cfg, family);
    let angle = if cfg.footprint.family == "auto" && family == "elongated" {
        geography.contour_angle + cfg.footprint.orientation.to_radians()
    } else {
        orientation(site, cfg, surface, roads)
    };
    let mut centers = centers(site, cfg, family, mechanism, radius, angle, surface, &rng);
    let fixed = cfg.fixed_sites.contains(&site.key);
    let summit_access = (!fixed).then(|| summit_access(site, cfg, surface, roads, radius)).flatten().and_then(|(summit, access)| {
        if let Some(c) = centers.first_mut() { c.point = summit; }
        access
    });
    let mut fitted_aspect = None;
    let angle = if !fixed && mechanism == "planned" && family == "rectangle" && centers.len() == 1 && summit_access.is_none() {
        let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
        let p = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
        let aspect = if cfg.footprint.family == "auto" && p.enclosure == "square" { 1.0 } else { cfg.footprint.aspect };
        let (c, a, _, k) = fit_rectangle(centers[0].point, target, aspect, angle, p.orientation == "cardinal",
            buildable_grade(site, cfg), radius, surface);
        centers[0].point = c;
        fitted_aspect = Some(k);
        a
    } else {
        angle
    };
    // A town above a coastal escarpment keeps its civic nucleus. Seed its
    // lower port as well, only across a real dry route within configured grades.
    // Culture data `plan.secondCore` (default 1): the chance that this lower port
    // becomes a second nucleus of its own (rare for a planned Chinese city).
    let culture = if cfg.culture == "site" { site.culture.as_str() } else { cfg.culture.as_str() };
    let second_core = composition::culture_data(culture, site.population)["plan"]["secondCore"].as_f64()
        .is_none_or(|p| Rng::new(&format!("second-core:{}", site.key)).float() < p);
    let port_access = if second_core && site.population >= 3000 && macroplan::harbour::port_town(cfg) {
        macroplan::harbour::sited(site,cfg,surface).and_then(|port| {
            let (a,b)=(site.center,port.center);
            let margin=radius.max(150.0);
            let mut planner=routing::RoutePlanner::new(surface,(a.x.min(b.x)-margin,a.y.min(b.y)-margin,a.x.max(b.x)+margin,a.y.max(b.y)+margin));
            let route=planner.route(a,b,cfg.max_street_grade).map(|p|(p,"street",5.0))
                .or_else(||planner.route(a,b,cfg.max_lane_grade).map(|p|(p,"lane",3.0)))?;
            centers.push(UrbanCenter {id:centers.len(),point:b,weight:0.65});
            Some(Street {widths:vec![route.2;route.0.len()],path:route.0,rank:1,role:route.1.into()})
        })
    } else {None};
    // A port grows along its harbour shore.
    let water_affinity = morph.value["growth"]["water"].as_f64().unwrap_or(0.3);
    let water_affinity = if macroplan::harbour::port_town(cfg) {
        water_affinity.max(1.0)
    } else {
        water_affinity
    };
    let epochs = cfg.footprint.epochs;
    let fractions = epoch_fractions(&epoch_densities(site, cfg, morph));
    let ribbon_foundation = mechanism == "ribbon" && compatible_foundation(geography, radius);
    let natural = mechanism != "planned" && !ribbon_foundation;
    if natural && cfg.suburbs != "none" {
        sparse::satellites(
            &mut centers,
            cfg,
            surface,
            roads,
            radius,
            buildable_grade(site, cfg),
            &rng,
        );
    }
    let guide_family = if natural
        && cfg.footprint.branch_depth > 0.0
        && !matches!(family, "fingers" | "dendritic" | "linear")
    {
        "dendritic"
    } else {
        family
    };
    let guide_radius = radius
        * (1.0
            + if natural {
                cfg.footprint.branch_depth * 0.8
            } else {
                0.0
            });
    let mut guides = centers
        .first()
        .map(|c| archetypes::guides(guide_family, c.point, guide_radius, angle, &rng))
        .unwrap_or_default();
    let port_roads:Vec<_>=port_access.iter().chain(summit_access.iter()).cloned().collect();
    let growth_roads = [roads, guides.as_slice(),port_roads.as_slice()].concat();
    let mut warnings = vec![];
    if centers.is_empty() {
        warnings.push(warnings::dry_core_missing());
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let mut foundation_cfg = cfg.clone();
    if cfg.footprint.family == "auto"
        && profiles::settlement_profile(culture, site.population, cfg.footprint.epochs).enclosure
            == "square"
    {
        foundation_cfg.footprint.aspect = 1.0;
    }
    if let Some(k) = fitted_aspect { foundation_cfg.footprint.aspect = k; }
    let mut ribbon_axes = vec![];
    // Land target after the terrain correction, and the land first measured.
    let mut land_target = target;
    let mut land = None;
    let (reserve, mut phases, mut crossings, housed, _) = if centers.is_empty() {
        (vec![], vec![vec![]; epochs], vec![], false, None)
    } else if mechanism == "planned" {
        // `alignEnclosedGrid`: a secondary core of a cardinal culture takes the
        // cardinal frame its own walls are drawn in, not the first core's turn.
        let cardinal = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs).orientation == "cardinal";
        let secondary = (cfg.align_enclosed_grid && cardinal).then_some(0.0);
        let (r, p) = planned(
            target,
            family,
            &foundation_cfg,
            &centers,
            angle,
            secondary,
            &fractions,
            surface,
            &rng,
        );
        (r, p, vec![], false, None)
    } else if ribbon_foundation {
        let (r, p, axes) = ribbon(
            target,
            &foundation_cfg,
            &centers,
            radius,
            angle,
            &fractions,
            surface,
            roads,
            water_affinity,
        );
        ribbon_axes = axes;
        (r, p, vec![], false, None)
    } else {
        let profile = profiles::settlement_profile(culture, site.population, epochs);
        let walled = matches!(
            profiles::fortification(profile, &cfg.fortification, site.population),
            "wall" | "palisade" | "hedge"
        );
        let block = morph.range("blockSize", "edge")[0];
        let service = Service {
            grade: if profiles::stairs_allowed(cfg, culture) {
                cfg.max_stair_grade
            } else {
                cfg.max_street_grade
            },
            min_gap: if block > 0.0 { block } else { 2500.0 },
            suburb_band: if !crate::settlements::demographics::below(site.population, "town")
                && cfg.suburbs != "none"
                && (epochs >= 3 || walled && epochs >= 2)
            {
                (morph.range("plotDepth", "edge")[1] * 1.5).clamp(30.0, 90.0)
            } else {
                0.0
            },
            crossing: {
                let (max_span, ford) = crossings::spans(culture, site.population);
                crossings::Rules {
                    max_span,
                    ford,
                    width: morph.width(1, &mut rng.fork("urban-crossing-width")),
                    grade: cfg.max_street_grade,
                }
            },
        };
        let slope_growth = cfg.tissue == "terraces" && cfg.programme.slope_relax > 0.0;
        let grade = if slope_growth { 0.75 } else if cfg.tissue == "terraces" { 0.5 } else { buildable_grade(site, cfg) };
        let service = if slope_growth {
            Service { grade: service.grade.max(grade), ..service }
        } else { service };
        let grow = |centers: &mut Vec<UrbanCenter>, grade: f64, service: Service, capacity_seed: bool, target: f64, flood: Option<terrain::Flood>| {
            accessible(site.population, target, family, cfg, centers, radius, angle, &fractions, surface, &growth_roads, &rng, grade, water_affinity, service, capacity_seed, gate, flood, neighbour_land.as_ref(), fixed)
        };
        let before = centers.clone();
        // Component seeding belongs to slope-adapted growth only: an ordinary
        // (flat, island or spit) town keeps its exact nearest-dry seed.
        let first = grow(&mut centers, grade, service, slope_growth, target, None);
        let mut taken = (grade, service);
        // A site whose streets cannot climb out of the core would leave the place almost
        // without land (under a quarter of its budget): it then grows by stairs and
        // terraces, on steeper ground step by step, and says so. The ladder runs up to
        // a 56° flank (grade 1.5), so a town placed on a volcano's cone still takes land.
        let got = |r: &Growth| area(&union(&r.1.iter().flatten().cloned().collect::<Vec<_>>()));
        let first_area = got(&first);
        let mut best = first;
        // The emergency land ladder stays the last resort of every place; the
        // household ladder (`slopes`) runs after it, on the finished layout.
        // A growth that already holds its housable goal needs no steeper land.
        for steep_grade in [grade.max(0.5), 0.75, 1.0, 1.5] {
            if got(&best) >= (if slope_growth { 0.95 } else { 0.25 }) * target {
                break;
            }
            let mut again = before.clone();
            let steep = Service { grade: service.grade.max(cfg.max_stair_grade).max(steep_grade), ..service };
            let second = grow(&mut again, steep_grade, steep, slope_growth, target, None);
            if got(&second) > (if slope_growth { 1.01 } else { 2.0 }) * got(&best) {
                centers = again;
                best = second;
                taken = (steep_grade, steep);
            }
        }
        land = best.4;
        let laddered = got(&best);
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!("  terrain.land: {land:?}");
        }
        // Terrain correction, on a site whose strict house gate refuses the
        // land the growth took (all ordinary ground skips it): the capacity
        // forecast counts only the share of that land the town's gate admits,
        // and the growth is drawn again by housable land, flat land first,
        // until it holds the forecast households.
        if let Some(measured) = land.filter(terrain::Survey::refused)
            && plan.is_some()
        {
            for e in &mut plan_epochs {
                e.steep = 1.0 - measured.level;
            }
            if let Some(corrected) = capacity::plan(site, cfg, &plan_epochs, nominal, None) {
                land_target = nominal * corrected.extension;
                plan = Some(corrected);
            }
            let flood = terrain::Flood { gate: measured.gate, goal: land_target * measured.level };
            let mut again = before.clone();
            let (grade, service) = taken;
            let second = grow(&mut again, grade, service, slope_growth, land_target, Some(flood));
            if got(&second) > 0.0 {
                centers = again;
                best = second;
            }
        }
        if laddered > first_area {
            warnings.push(warnings::town_terraces());
        }
        best
    };
    let mut links = if natural && sparse::enabled(cfg) {
        let served = [roads, crossings.as_slice()].concat();
        sparse::serve(&mut phases, &centers, cfg, surface, radius, target, &served)
    } else {
        vec![]
    };
    if let Some(access)=port_access {links.push(access);}
    if let Some(access)=summit_access {links.push(access);}
    // The neighbours' land and its margin stay out of every phase (`neighbours`).
    if let Some(mask) = &neighbour_land {
        for phase in &mut phases {
            *phase = phase.iter().flat_map(|s| mask.cut_free(s)).collect();
        }
    }
    let allocated = union(&phases.iter().flatten().cloned().collect::<Vec<_>>());
    // An urban crossing survives only between two retained banks: its
    // approaches start and end on allocated land.
    for chain in crossings.chunk_by(|a, b| a.path.last() == b.path.first()) {
        let (Some(a), Some(b)) = (chain.first(), chain.last()) else {
            continue;
        };
        if [a.path[0], *b.path.last().unwrap()]
            .iter()
            .all(|&p| allocated.iter().any(|s| g::contains(s, p)))
        {
            links.extend(chain.iter().cloned());
        }
    }
    crossings.clear();
    let allocated_area = area(&allocated);
    centers.retain(|c| allocated.iter().any(|s| g::contains(s, c.point)));
    for (i, c) in centers.iter_mut().enumerate() {
        c.id = i;
    }
    if centers.is_empty() {
        phases.clear();
        guides.clear();
        if allocated.is_empty() && warnings.is_empty() {
            warnings.push(warnings::buildable_core_missing());
        }
    } else if mechanism != "planned" {
        guides = archetypes::guides(guide_family, centers[0].point, guide_radius, angle, &rng);
    }
    if !ribbon_axes.is_empty() {
        let internal = if phases.iter().any(|p| !p.is_empty()) {
            internal_ribbon_guides(&ribbon_axes, &allocated, surface, cfg)
        } else {
            vec![]
        };
        warnings.push(if internal.is_empty() {
            warnings::ribbon_without_access()
        } else {
            warnings::ribbon_without_regional_road()
        });
        guides.extend(internal);
    }
    // A planned outline cut by a river can intentionally allocate several dry
    // masses. Give each mass an explicit service center rather than inventing a
    // crossing or discarding all but the mass containing the original marker.
    for domain in &allocated {
        if !centers.iter().any(|c| g::contains(domain, c.point)) {
            centers.push(UrbanCenter {
                id: centers.len(),
                point: g::interior_point(domain),
                weight: g::area(domain) / allocated_area.max(1.0),
            });
        }
    }
    let center_weight: f64 = centers.iter().map(|c| c.weight).sum();
    for c in &mut centers {
        c.weight /= center_weight.max(1.0e-9);
    }
    // A growth that gathered its housable goal holds the forecast households
    // on less, flatter land than the area target: no shortfall.
    let target = land_target;
    let shortfall = if housed { 0.0 } else { (target - allocated_area).max(0.0) };
    // Underdark: a cave town that found too little floor packs (`capacity::cave_pack`).
    let cave_pack = (shortfall > target * 0.02 && cave_floor_share(surface, site.center, radius * 2.65).is_some())
        .then(|| (allocated_area / target.max(1.0)).clamp(crate::settlements::CAVE_LAND_PER_HOME, 1.0));
    // Terrain-bounded growth: plan again on the land actually attributed.
    if let Some(p) = plan.as_mut()
        && shortfall > target * 0.02
        && let Some(mut again) =
            capacity::plan(site, cfg, &plan_epochs, nominal, Some(allocated_area))
    {
        again.extension = p.extension;
        *p = again;
    }
    if shortfall > target * 0.02 {
        warnings.push(warnings::land_shortfall(allocated_area, target, shortfall / target * 100.0));
    }
    if let (Some(k), Some(p)) = (cave_pack, plan.as_mut()) {
        p.cave_pack = k;
    }
    let mut history = vec![];
    let mut cumulative = vec![];
    for (epoch, shapes) in phases.iter().enumerate() {
        let prior_components = cumulative.len();
        cumulative = union(&[cumulative, shapes.clone()].concat());
        let kind = if epoch == 0 {
            "foundation"
        } else if mechanism == "planned" {
            "planned-extension"
        } else if mechanism == "fusion" && cumulative.len() < prior_components {
            "nucleus-merger"
        } else if mechanism == "fusion" {
            "nucleus-growth"
        } else if mechanism == "ribbon" {
            "road-accretion"
        } else {
            "accessible-extension"
        };
        history.push(UrbanEvent {
            epoch,
            kind: kind.into(),
            center: if family == "composite" && epoch > 0 {
                centers.len().saturating_sub(1)
            } else {
                0
            },
            area: area(shapes),
        });
    }
    let reserve_area = area(&dry(surface, &reserve));
    let components = allocated.len();
    let structure = UrbanStructure {
        quarter_baseline: None,
        shanty: None,
        spring_sites: vec![],
        gate_village_centers: vec![],
        gate_village_lanes: vec![],
        quays: vec![],
        waterways: vec![],
        port_districts: vec![],
        version: 1,
        mechanism: mechanism.into(),
        family: family.into(),
        reserve,
        allocated,
        centers,
        districts: vec![],
        history,
        metrics: UrbanMetrics {
            target_area: target,
            allocated_area,
            street_area: 0.0,
            reserved_area: (reserve_area - allocated_area).max(0.0),
            gross_density: density,
            planned_population: site.population as f64,
            shortfall_area: shortfall,
            components,
            access_added: 0,
            capacity: plan,
        },
    };
    if cfg.footprint.budget == "population" && cfg.footprint.gross_density <= 0.0 {
        let densities = epoch_densities(site, cfg, morph)
            .iter()
            .map(|d| format!("{d:.0}"))
            .collect::<Vec<_>>()
            .join(" / ");
        warnings.push(warnings::automatic_land_budget(density, &densities));
    }
    Footprint {
        structure,
        phases,
        radius,
        warnings,
        guides,
        links,
        land,
    }
}
