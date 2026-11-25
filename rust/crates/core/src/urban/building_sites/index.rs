//! Building-site indexing, pagination, and per-site requests.

use super::*;

/// Hard transport bounds; budgets count the serialized UTF-8 requests array,
/// including its brackets and commas, not the surrounding page metadata.
pub const MAX_SITE_PAGE_SIZE: usize = 64;
pub const MAX_SITE_PAGE_BYTES: usize = 24 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct SitePage {
    pub total: usize,
    pub offset: usize,
    pub next: usize,
    pub requests: Vec<Value>,
    /// Each request already serialised (same bytes as `requests[i]`).
    #[serde(skip)]
    pub raw: Vec<Vec<u8>>,
    /// Minimum array budget for the next individual site when it did not fit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_bytes: Option<usize>,
}

pub(super) struct LayoutIndex {
    /// Only structurally edited blocks need an owned view of the retained source.
    prepared: Option<Layout>,
    pub(super) layout: usize,
    frontages: super::super::parcels::FrontageIndex,
    pub(super) districts: BTreeMap<usize, (String, Option<f64>)>,
    // Town-wide values every site reads: computed once per layout on first use
    // (a per-site sum over all quarters or copy of all enclosure rings would
    // make the stage quadratic in the number of sites).
    radius: std::sync::OnceLock<f64>,
    enclosures: std::sync::OnceLock<Vec<super::super::Shape>>,
}
impl LayoutIndex {
    fn radius(&self, layout: &Layout) -> f64 {
        *self.radius.get_or_init(|| super::super::shanty::formal_radius(layout))
    }
    fn enclosure_shapes(&self, layout: &Layout) -> &[super::super::Shape] {
        self.enclosures.get_or_init(|| {
            layout
                .enclosures
                .iter()
                .map(|e| super::super::Shape { outer: e.path.clone(), holes: vec![] })
                .collect()
        })
    }
}
pub(super) struct PartitionIndex {
    pub(super) partition: usize,
    pub(super) layout: usize,
    adjacent: Vec<Vec<usize>>,
    // Numeric block/culture slots are prepared once; morphology is resolved
    // only when a page first requests a site from that slot.
    pub(super) tissues: Vec<std::sync::OnceLock<Option<(String, super::super::Morph)>>>,
}
pub(super) struct SiteIndex {
    pub(super) partition: usize,
    pub(super) allocation: usize,
    pub(super) parcel: usize,
    pub(super) tissue: usize,
}

/// Numeric references and small context caches into immutable retained inputs.
/// No cadastral geometry, terrain patch, preview or request payload is cloned at
/// preparation. The caller must retain the same layouts/partitions until done.
/// No generated payload is retained between page calls, including failed budgets.
pub struct BuildingSiteIndex {
    pub(super) layouts: Vec<LayoutIndex>,
    pub(super) partitions: Vec<PartitionIndex>,
    pub(super) sites: Vec<SiteIndex>,
    #[cfg(test)]
    pub(super) generated: std::sync::atomic::AtomicUsize,
}
impl BuildingSiteIndex {
    pub fn prepare(
        layouts: &[Layout],
        partitions: &[Partition],
        selected_partition_indices: &[usize],
    ) -> Result<Self, String> {
        let mut index = Self {
            layouts: Vec::new(),
            partitions: Vec::new(),
            sites: Vec::new(),
            #[cfg(test)]
            generated: std::sync::atomic::AtomicUsize::new(0),
        };
        let mut layout_indices = BTreeMap::new();
        // First layout of each key, as `position` finds it.
        let mut first_layout: HashMap<&str, usize> = HashMap::with_capacity(layouts.len());
        for (i, l) in layouts.iter().enumerate() {
            first_layout.entry(l.key.as_str()).or_insert(i);
        }
        let mut selected = std::collections::BTreeSet::new();
        for &partition_id in selected_partition_indices {
            if !selected.insert(partition_id) {
                return Err("Duplicate selected architecture partition".into());
            }
            let partition = partitions
                .get(partition_id)
                .ok_or("Selected architecture partition missing")?;
            // Match the first layout just like the original collect path.
            let layout_id = *first_layout
                .get(partition.key.as_str())
                .ok_or("Missing layout for architecture sites")?;
            let Some(pr) = &partition.programme else {
                continue;
            };
            let prepared = partition.prepared.as_ref().map(|_| super::super::partition_layout(&layouts[layout_id], partition));
            let layout = prepared.as_ref().unwrap_or(&layouts[layout_id]);
            let layout_slot = *layout_indices.entry(layout_id).or_insert_with(|| {
                let slot = index.layouts.len();
                index.layouts.push(LayoutIndex {
                    prepared: prepared.clone(),
                    layout: layout_id,
                    frontages: super::super::parcels::FrontageIndex::new(&super::super::shanty::formal_layout(layout)),
                    districts: district_programmes(layout),
                    radius: std::sync::OnceLock::new(),
                    enclosures: std::sync::OnceLock::new(),
                });
                slot
            });
            // Last duplicate parcel/culture ID wins, as in the previous maps.
            let parcels = partition
                .parcels
                .iter()
                .enumerate()
                .map(|(i, p)| (p.id.as_str(), i))
                .collect::<BTreeMap<_, _>>();
            let cultures = pr
                .cultures
                .iter()
                .enumerate()
                .map(|(i, c)| (c.culture.as_str(), i))
                .collect::<BTreeMap<_, _>>();
            let mut adjacent = vec![Vec::new(); partition.parcels.len()];
            for edge in &pr.adjacency {
                if let (Some(&a), Some(&b)) =
                    (parcels.get(edge.a.as_str()), parcels.get(edge.b.as_str()))
                {
                    adjacent[a].push(b);
                    adjacent[b].push(a);
                }
            }
            let partition_slot = index.partitions.len();
            let mut tissue_indices = BTreeMap::new();
            let mut tissues = Vec::new();
            for (allocation_id, allocation) in pr.allocations.iter().enumerate() {
                let &parcel_id = parcels
                    .get(allocation.parcel_id.as_str())
                    .ok_or("Allocated parcel ID missing")?;
                // Keep the legacy validation order: even gardens need their
                // allocated parcel, but they do not emit sites or need culture.
                if allocation.role == "open.garden" {
                    continue;
                }
                let parcel = &partition.parcels[parcel_id];
                if parcel.id.is_empty() {
                    return Err("Architecture sites require cadastral parcel IDs".into());
                }
                cultures
                    .get(allocation.culture.as_str())
                    .ok_or("Missing applied cultural mapping")?;
                let tissue = *tissue_indices
                    .entry((parcel.block, allocation.culture.as_str()))
                    .or_insert_with(|| {
                        let slot = tissues.len();
                        tissues.push(std::sync::OnceLock::new());
                        slot
                    });
                index.sites.push(SiteIndex {
                    partition: partition_slot,
                    allocation: allocation_id,
                    parcel: parcel_id,
                    tissue,
                });
            }
            index.partitions.push(PartitionIndex {
                partition: partition_id,
                layout: layout_slot,
                adjacent,
                tissues,
            });
        }
        Ok(index)
    }

