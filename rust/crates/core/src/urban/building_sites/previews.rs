//! Lightweight occupation previews for building sites.

use super::*;

/// Parcel IDs, in site order, of the sites whose request (`request_one`)
/// carries a non-empty `preview`, without building the request: the same
/// culture, floors, feasibility and occupation choices up to the preview
/// pieces, but no terrain patch, accesses, deficit, candidates or massing.
/// `scale_home` keeps the pieces (and their holes), so it cannot empty a
/// preview. `Err` when generating any of the requests would fail. Used by
/// `trim::finish` (frontage of the occupied lots); keep it in step with
/// `request_one`.
#[cfg_attr(not(test), allow(dead_code))]
pub(in crate::urban) fn previewed_parcels(
    index: &BuildingSiteIndex,
    seed: &str,
    layouts: &[Layout],
    partitions: &[Partition],
    architecture_culture: Option<&str>,
) -> Result<Vec<String>, String> {
    // Test toggles are thread-local: read them on the calling thread.
    let topology = preview_topology_enabled();
    super::super::par::range(index.sites.len(), |i| {
        preview_site(index, seed, layouts, partitions, architecture_culture, topology, i, false)
    })
    .into_iter()
    .filter_map(Result::transpose)
    .collect()
}

/// `previewed_parcels` asked lot by lot, each site previewed at most once.
/// Construction runs the failing part of every site (mappings, retained
/// references), so it fails exactly when `previewed_parcels` would.
/// `trim::finish` now previews every site up front (`previewed_parcels`);
/// the lazy form stays as the reference its test compares against.
#[cfg_attr(not(test), allow(dead_code))]
pub(in crate::urban) struct SitePreviews<'a> {
    index: &'a BuildingSiteIndex,
    seed: &'a str,
    layouts: &'a [Layout],
    partitions: &'a [Partition],
    topology: bool,
    by_parcel: HashMap<&'a str, Vec<usize>>,
    memo: std::cell::RefCell<HashMap<usize, bool>>,
}
#[cfg_attr(not(test), allow(dead_code))]
impl<'a> SitePreviews<'a> {
    pub(in crate::urban) fn new(index: &'a BuildingSiteIndex, seed: &'a str, layouts: &'a [Layout], partitions: &'a [Partition]) -> Result<Self, String> {
        let topology = preview_topology_enabled();
        let mut by_parcel: HashMap<&'a str, Vec<usize>> = HashMap::new();
        for (i, site) in index.sites.iter().enumerate() {
            preview_site(index, seed, layouts, partitions, None, topology, i, true)?;
            let partition = &partitions[index.partitions[site.partition].partition];
            by_parcel.entry(partition.parcels[site.parcel].id.as_str()).or_default().push(i);
        }
        Ok(Self { index, seed, layouts, partitions, topology, by_parcel, memo: Default::default() })
    }
    /// Whether some site on a lot with this id shows a silhouette.
    pub(in crate::urban) fn previewed(&self, id: &str) -> bool {
        self.by_parcel.get(id).is_some_and(|sites| sites.iter().any(|&i| {
            if let Some(&hit) = self.memo.borrow().get(&i) {
                return hit;
            }
            let shown = preview_site(self.index, self.seed, self.layouts, self.partitions, None, self.topology, i, false)
                .ok().flatten().is_some();
            self.memo.borrow_mut().insert(i, shown);
            shown
        }))
    }
}