    pub fn total(&self) -> usize {
        self.sites.len()
    }

    /// Generate only this contiguous page. Replaying the same offset and inputs
    /// is deterministic; callers may reduce the budget to their remaining buffer.
    /// If the next site cannot fit, `next` still points at that unconsumed site.
    #[allow(clippy::too_many_arguments)]
    pub fn page(
        &mut self,
        seed: &str,
        layouts: &[Layout],
        partitions: &[Partition],
        surface: Surface<'_>,
        water_level: &[f32],
        architecture_culture: Option<&str>,
        offset: usize,
        limit: usize,
        max_bytes: usize,
    ) -> Result<SitePage, String> {
        if offset > self.total() {
            return Err("Architecture page offset out of bounds".into());
        }
        if !(1..=MAX_SITE_PAGE_SIZE).contains(&limit) {
            return Err("Architecture page limit must be in 1..=64".into());
        }
        if !(2..=MAX_SITE_PAGE_BYTES).contains(&max_bytes) {
            return Err("Architecture page budget must be in 2..=24 MiB".into());
        }
        let mut page = SitePage {
            total: self.total(),
            offset,
            next: offset,
            requests: Vec::new(),
            raw: Vec::new(),
            required_bytes: None,
        };
        let mut bytes = 2; // JSON array brackets.
        let end = offset.saturating_add(limit).min(self.total());
        let this = &*self;
        // Sites are pure; generate and serialise them in parallel, then fold
        // the byte budget in order so pagination is unchanged.
        let built: Vec<Result<(Value, Vec<u8>), String>> = super::super::par::range(end - offset, |k| {
            let request = this.request_one(
                offset + k,
                seed,
                layouts,
                partitions,
                surface,
                water_level,
                architecture_culture,
            )?;
            let raw = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
            Ok((request, raw))
        });
        for (k, built) in built.into_iter().enumerate() {
            let i = offset + k;
            let (request, raw) = built?;
            let size = raw.len();
            if size + 2 > MAX_SITE_PAGE_BYTES {
                return Err(format!(
                    "Architecture site {} needs {} bytes, exceeds the 24 MiB page limit",
                    request["id"],
                    size + 2
                ));
            }
            let added = size + usize::from(!page.requests.is_empty());
            if bytes + added > max_bytes {
                page.required_bytes = Some(size + 2);
                break;
            }
            bytes += added;
            page.requests.push(request);
            page.raw.push(raw);
            page.next = i + 1;
        }
        Ok(page)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn request_one(
        &self,
        i: usize,
        seed: &str,
        layouts: &[Layout],
        partitions: &[Partition],
        surface: Surface<'_>,
        water_level: &[f32],
        architecture_culture: Option<&str>,
    ) -> Result<Value, String> {
        self.request_site(i, seed, layouts, partitions, surface, water_level, architecture_culture, true)
    }

    /// `request_one`; `with_grid: false` leaves out the terrain elevation grid
    /// (`terrain.grid`), which the display projection never reads.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn request_site(
        &self,
        i: usize,
        seed: &str,
        layouts: &[Layout],
        partitions: &[Partition],
        surface: Surface<'_>,
        water_level: &[f32],
        architecture_culture: Option<&str>,
        with_grid: bool,
    ) -> Result<Value, String> {
        #[cfg(test)]
        self.generated.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let site = &self.sites[i];
        let partition_index = &self.partitions[site.partition];
        let layout_index = &self.layouts[partition_index.layout];
        let layout = layout_index.prepared.as_ref().or_else(|| layouts.get(layout_index.layout))
            .ok_or("Retained layout missing")?;
        let partition = partitions
            .get(partition_index.partition)
            .ok_or("Retained partition missing")?;
        let pr = partition
            .programme
            .as_ref()
            .ok_or("Retained programme missing")?;
        let allocation = pr
            .allocations
            .get(site.allocation)
            .ok_or("Retained allocation missing")?;
        let parcel = partition
            .parcels
            .get(site.parcel)
            .ok_or("Retained parcel missing")?;
        if parcel.family == "shanty" {
            let site_seed = super::super::edits::building_seed(seed, &parcel.id, partition);
            let mut request = super::super::shanty::request(layout, parcel, surface, &site_seed)?;
            if with_grid {
                request["terrain"]["grid"] = ground_patch(surface, &parcel.shape);
            }
            apply_massing_overrides(&mut request, layout, partition, parcel, architecture_culture)?;
            return Ok(request);
        }
        if let Some(water) = super::super::springs::site(layout, &parcel.id) {
            let site_seed = super::super::edits::building_seed(seed, &parcel.id, partition);
            let mut request = super::super::springs::request(water, layout, surface, &site_seed);
            if with_grid {
                request["terrain"]["grid"] = ground_patch(surface, &water.shape);
            }
            apply_massing_overrides(&mut request, layout, partition, parcel, architecture_culture)?;
            return Ok(request);
        }
        // A scoped culture replaces the whole tissue, including its house form.
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
                .or_else(|| super::super::culture::parcel_mapping(
                    layout,
                    parcel,
                    &allocation.culture,
                    &allocation.function,
                ))
                .ok_or("No contextual native recipe")?,
            ),
        };
        let building_culture = building_culture.as_str();
        // Lots admitted by the pack's compact house (courtyard cultures)
        // request that recipe, never the court house they cannot hold.
        if !super::super::culture::functional_role_resolved(building_culture,&culture.architecture_pack,&allocation.role,&allocation.function)
            && let Some(small) = super::super::parcels::compact_fallback(
            &culture.architecture_pack,
            &pr.context.period,
            &culture.admissibility,
        ) {
            let fits = |a: &super::super::culture::UrbanAdmissibility| {
                parcel
                    .envelope
                    .as_ref()
                    .is_some_and(|e| super::super::parcels::witnessed_by(e, a))
            };
            if !fits(&culture.admissibility)
                && (fits(&small)
                    || super::super::parcels::parcel_envelope(
                        parcel,
                        culture.admissibility.min_frontage,
                        culture.admissibility.min_depth,
                        culture.admissibility.min_access_width,
                    )
                    .is_none())
            {
                culture.admissibility = small;
            }
        }
        // Boolean cuts leave numerical sliver holes (down to 1e-9 m²); houses rightly
        // rejects such reserves, so only real cadastral holes are passed on.
        let lot = super::super::Shape {
            outer: parcel.shape.outer.clone(),
            holes: parcel
                .shape
                .holes
                .iter()
                .filter(|ring| ring_area(ring) >= 0.5)
                .cloned()
                .collect(),
        };
        let center = interior_point(&parcel.shape);
        let ground = surface.height_at(center);
        let delta = (surface.width / surface.height_resolution() as f64).max(0.5);
        let gradient = [
            (surface.height_at(Point {
                x: center.x + delta,
                y: center.y,
            }) - surface.height_at(Point {
                x: center.x - delta,
                y: center.y,
            })) / (2.0 * delta),
            (surface.height_at(Point {
                x: center.x,
                y: center.y + delta,
            }) - surface.height_at(Point {
                x: center.x,
                y: center.y - delta,
            })) / (2.0 * delta),
        ];
        let index = (center.y / surface.width * surface.n as f64)
            .floor()
            .clamp(0.0, (surface.n - 1) as f64) as usize
            * surface.n
            + (center.x / surface.width * surface.n as f64)
                .floor()
                .clamp(0.0, (surface.n - 1) as f64) as usize;
        let water = if surface.wet(center) {
            water_level.get(index).map(|h| f64::from(*h))
        } else {
            None
        };
        let mode = super::super::culture::houses_mode(&pr.context.mode);
        let function = match allocation.function.as_str() {
            "market" | "common" => "open_space",
            f => f,
        };
        let grid = if with_grid { ground_patch(surface, &parcel.shape) } else { Value::Null };
        let party_boundaries = if culture.admissibility.party_walls {
            partition_index.adjacent[site.parcel]
                .iter()
                .map(|&i| &partition.parcels[i])
                .flat_map(|other| shared_boundaries(&parcel.shape, &other.shape))
                .collect::<Vec<_>>()
        } else {
            vec![]
        };
        let floors = typical_floors(
            &culture,
            &allocation.function,
            pr.population,
            parcel.pressure,
        );
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
        let floors = tissue.as_ref().map_or(floors, |(zone, morph)| {
            if zone == "village"
                || culture.functional_profile == "communal"
                || !matches!(allocation.function.as_str(), "domestic" | "mixed")
            {
                return floors;
            }
            let levels = &morph.value["arch"]["storeys"];
            let lo = levels[0].as_u64().unwrap_or(u64::from(floors)) as u32;
            let hi = levels[1].as_u64().unwrap_or(u64::from(floors)) as u32;
            super::super::zone_blend::floors_at(&morph.value["arch"], lo, hi, parcel.pressure)
                .unwrap_or_else(|| lo + ((hi.saturating_sub(lo)) as f64 * parcel.pressure).round() as u32)
                .clamp(
                culture.admissibility.floors[0],
                culture.admissibility.floors[1],
            )
        });
        // The stored cadastral witness is reused when it has this recipe's
        // dimensions; the search only reruns for a different admission.
        let reusable = parcel
            .envelope
            .as_ref()
            .filter(|e| super::super::parcels::witnessed_by(e, &culture.admissibility));
        let hint = reusable.cloned().or_else(|| {
            super::super::parcels::parcel_envelope(
                parcel,
                culture.admissibility.min_frontage,
                culture.admissibility.min_depth,
                culture.admissibility.min_access_width,
            )
        });
        let programme = programme_of(allocation, parcel, layout, &layout_index.districts);
        let wealth = programme["wealth"].as_f64().unwrap_or(0.5);
        let mut site_seed = super::super::edits::building_seed(seed, &parcel.id, partition);
        if let Some(salt) = partition.config.as_ref().and_then(|cfg| cfg.overrides.blocks.get(&parcel.block.to_string())).and_then(|e| e.salt).filter(|s| *s > 0) {
            site_seed.push_str(&format!("/block-salt:{salt}"));
        }
        let role = programme["role"].as_str().unwrap_or("").to_string();
        let functional = super::super::culture::functional_programme(
            &culture.architecture_pack,
            &role,
            &allocation.function,
            &pr.context.period,
            mode,
        );
        let domestic = matches!(allocation.function.as_str(), "domestic" | "mixed");
        // A tenement is a collective body (CODEX_ROMAN_COURTYARD_REVIEW.md):
        // three to five floors where the pack has such a native recipe and
        // the lot holds it, around a court only where the lot holds one of
        // the pack's native court recipes (Ostia's court insulae), else a
        // block-front body at the tissue's maximum height.
        let collective_home = functional.is_none()
            && domestic
            && (role == "dwelling.tenement" || role.starts_with("dwelling.tenement."));
        // Feasible by construction (feasibility.rs): the automatic homes and
        // shops houses draws from its shortlist are composed from the native
        // witnesses (recipe × variant) the real lot actually holds.
        let automatic_home = functional.is_none() && domestic;
        let feasible = automatic_home && feasibility_enabled();
        let admissible = if collective_home || feasible {
            feasibility::admissible(
                &culture.architecture_pack,
                building_culture,
                &pr.context.period,
                mode == "historical_strict",
            )
        } else {
            Vec::new()
        };
        let fit = (collective_home || feasible).then(|| feasibility::lot_fit(parcel, &admissible));
        let fits: &[&NativeProfile] = fit.as_ref().map_or(&[], |f| &f.fits);
        let tall = if collective_home {
            let tall: Vec<_> = fits
                .iter()
                .copied()
                .filter(|p| tall_collective(p))
                .collect();
            collective_floors(&tall, parcel.pressure)
        } else {
            None
        };
        // Shops and houses keep the tissue range by pressure.
        let floors_range = if let Some(range) = tall {
            Some(range)
        } else if collective_home {
            let top = tissue
                .as_ref()
                .and_then(|(_, morph)| morph.value["arch"]["storeys"][1].as_u64())
                .map_or(floors, |hi| hi as u32)
                .clamp(
                    culture.admissibility.floors[0],
                    culture.admissibility.floors[1],
                );
            Some([top, top])
        } else if domestic || functional.is_some() {
            Some([
                floors
                    .saturating_sub(1)
                    .max(culture.admissibility.floors[0])
                    .min(floors),
                floors,
            ])
        } else {
            None
        };
        let wish = floors_range.or_else(|| wish_of(&programme["floors"]));
        let drawable: Vec<_> = if feasible {
            feasibility::drawable(
                &culture.architecture_pack,
                building_culture,
                &pr.context.period,
                mode == "historical_strict",
            )
            .collect()
        } else {
            Vec::new()
        };
        // The composition finally asked for a wished form, by the same calls
        // as below: the preview draws a home's court only where a court wish
        // stays a court (preview = asked composition, by construction).
        let asked = |wished: &'static str| {
            let c = feasibility::feasible_composition(
                wished,
                wish,
                &drawable,
                fits,
                culture.admissibility.party_walls,
            )
            .unwrap_or(wished);
            if round7() {
                feasibility::programme_composition(
                    c,
                    wish,
                    feasibility::programme_source_role(&role, &allocation.function),
                    fits,
                )
            } else {
                c
            }
        };
        let court_kept = feasible.then(|| asked("courtyard") == "courtyard");
        // An insula wraps its court only where the lot holds a native court
        // layout and the court is the composition asked.
        let court_lot =
            collective_home && fits.iter().any(|p| court_layout(p)) && court_kept != Some(false);
        let occupancy = tissue
            .as_ref()
            .map(|(zone, morph)| super::super::parcels::Occupancy {
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
            });
        // One occupation choice (role + tissue, then the lot's geometry) feeds
        // both the preview and the wished composition: the realized form when
        // the preview builds, else the wished one.
        let (mut parts, realized) = occupancy.as_ref().map_or((Vec::new(), None), |o| {
            super::super::parcels::occupation_preview(parcel, o)
        });
        let arch = tissue.as_ref().map_or(&Value::Null, |(_, morph)| &morph.value["arch"]);
        let home_area = if domestic && !parts.is_empty() && tissue.as_ref().is_some_and(|(zone,_)| zone != "core")
            && !programme["landmark"].as_bool().unwrap_or(false)
            && !role.contains("tower") && parts.iter().all(|(_,l)| matches!(*l, "barn" | "byre" | "annex") || super::super::forms::plan::is_house_part(l))
            && super::super::house_mix::ordinary_home(building_culture, arch, &site_seed) {
            let radius = layout_index.radius(layout);
            let enclosures = layout_index.enclosure_shapes(layout);
            let outside = !enclosures.is_empty() && !enclosures.iter().any(|e| super::super::geometry::contains(e, center));
            super::super::house_mix::HomeContext {
                zone:tissue.as_ref().map_or("", |(zone,_)| zone.as_str()),
                district:programme["district_role"].as_str().unwrap_or(""), wealth, pressure:parcel.pressure,
                distance:(center.x-layout.center.x).hypot(center.y-layout.center.y)/radius,
                outside, farm:role.starts_with("dwelling.farm"),
                low_rural: layout.config.as_ref().is_none_or(|c| c.low_rural_houses),
            }.area_scale(&site_seed)
        } else { 1.0 };
        // A pile house is small and light (a home about 36 m², any other lot 60 m²).
        let home_area = if !parts.is_empty() && !programme["landmark"].as_bool().unwrap_or(false)
            && super::super::massing::pile_house(building_culture, arch) {
            let built: f64 = parts.iter().map(|(s, _)| super::super::geometry::area(s)).sum();
            home_area.min((if domestic { 36.0 } else { 60.0 } / built.max(1.0)).min(1.0))
        } else { home_area };
        // Longhouse peoples (norse): a few full longhouses among many smaller
        // houses and outbuildings (35–55 % of the area); the well-off keep theirs.
        let home_area = if domestic && !parts.is_empty() && !programme["landmark"].as_bool().unwrap_or(false)
            && arch["typology"].as_str() == Some("longhouse") && super::super::culture::house_parameters(building_culture).1 != "longhouse"
            && wealth < 0.7 {
            let zone = tissue.as_ref().map_or("", |(zone, _)| zone.as_str());
            let mut r = crate::rng::Rng::new(&site_seed).fork("longhouse-mix");
            let chance = if matches!(zone, "core" | "middle") { 0.35 } else { 0.6 };
            if r.chance(chance) { home_area.min(r.range(0.35, 0.55)) } else { home_area }
        } else { home_area };
        // A main building scales with the population: a village's parish church
        // or hall is about half a town's (never under 150 m²); 10 000 and more unchanged.
        let home_area = if !parts.is_empty() && (programme["landmark"].as_bool().unwrap_or(false) || role.starts_with("worship") || role.starts_with("civic")) {
            let size = (((pr.population.max(1) as f64).ln() - 500f64.ln()) / (10_000f64.ln() - 500f64.ln())).clamp(0.0, 1.0);
            let built: f64 = parts.iter().map(|(s, _)| super::super::geometry::area(s)).sum();
            if pr.population == 0 || size >= 1.0 || built <= 150.0 { home_area }
            else { home_area.min((0.45 + 0.55 * size).max(150.0 / built)) }
        } else { home_area };
        super::super::house_mix::scale_home(&mut parts, parcel, home_area);
        let kind = realized.or_else(|| occupancy.as_ref().map(super::super::parcels::occupation_kind));
        // Programme → architecture preferences (contract agreed with Codex,
        // OPUS_CITY.md): wished composition, floors and street continuity; the
        // footprint target is the city occupation preview, omitted when empty.
        // Automatic floors of homes, shops and declared functional programmes
        // travel here, not as a hard override.
        // A compound tissue (Javanese, Andean, West African… `plotOp: compound`)
        // wishes a compound even when the preview falls back to a street row.
        let compound_tissue = tissue
            .as_ref()
            .is_some_and(|(_, morph)| morph.text("plotOp") == "compound");
        let composition = functional.map_or_else(
            || match composition_of(&role, kind) {
                "row" | "detached" if compound_tissue => "compound",
                c => c,
            },
            |p| p.composition.as_str(),
        );
        let mut programme = programme;
        programme["party_walls"] = json!(culture.admissibility.party_walls);
        // A lot its form could not build says why (too small, no rectangle, court only…).
        if parts.is_empty()
            && let Some(o) = &occupancy
            && let Some(reason) = super::super::parcels::occupation_empty_reason(parcel, o)
        {
            programme["empty_reason"] = json!(reason);
        }
        if let Some(range) = floors_range {
            programme["floors"] = json!(range);
        }
        // The programme houses' shortlist reads (composition, then floors) is
        // chosen so that the sources it is certain to draw are ones the lot
        // holds: the wished composition unless another one of the culture
        // brings more of them; floors among the levels those witnesses offer
        // (the insula levels already come from its witnesses).
        let wished = composition;
        // Regenerating a display topology must not reduce the requested body
        // budget or change the native source ranking through a smaller preview.
        let requested_body_area: f64 = parts.iter().map(|(s, _)| super::super::geometry::area(s)).sum();
        // The typology follows the programme: the composition is the one whose
        // first shortlist group draws a source of the programme's own role
        // (Roman shop → dwelling over a shop, house → masonry house, tenement
        // → street block), among the sources the lot holds (`asked`).
        let mut composition = if feasible { asked(composition) } else { composition };
        // A pinned fallback can only preview the topology that its native
        // variants declare. This does not certify its requested civic function.
        if preview_topology_enabled() && !domestic && functional.is_none() && composition=="courtyard"
            && !super::super::culture::functional_choice_registered(building_culture,&culture.architecture_pack,&role,
                &allocation.function,composition,mode) {
            let sources=feasibility::recipe_sources(&culture.admissibility.recipe_id);
            if !sources.is_empty() && sources.iter().all(|p|p.layout=="single") {
                composition="detached";
                programme["preview_topology_resolution"]=json!({"from":"courtyard","to":"detached",
                    "basis":"pinned native Single variants; requested function remains unverified"});
            }
        }
        programme["composition"] = json!(composition);
        // A resolved simple source cannot inherit a closed ring from the old
        // court wish. Re-run the constructor, preserving its geometric guards.
        if preview_topology_enabled() && matches!(composition,"row"|"detached") && parts.iter().any(|(s,_)|!s.holes.is_empty())
            && let Some(o)=&occupancy {
            let form=if composition=="row" {super::super::parcels::OccupationKind::Row} else {super::super::parcels::OccupationKind::Detached};
            parts=super::super::parcels::occupation_preview_resolved(parcel,o,Some(form)).0;
            super::super::house_mix::scale_home(&mut parts,parcel,home_area);
        }
        // Every rural dwelling is a farmstead: its culture's outbuildings around a yard (farmsteads.rs);
        // a ruin keeps only its broken walls.
        // `outbuildings` (0..1): share of rural dwellings (farms included) that keep
        // their outbuildings. A lone farm always keeps the core buildings of its
        // culture's farm type (barn, byre…) in that type's layout: the share then
        // only decides its ancillary ones.
        // A lone farm whose lot the occupation could not cut still gets its farmhouse (its
        // outbuildings follow below): a house of its culture's size in the lot, along its longest side.
        if parts.is_empty() && role.starts_with("dwelling.farm") && !role.ends_with(".ruin") && super::super::roles::is_isolated(&pr.context.intent)
            && let Some(house) = lone_farmhouse(&lot, building_culture, &site_seed)
        {
            parts.push((house, "building"));
        }
        let accesses = access_segments(layout, parcel, &layout_index.frontages);
        let point = |v: &Value| {
            Some(super::super::Point {
                x: v["x"].as_f64()?,
                y: v["y"].as_f64()?,
            })
        };
        // A home whose ground drops more than its culture's way of building
        // takes is turned along the contour or made shallower (hillside.rs),
        // before its farmstead is laid around it.
        let hill = super::super::massing::hillside(building_culture, arch);
        if domestic && !parts.is_empty() && !programme["landmark"].as_bool().unwrap_or(false) {
            let ways: Vec<[super::super::Point; 2]> = accesses
                .iter()
                .filter_map(|a| Some([point(&a["segment"][0])?, point(&a["segment"][1])?]))
                .collect();
            let scale = super::super::forms::kit::traits(building_culture).body_scale;
            let min_depth = (4.0 * if scale > 0.0 { scale } else { 1.0 }).max(3.0);
            if let Some(settled) = hillside::settle(&mut parts, super::super::forms::plan::is_house_part, super::super::forms::plan::min_side,
                &lot, &ways, surface, hill.max_drop_m, min_depth)
            {
                programme["hillside"] = settled.json();
            }
        }
        let ancillary = crate::rng::Rng::new(&site_seed).fork("outbuildings").chance(layout.config.as_ref().map_or(0.5, |c| c.outbuildings));
        let farmhouse = role.starts_with("dwelling.farm");
        let lone = farmhouse && super::super::roles::is_isolated(&pr.context.intent);
        if !parts.is_empty() && !role.ends_with(".ruin") && !super::super::massing::pile_house(building_culture, arch)
            && let Some(farm) = super::super::farmsteads::rural(tissue.as_ref().map_or("", |(zone, _)| zone.as_str()), &role,
                programme["landmark"].as_bool().unwrap_or(false), tissue.as_ref().is_some_and(|(_, m)| !m.text("campLayout").is_empty()), ring_area(&lot.outer), pr.population)
            // A closed court or round compound is the dwelling itself: its domestic core
            // stands on every rural home; the share only doses what lies beyond it.
            && (ancillary || lone || super::super::farmsteads::compound_dwelling(building_culture, &site_seed))
            && let Some(cluster) = super::super::farmsteads::build(&mut parts, &lot, building_culture, farm, farmhouse, wealth, &site_seed, ancillary) {
            programme["farmstead"] = cluster;
        }
        // City Bench `activity` intent: the template's yard (laid again from the centre and
        // axis kept by kinds.rs), one part per building, each with its archetype massing.
        let mut activity_massing: Option<Vec<Value>> = None;
        let mut activity_step = None;
        if pr.context.intent == "activity" && role == "craft.activity"
        {
            let yard = super::super::activities::retained_yard(layout, &pr.context.template, parcel.block, &lot, &surface);
            if !yard.is_empty() {
                activity_step = Some(super::super::activities::yard_step(&yard, &surface));
                parts = yard.iter().map(|b| (super::super::Shape { outer: b.ring.clone(), holes: vec![] }, "building")).collect();
                activity_massing = Some(yard.iter().flat_map(|b| b.massing.as_array().cloned().unwrap_or_default()).collect());
                programme["activity"] = json!({"template": pr.context.template, "archetypes": yard.iter().map(|b| b.archetype.clone()).collect::<Vec<_>>()});
            }
        }
        let preview: Vec<_> = parts.iter().map(|(s, _)| s).collect();
        let preview_parts: Vec<_> = parts.iter().map(|(_, l)| *l).collect();
        // The street wall stays the urban intent of the wished form.
        programme["frontage_continuity"] = json!(frontage_continuity(wished));
        if feasible
            && tall.is_none()
            && !fits.is_empty()
            && let Some(wish) = wish
        {
            programme["floors"] = json!(feasibility::feasible_floors(wish, composition, fits));
        }
        if home_area < 1.0 { programme["floors"] = json!([1, 1]); }
        let built = requested_body_area;
        if built.is_finite() && built > 1.0 {
            programme["built_area_m2"] = json!((built * 10.0).round() / 10.0);
        }
        let occupation = tissue.as_ref().map(|(zone, morph)| {
            let average = |key| {
                let r = morph.range(key, zone);
                (r[0] + r[1]) * 0.5
            };
            json!({"coverage":average("coverage").clamp(0.05, 1.0),
                "depth_m":average("buildDepth"),"frontage_m":average("frontage")})
        });
        // Houses poses its sources along a declared access or the hint edge.
        let direction = |a: super::super::Point, b: super::super::Point| {
            let l = (b.x - a.x).hypot(b.y - a.y);
            (l > 0.1).then(|| super::super::Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            })
        };
        let dirs: Vec<super::super::Point> = accesses
            .iter()
            .filter_map(|a| direction(point(&a["segment"][0])?, point(&a["segment"][1])?))
            .chain(
                hint.iter()
                    .filter(|h| h.outer.len() >= 2)
                    .filter_map(|h| direction(h.outer[0], h.outer[1])),
            )
            .collect();
        // The admission recipe only proves the lot can hold a house: homes and
        // shops let the houses style index choose among the pack's compatible
        // recipes (Codex shortlist). Only an exact exported functional role may
        // choose its declared programme here, before any user overrides exist.
        // Existing requests/pins are never reinterpreted by the houses consumer.
        // A role houses resolves from its functional-choices registry gets
        // neither the admission pin nor hard floors (explicit overrides still apply).
        let registered = !domestic
            && functional.is_none()
            && super::super::culture::functional_choice_registered(
                building_culture,
                &culture.architecture_pack,
                &role,
                &allocation.function,
                composition,
                mode,
            );
        let source_gap=super::super::culture::functional_source_gap(building_culture,
            &culture.architecture_pack,&role,&allocation.function,&pr.context.period,mode);
        if let Some(gap)=source_gap {
            programme["source_coverage"]=json!({"version":"functional-source-coverage-1",
                "status":"missing","requirement":gap.id,"reason":gap.reason,
                "role":role,"pack":culture.architecture_pack,"function":allocation.function,
                "functional_footing_tested":false,"residential_fallback_is_functional_source":false});
        }
        let admission_recipe = functional.map(|p| p.recipe_id.as_str()).or_else(|| {
            (!domestic && !registered && source_gap.is_none()).then_some(culture.admissibility.recipe_id.as_str())
        });
        // A registered functional envelope draws only its declared simple
        // sources: the built target stays inside the body-area range their
        // nominal dimensions span (the rest of the lot is its yard), never a
        // footprint no declared source can take.
        let choice_sources = registered
            .then(|| {
                super::super::culture::functional_choice_sources(
                    building_culture,
                    &culture.architecture_pack,
                    &role,
                    &allocation.function,
                    composition,
                    mode,
                )
            })
            .flatten();
        if let Some((_, [lo, hi])) = &choice_sources
            && round7()
            && let Some(target) = programme["built_area_m2"].as_f64()
        {
            programme["built_area_m2"] = json!(target.clamp(*lo, *hi));
        }
        // Urban deficit: a lot none of the native sources houses may draw for
        // this programme can occupy (the culture's automatic homes, the
        // declared sources of a functional choice, or the pinned recipe of a
        // facility) is not sent to houses to be drawn and refused, and no
        // smaller building stands for its programme: it stays open land and
        // its households are stated.
        let drawable: Vec<&NativeProfile> = if source_gap.is_some() || !feasibility_enabled() || function == "open_space" {
            Vec::new()
        } else if feasible {
            feasibility::drawable(
                &culture.architecture_pack,
                building_culture,
                &pr.context.period,
                mode == "historical_strict",
            )
            .collect()
        } else if !round7() {
            Vec::new()
        } else if let Some((styles, _)) = &choice_sources {
            feasibility::style_sources(styles)
        } else if let Some(recipe) = admission_recipe {
            feasibility::recipe_sources(recipe)
        } else {
            Vec::new()
        };
        // A town relaxed onto a slope (`ProgrammeContext::slope_relax`) stands
        // on stepped plinths: its foundation step widens with the house slope.
        let foundation_step = feasibility::foundation_step(pr.context.slope_relax)
            .max(activity_step.map_or(0.0, |step| step + 0.02));
        // Activity bodies were laid and checked against this exact domain;
        // a different residential recipe cannot disqualify their footprint.
        let deficit = if activity_step.is_some() { None }
            else if source_gap.is_some() { Some("source_absente") }
            else { lot_deficit(&drawable, surface, &parcel.shape, &dirs, gradient, foundation_step) };
        if let Some(cause) = deficit {
            programme["deficit"] = json!({"cause":cause,"households":allocation.households.max(0.0),
                "message":deficit_message(cause)});
        }
        let feasibility = fit.as_ref().filter(|_| feasible).map(|f| {
            let mut recipes: Vec<&str> = Vec::new();
            for w in &f.fits {
                if !recipes.contains(&w.recipe_id.as_str()) && recipes.len() < 12 {
                    recipes.push(&w.recipe_id);
                }
            }
            json!({"version":"lot-feasibility-1","frontage_m":(f.frontage_m*100.0).round()/100.0,
                "domain_m":f.domain.as_ref().map(|(d, _)| [(d[0]*100.0).round()/100.0, (d[1]*100.0).round()/100.0]),
                "fitting_witnesses":f.fits.len(),"admissible_witnesses":f.admissible,"recipes":recipes})
        });
        let function = if deficit.is_some() {
            "open_space"
        } else {
            function
        };
        let config = json!({"schema_version":"2","seed":site_seed,"pack":culture.architecture_pack,"recipe":admission_recipe,
            "mode":mode,"era":if pr.context.period.is_empty(){"any"}else{&pr.context.period},"allow_late":false,
            "count":1,"size":1.0,"variation":0.65,"wealth":wealth,"orientation_deg":0.0,
            "overrides":{"footprint":null,"roof":null,"frame":null,"infill":null,"coating":null,"cladding":null,
                "floors":if domestic || functional.is_some() || registered || source_gap.is_some() {None} else {Some(floors)},"bodies":null,"courtyard_ratio":null,"overhang_m":null,"roof_pitch_deg":null,"site_slope_deg":null}});
        // Direct native poses (Codex's `native_minimum_candidates`), only
        // where houses' contract takes them: an automatic inspired home or
        // shop with default controls (wealth 0.5 included), a witness whose
        // frozen principal floors are in the wished range, of the wished
        // composition, and whose body is the built target within ±10 %. Never
        // a small house standing for a larger programme.
        let probe = feasibility_probe();
        let target = programme["built_area_m2"].as_f64();
        let candidates = if deficit.is_none()
            && feasible
            && mode == "historical_inspired"
            && (probe || wealth == 0.5)
        {
            let floors = wish_of(&programme["floors"]);
            let mut eligible: Vec<_> = fits
                .iter()
                .filter(|w| feasibility::composition_rank(composition, w) == 0)
                .filter_map(|w| feasibility::pose_witness(&w.style_id))
                .filter(|p| {
                    floors.is_none_or(|[lo, hi]| {
                        p.primary_floors.is_some_and(|f| (lo..=hi).contains(&f))
                    }) && (probe || target.is_none_or(|t| (p.body_area / t - 1.0).abs() <= 0.10))
                })
                .collect();
            eligible.sort_by(|a, b| {
                let gap = |p: &feasibility::PoseWitness| {
                    target.map_or(p.body_area, |t| (p.body_area - t).abs())
                };
                gap(a).total_cmp(&gap(b)).then(a.style_id.cmp(&b.style_id))
            });
            let mut out = Vec::new();
            for w in eligible {
                for c in feasibility::minimum_candidates(w, &lot, &accesses, surface) {
                    if out.len() < 4 {
                        out.push(c);
                    }
                }
                if out.len() == 4 {
                    break;
                }
            }
            out
        } else {
            Vec::new()
        };
        // Display massing of the preview pieces (massing.rs): the building
        // shown is the planned silhouette raised in volume.
        let fronts: Vec<[super::super::Point; 2]> = accesses
            .iter()
            .filter(|a| a["kind"] == "public")
            .filter_map(|a| Some([point(&a["segment"][0])?, point(&a["segment"][1])?]))
            .collect();
        // Activity archetype (activities.rs) of a specialised service role:
        // water mill on a river lot, windmill on open ground…, by culture.
        let zone = tissue.as_ref().map_or("", |(zone, _)| zone.as_str());
        let archetype = {
            let env = pr.environment.get(parcel.block).filter(|e| e.block == parcel.block);
            let ctx = super::super::activities::LotContext {
                river: env.is_some_and(|e| e.water == "river"),
                shore: env.is_some_and(|e| matches!(e.water.as_str(), "sea" | "lake")),
                open: !matches!(zone, "core" | "middle"),
            };
            super::super::activities::pick(&role, &allocation.culture, ctx, &site_seed).unwrap_or("")
        };
        if !archetype.is_empty() {
            programme["archetype"] = json!(archetype);
        }
        let massing = super::super::massing::massing(&super::super::massing::Input {
            archetype,
            parts: &parts,
            arch,
            culture: building_culture,
            zone: tissue.as_ref().map_or("", |(zone, _)| zone.as_str()),
            role: &role,
            function: &allocation.function,
            landmark: programme["landmark"].as_bool().unwrap_or(false),
            wealth,
            pressure: parcel.pressure,
            small_home: home_area < 1.0,
            population: pr.population,
            fronts: &fronts,
            seed: &site_seed,
            low_rural: layout.config.as_ref().is_none_or(|c| c.low_rural_houses),
            distance: {
                let radius = layout_index.radius(layout);
                (center.x - layout.center.x).hypot(center.y - layout.center.y) / radius
            },
            complex: super::super::forms::complex_houses(layout), user_core: super::super::massing::user_core(layout, parcel.block),
        });
        if let Some(m) = activity_massing {
            programme["massing"] = Value::Array(m);
        } else if !massing.is_null() {
            programme["massing"] = massing;
            // Each piece on sloping ground says how its drop is taken (massing::footing).
            if let Some(entries) = programme["massing"].as_array_mut() {
                for (entry, (shape, _)) in entries.iter_mut().zip(&parts) {
                    let (low, high) = hillside::ground_span(surface, &shape.outer);
                    if !entry.is_object() || high - low < super::super::massing::FOOTING_MIN_DROP_M {
                        continue;
                    }
                    let up = hillside::uphill(surface, super::super::geometry::centroid(shape), delta);
                    if let Some(footing) = super::super::massing::footing(hill.way, &shape.outer, up, &lot, &|p| surface.height_at(p), low, high) {
                        entry["footing"] = footing;
                    }
                }
            }
        }
        let mut request = json!({"id":format!("{}/building",parcel.id),"parcel_id":parcel.id,
            "placement_hint":hint.as_ref().map(|shape|vec![shape]),
            "preview":preview,"preview_parts":preview_parts,"programme":programme,
            "occupation":occupation,"feasibility":feasibility,
            "cadastral":[lot],"buildable":[lot],"reserves":lot.holes.iter().map(|hole|json!({"outer":hole,"holes":[]})).collect::<Vec<_>>(),"roof_domain":[lot],
            "accesses":accesses,"party_boundaries":party_boundaries,"neighbors":[],
            "culture":{"culture":building_culture,"pack":culture.architecture_pack,"mode":mode,
                "borrowing":if culture.borrowing.is_empty(){None}else{Some(&culture.borrowing)}},
            "function":function,"seed":site_seed,"config":config,
            "terrain":{"grid":grid,"origin":center,"ground_z_m":ground,"gradient":gradient,"water_z_m":water,"max_foundation_step_m":foundation_step}});
        if !candidates.is_empty() {
            request[if probe {
                "native_minimum_probe"
            } else {
                "native_minimum_candidates"
            }] = json!(candidates);
        }
        inherit_house_config(&mut request, layout, partition, parcel);
        apply_massing_overrides(&mut request, layout, partition, parcel, architecture_culture)?;
        funerary::apply(&mut request, &parcel.shape, parcel.axis);
        Ok(request)
    }
}