/// One site of `previewed_parcels`: its parcel id when its building request
/// would show a silhouette. With `check_only`, stops after the steps that can
/// fail (none follows them) and answers `None`.
#[allow(clippy::too_many_arguments)]
fn preview_site(
    index: &BuildingSiteIndex,
    seed: &str,
    layouts: &[Layout],
    partitions: &[Partition],
    architecture_culture: Option<&str>,
    topology: bool,
    i: usize,
    check_only: bool,
) -> Result<Option<String>, String> {
    let (sites, partition_indices, layout_indices) = (&index.sites, &index.partitions, &index.layouts);
    {
        let site = &sites[i];
        let partition_index = &partition_indices[site.partition];
        let layout_index = &layout_indices[partition_index.layout];
        let layout = layouts.get(layout_index.layout).ok_or("Retained layout missing")?;
        let partition = partitions.get(partition_index.partition).ok_or("Retained partition missing")?;
        let pr = partition.programme.as_ref().ok_or("Retained programme missing")?;
        let allocation = pr.allocations.get(site.allocation).ok_or("Retained allocation missing")?;
        let parcel = partition.parcels.get(site.parcel).ok_or("Retained parcel missing")?;
        if parcel.family == "shanty" {
            return Ok((!check_only).then(|| parcel.id.clone()));
        }
        if super::super::springs::site(layout, &parcel.id).is_some() {
            return Ok((!check_only).then(|| parcel.id.clone()));
        }
        let picked = drawn_culture(architecture_culture, seed, layout, partition, parcel, &allocation.role, &allocation.function)
            .filter(|p| p.0 != allocation.culture);
        let from_sheet = picked.as_ref().is_some_and(|p| p.1);
        let drawn = picked.and_then(|(d, _)| super::super::culture::parcel_mapping(layout, parcel, &d, &allocation.function).map(|m| (d, m)));
        let from_sheet = from_sheet && drawn.is_some();
        let (building_culture, mut culture) = match drawn {
            Some(d) => d,
            None => (
                allocation.culture.clone(),
                super::super::culture::functional_mapping(&allocation.culture,&allocation.role,&allocation.function,
                    &pr.context.period,super::super::culture::houses_mode(&pr.context.mode))
                .or_else(|| super::super::culture::parcel_mapping(layout, parcel, &allocation.culture, &allocation.function))
                .ok_or("No contextual native recipe")?,
            ),
        };
        if check_only {
            return Ok(None);
        }
        // Funerary land replaces any preview (`funerary::apply`, last step of `request_one`).
        let programme = programme_of(allocation, parcel, layout, &layout_index.districts);
        let site_seed = super::super::edits::building_seed(seed, &parcel.id, partition);
        if let Some(shown) = funerary::shown(programme["role"].as_str().unwrap_or(""), &site_seed, &parcel.shape, parcel.axis) {
            return Ok(shown.then(|| parcel.id.clone()));
        }
        let building_culture = building_culture.as_str();
        if !super::super::culture::functional_role_resolved(building_culture,&culture.architecture_pack,&allocation.role,&allocation.function)
            && let Some(small) = super::super::parcels::compact_fallback(&culture.architecture_pack, &pr.context.period, &culture.admissibility) {
            let fits = |a: &super::super::culture::UrbanAdmissibility| {
                parcel.envelope.as_ref().is_some_and(|e| super::super::parcels::witnessed_by(e, a))
            };
            if !fits(&culture.admissibility)
                && (fits(&small)
                    || super::super::parcels::parcel_envelope(parcel, culture.admissibility.min_frontage,
                        culture.admissibility.min_depth, culture.admissibility.min_access_width).is_none())
            {
                culture.admissibility = small;
            }
        }
        // Without a tissue there is no occupancy, hence no preview.
        let sheet_tissue;
        let tissue = if from_sheet {
            // A culture drawn in the style sheet builds in its own tissue.
            sheet_tissue = super::super::culture::lot_morph(layout, partition, building_culture, parcel)
                .map(|(zone, morph)| (zone.to_owned(), super::super::forms::flagged(morph, layout)));
            &sheet_tissue
        } else if super::super::zone_blend::lot_zone(layout, parcel).is_some() {
            // A lot dithered to the neighbouring zone (`zoneDensity: gradient`).
            sheet_tissue = super::super::culture::lot_morph(layout, partition, &allocation.culture, parcel)
                .map(|(zone, morph)| (zone.to_owned(), super::super::forms::flagged(morph, layout)));
            &sheet_tissue
        } else {
            partition_index.tissues[site.tissue].get_or_init(|| {
                super::super::culture::parcel_morph(layout, partition, &allocation.culture, parcel.block)
                    .map(|(zone, morph)| (zone.to_owned(), super::super::forms::flagged(morph, layout)))
            })
        };
        let Some((zone, morph)) = tissue.as_ref() else { return Ok(None) };
        let mode = super::super::culture::houses_mode(&pr.context.mode);
        let floors = typical_floors(&culture, &allocation.function, pr.population, parcel.pressure);
        let floors = if zone == "village"
            || culture.functional_profile == "communal"
            || !matches!(allocation.function.as_str(), "domestic" | "mixed")
        {
            floors
        } else {
            let levels = &morph.value["arch"]["storeys"];
            let lo = levels[0].as_u64().unwrap_or(u64::from(floors)) as u32;
            let hi = levels[1].as_u64().unwrap_or(u64::from(floors)) as u32;
            super::super::zone_blend::floors_at(&morph.value["arch"], lo, hi, parcel.pressure)
                .unwrap_or_else(|| lo + ((hi.saturating_sub(lo)) as f64 * parcel.pressure).round() as u32)
                .clamp(culture.admissibility.floors[0], culture.admissibility.floors[1])
        };
        let wealth = programme["wealth"].as_f64().unwrap_or(0.5);
        let role = programme["role"].as_str().unwrap_or("").to_string();
        let functional = super::super::culture::functional_programme(&culture.architecture_pack, &role,
            &allocation.function, &pr.context.period, mode);
        let domestic = matches!(allocation.function.as_str(), "domestic" | "mixed");
        let collective_home = functional.is_none()
            && domestic
            && (role == "dwelling.tenement" || role.starts_with("dwelling.tenement."));
        let feasible = functional.is_none() && domestic && feasibility_enabled();
        let admissible = if collective_home || feasible {
            feasibility::admissible(&culture.architecture_pack, building_culture, &pr.context.period, mode == "historical_strict")
        } else {
            Vec::new()
        };
        let fit = (collective_home || feasible).then(|| feasibility::lot_fit(parcel, &admissible));
        let fits: &[&NativeProfile] = fit.as_ref().map_or(&[], |f| &f.fits);
        let tall = if collective_home {
            let tall: Vec<_> = fits.iter().copied().filter(|p| tall_collective(p)).collect();
            collective_floors(&tall, parcel.pressure)
        } else {
            None
        };
        let floors_range = if let Some(range) = tall {
            Some(range)
        } else if collective_home {
            let top = morph.value["arch"]["storeys"][1].as_u64().map_or(floors, |hi| hi as u32)
                .clamp(culture.admissibility.floors[0], culture.admissibility.floors[1]);
            Some([top, top])
        } else if domestic || functional.is_some() {
            Some([floors.saturating_sub(1).max(culture.admissibility.floors[0]).min(floors), floors])
        } else {
            None
        };
        let wish = floors_range.or_else(|| wish_of(&programme["floors"]));
        let drawable: Vec<_> = if feasible {
            feasibility::drawable(&culture.architecture_pack, building_culture, &pr.context.period, mode == "historical_strict").collect()
        } else {
            Vec::new()
        };
        let asked = |wished: &'static str| {
            let c = feasibility::feasible_composition(wished, wish, &drawable, fits, culture.admissibility.party_walls)
                .unwrap_or(wished);
            if round7() {
                feasibility::programme_composition(c, wish,
                    feasibility::programme_source_role(&role, &allocation.function), fits)
            } else {
                c
            }
        };
        let court_kept = feasible.then(|| asked("courtyard") == "courtyard");
        let court_lot = collective_home && fits.iter().any(|p| court_layout(p)) && court_kept != Some(false);
        let occupancy = super::super::parcels::Occupancy {
            morph,
            zone: zone.as_str(),
            function: &allocation.function,
            role: &role,
            landmark: programme["landmark"].as_bool().unwrap_or(false),
            party_walls: culture.admissibility.party_walls,
            wealth,
            seed: &site_seed,
            pack: &culture.architecture_pack,
            court_lot,
            court_kept,
        };
        // `activity` intent: the whole yard stands in the lot (request_one builds it).
        if pr.context.intent == "activity" && role == "craft.activity" {
            return Ok(Some(parcel.id.clone()));
        }
        let (parts, realized) = super::super::parcels::occupation_preview(parcel, &occupancy);
        if parts.is_empty() {
            return Ok(None);
        }
        // Only a holed preview of a simple composition is rebuilt.
        if !(topology && parts.iter().any(|(s, _)| !s.holes.is_empty())) {
            return Ok(Some(parcel.id.clone()));
        }
        let kind = realized.or_else(|| Some(super::super::parcels::occupation_kind(&occupancy)));
        let compound_tissue = morph.text("plotOp") == "compound";
        let composition = functional.map_or_else(
            || match composition_of(&role, kind) {
                "row" | "detached" if compound_tissue => "compound",
                c => c,
            },
            |p| p.composition.as_str(),
        );
        let mut composition = if feasible { asked(composition) } else { composition };
        if !domestic && functional.is_none() && composition == "courtyard"
            && !super::super::culture::functional_choice_registered(building_culture,&culture.architecture_pack,&role,
                &allocation.function,composition,mode) {
            let sources = feasibility::recipe_sources(&culture.admissibility.recipe_id);
            if !sources.is_empty() && sources.iter().all(|p| p.layout == "single") {
                composition = "detached";
            }
        }
        if !matches!(composition, "row" | "detached") {
            return Ok(Some(parcel.id.clone()));
        }
        let form = if composition == "row" { super::super::parcels::OccupationKind::Row } else { super::super::parcels::OccupationKind::Detached };
        let parts = super::super::parcels::occupation_preview_resolved(parcel, &occupancy, Some(form)).0;
        Ok((!parts.is_empty()).then(|| parcel.id.clone()))
    }
}
