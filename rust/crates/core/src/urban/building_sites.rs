//! Neutral coarse placement intents. No dependency on the architectural engine:
//! JSON follows the documented houses placement boundary, without renderer data.
use super::geometry::interior_point;
use super::{Layout, Parcel, Partition, Point, Surface};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn access_segments(
    layout: &Layout,
    p: &Parcel,
    frontages: &super::parcels::FrontageIndex,
) -> Vec<Value> {
    let mut out=p.contacts.iter().filter(|c|c.kind!="unserved"&&c.kind!="reserved"&&c.length>0.1)
        .map(|c|json!({"id":format!("{}/street/{}",p.id,c.street),"segment":[c.a,c.b],
            "kind":if c.kind=="collective"{"collective"}else if c.kind=="private"{"private"}else{"public"},"width_m":c.length})).collect::<Vec<_>>();
    out.sort_by(|a, b| {
        b["width_m"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["width_m"].as_f64().unwrap_or(0.0))
    });
    if !out.is_empty() {
        return out;
    }
    if let Some(front) = p.front
        && let Some(a) = &p.access
        && !matches!(a.kind.as_str(), "unserved" | "reserved")
    {
        out.push(json!({"id":format!("{}/front",p.id),"segment":front,"kind":a.kind,"width_m":a.front_length}));
        return out;
    }
    // A reservation keeps the same exact continuous contacts as the cadastre.
    out.extend(
        super::parcels::block_contacts_indexed(&p.shape, layout, frontages)
            .iter()
            .map(|c| {
                json!({
                    "id":format!("{}/reserved-street/{}",p.id,c.street),"segment":[c.a,c.b],
                    "kind":c.kind,"width_m":c.length
                })
            }),
    );
    out.sort_by(|a, b| {
        b["width_m"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["width_m"].as_f64().unwrap_or(0.0))
    });
    out
}
/// Row-major physical samples; origin is the centre of the first source cell.
fn ground_patch(surface: Surface<'_>, shape: &super::Shape) -> Value {
    let step = surface.width / surface.n as f64;
    let (mut x0, mut y0, mut x1, mut y1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for p in &shape.outer {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    let lo =
        |v: f64| ((v / step - 0.5).floor() as isize - 1).clamp(0, surface.n as isize - 1) as usize;
    let hi =
        |v: f64| ((v / step - 0.5).ceil() as isize + 1).clamp(0, surface.n as isize - 1) as usize;
    let (a, b, c, d) = (lo(x0), lo(y0), hi(x1), hi(y1));
    let mut heights = vec![];
    for y in b..=d {
        for x in a..=c {
            heights.push(surface.height[y * surface.n + x]);
        }
    }
    json!({"origin":{"x":(a as f64+0.5)*step,"y":(b as f64+0.5)*step},"step_m":step,
        "width":c-a+1,"height":d-b+1,"elevations_m":heights})
}
/// Actual shared cadastral segments, only where the cultural recipe permits party walls.
fn shared_boundaries(a: &super::Shape, b: &super::Shape) -> Vec<[Point; 2]> {
    let mut out = vec![];
    for (&u, &v) in a
        .outer
        .iter()
        .zip(a.outer.iter().cycle().skip(1))
        .take(a.outer.len())
    {
        let length = (v.x - u.x).hypot(v.y - u.y);
        if length < 0.01 {
            continue;
        }
        let (dx, dy) = ((v.x - u.x) / length, (v.y - u.y) / length);
        for (&p, &q) in b
            .outer
            .iter()
            .zip(b.outer.iter().cycle().skip(1))
            .take(b.outer.len())
        {
            let side = |p: Point| ((p.x - u.x) * dy - (p.y - u.y) * dx).abs();
            if side(p) > 0.02 || side(q) > 0.02 {
                continue;
            }
            let t = |p: Point| (p.x - u.x) * dx + (p.y - u.y) * dy;
            let lo = t(p).min(t(q)).max(0.0);
            let hi = t(p).max(t(q)).min(length);
            if hi - lo > 0.1 {
                out.push([
                    Point {
                        x: u.x + lo * dx,
                        y: u.y + lo * dy,
                    },
                    Point {
                        x: u.x + hi * dx,
                        y: u.y + hi * dy,
                    },
                ]);
            }
        }
    }
    out
}
/// Discrete native levels from the applied cultural/function profile. The actual
/// recipe range remains authoritative; no height truncation occurs after placement.
fn typical_floors(
    culture: &super::culture::CultureMapping,
    function: &str,
    population: u32,
    pressure: f64,
) -> u32 {
    let desired = if function == "collective"
        || (matches!(function, "domestic" | "mixed")
            && culture.functional_profile != "communal"
            && population >= 1000
            && pressure > 0.6)
    {
        2
    } else {
        1
    };
    desired.clamp(
        culture.admissibility.floors[0],
        culture.admissibility.floors[1],
    )
}
#[path = "feasibility.rs"]
mod feasibility;
use feasibility::Witness as NativeProfile;

/// `URBAN_FEASIBILITY=probe` (measurement only) writes the direct native
/// poses of every eligible witness, whatever houses' wealth and built-target
/// gates, under `native_minimum_probe`, which houses ignores.
fn feasibility_probe() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_FEASIBILITY").is_ok_and(|v| v == "probe"))
}
fn wish_of(floors: &Value) -> Option<[u32; 2]> {
    let a = floors.as_array()?;
    Some([a.first()?.as_u64()? as u32, a.get(1)?.as_u64()? as u32])
}
/// `URBAN_FEASIBILITY=round6` keeps Round 6 F's feasibility without the
/// Round 7 J additions (programme typology, functional-choice targets,
/// facility deficits and reservations, native footing), for A/B measurement.
pub(super) fn round7() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_FEASIBILITY").map_or(true, |v| v != "round6"))
}
/// `URBAN_FEASIBILITY=off` restores the former requests (A/B measurement).
fn feasibility_enabled() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_FEASIBILITY").map_or(true, |v| v != "off"))
}
/// Native court layouts: a collective body wraps a court only on a lot that
/// holds one of these (atrium, peristyle, court house, siheyuan, tulou ring).
fn court_layout(p: &NativeProfile) -> bool {
    matches!(
        p.layout.as_str(),
        "courtyard" | "atrium" | "peristyle" | "siheyuan" | "ring"
    )
}
/// A tall collective native recipe: three floors or more in a row (strip) or
/// court layout. A `single` tower (casa-torre, Svan or Yemeni tower house) is
/// one household's tower, not a tenement.
fn tall_collective(p: &NativeProfile) -> bool {
    p.floors[1] >= 3 && (p.layout == "strip" || court_layout(p))
}
/// Floors wished for a collective dwelling (`dwelling.tenement`): among the
/// levels (3 to 5) that the admissible tall native witnesses actually offer on
/// this lot, rising with pressure; `None` when no such witness fits.
fn collective_floors(fits: &[&NativeProfile], pressure: f64) -> Option<[u32; 2]> {
    let mut levels: Vec<u32> = fits
        .iter()
        .flat_map(|p| p.floors[0].max(3)..=p.floors[1].min(5))
        .collect();
    levels.sort_unstable();
    levels.dedup();
    let (&lo, n) = (levels.first()?, levels.len());
    let pick = levels[((n - 1) as f64 * pressure.clamp(0.0, 1.0)).round() as usize];
    Some([lo, pick])
}
/// Optional district role/wealth per quarter, read through serde so the stage
/// works with and without the roles contract (`structure.districts[i].role`).
fn district_programmes(layout: &Layout) -> BTreeMap<usize, (String, Option<f64>)> {
    let mut out = BTreeMap::new();
    for district in layout.structure.iter().flat_map(|s| &s.districts) {
        let value = serde_json::to_value(district).unwrap_or(Value::Null);
        let role = value["role"].as_str().unwrap_or("").to_owned();
        let wealth = value["wealth"].as_f64();
        for &q in &district.quarters {
            out.insert(q, (role.clone(), wealth));
        }
    }
    out
}
/// Default building role when the programme stage did not assign one.
fn default_role(function: &str) -> &'static str {
    match function {
        "domestic" => "dwelling",
        "mixed" => "commerce.shop",
        "workshop" => "craft.workshop",
        "warehouse" => "commerce.warehouse",
        "collective" => "civic",
        "market" => "commerce.market",
        "common" => "open.common",
        _ => "dwelling",
    }
}
/// `programme` of a request: allocation role/landmark when present, the
/// district role and wealth of its quarter, else wealth from occupation pressure.
fn programme_of(
    allocation: &super::programme::Allocation,
    parcel: &Parcel,
    layout: &Layout,
    districts: &BTreeMap<usize, (String, Option<f64>)>,
) -> Value {
    let value = serde_json::to_value(allocation).unwrap_or(Value::Null);
    let role = value["role"]
        .as_str()
        .filter(|r| !r.is_empty())
        .unwrap_or(default_role(&allocation.function));
    let landmark = value["landmark"].as_bool().unwrap_or(false);
    let district = layout
        .blocks
        .get(parcel.block)
        .and_then(|b| districts.get(&b.quarter));
    let wealth = district
        .and_then(|d| d.1)
        .unwrap_or(parcel.pressure)
        .clamp(0.0, 1.0);
    // Empty buildings are flagged: a ruin previews broken walls, an abandoned
    // building keeps its masses.
    let state = if role.ends_with(".ruin") {
        Some("ruin")
    } else if role.ends_with(".abandoned") {
        Some("abandoned")
    } else {
        None
    };
    let mut programme = json!({"role":role,"district_role":district.map_or("", |d| d.0.as_str()),
        "wealth":wealth,"landmark":landmark});
    // Households the city allocates to this plot (compounds and tenements hold
    // several). Descriptive metadata for the houses side, not a certified capacity:
    // it does not size the bodies yet (CODEX_JAVANESE_HOUSES.md).
    if allocation.households > 0.0 && allocation.households.is_finite() {
        programme["households"] = json!((allocation.households * 100.0).round() / 100.0);
    }
    if let Some(state) = state {
        programme["state"] = json!(state);
    }
    programme
}
/// Wished architectural composition, from the programme role first, then the
/// occupation kind the city chose for the lot.
fn composition_of(role: &str, kind: Option<super::parcels::OccupationKind>) -> &'static str {
    use super::parcels::OccupationKind as K;
    let family = role.split('.').next().unwrap_or("");
    match (family, role) {
        ("worship", _) => "religious",
        ("civic", _) => "civic",
        ("defence", _) => "defence",
        (_, r) if r.starts_with("commerce.inn") || r.starts_with("commerce.caravanserai") => "inn",
        (_, r) if r.starts_with("dwelling.farm") => "farm",
        ("storage", _) => "hall",
        (_, r) if r.starts_with("commerce.market") || r.starts_with("commerce.hall") => "hall",
        _ => match kind {
            Some(K::Row) => "row",
            Some(K::Court | K::Hanok | K::Yashiki) => "courtyard",
            // Only reached for an empty preview: the wished block-front body.
            Some(K::Insula) => "row",
            Some(K::Farm) => "farm",
            Some(K::Pavilions | K::Round | K::Long) => "compound",
            Some(K::Hall | K::Warehouse) => "hall",
            Some(K::Detached | K::Open) | None => "detached",
        },
    }
}
/// Street-wall continuity wished for a composition (1 = full street front).
fn frontage_continuity(composition: &str) -> f64 {
    match composition {
        "row" => 1.0,
        "courtyard" | "civic" | "inn" => 0.85,
        "hall" | "religious" => 0.6,
        "compound" => 0.5,
        "detached" => 0.3,
        "farm" | "defence" => 0.2,
        _ => 0.0,
    }
}
/// Why no native source houses may draw can occupy this lot, when the city
/// can show it for every one of them (certified or not): `forme` when none
/// has a pose inside the lot at its nominal minima; `pente` when the
/// foundation step of every pose that fits exceeds the limit
/// (`feasibility::pose_lower_bound`, which stops at the first foundable
/// pose, so a level lot costs one pose). Otherwise houses judges the plan.
fn lot_deficit(
    drawable: &[&NativeProfile],
    surface: Surface<'_>,
    lot: &super::Shape,
    dirs: &[super::Point],
    gradient: [f64; 2],
) -> Option<&'static str> {
    if drawable.is_empty() || dirs.is_empty() || !drawable.iter().all(|w| w.ground) {
        return None;
    }
    let limit = feasibility::MAX_FOUNDATION_STEP + 0.02;
    // Round 6 only proved lots whose centre gradient was visibly steep.
    let narrow = drawable
        .iter()
        .filter_map(|w| w.nominal)
        .map(|n| n[0].min(n[1]))
        .fold(f64::INFINITY, f64::min);
    if !round7() && gradient[0].hypot(gradient[1]) * narrow <= feasibility::MAX_FOUNDATION_STEP {
        return drawable
            .iter()
            .all(|w| {
                !feasibility::pose_lower_bound(surface, lot, dirs, w, f64::INFINITY).is_finite()
            })
            .then_some("forme");
    }
    let mut placeable = false;
    for w in drawable {
        let bound = feasibility::pose_lower_bound(surface, lot, dirs, w, limit);
        if bound <= limit {
            return None;
        }
        placeable |= bound.is_finite();
    }
    Some(if placeable { "pente" } else { "forme" })
}
/// Whether a block can found at least one source of this pinned recipe at a
/// pose along one of its street contacts (`dirs`): the reservation test of a
/// facility before subdivision, the same lower bound as the lot deficit (so
/// a block is refused exactly when its lot would be a proven deficit, never
/// when the recipe could stand on it). Unknown sources
/// (no nominal minima, posts or piers) count as foundable.
pub(super) fn recipe_foundable(
    surface: Surface<'_>,
    shape: &super::Shape,
    dirs: &[super::Point],
    recipe: &str,
) -> bool {
    let sources = feasibility::recipe_sources(recipe);
    if sources.is_empty() || dirs.is_empty() || !sources.iter().all(|w| w.ground) {
        return true;
    }
    let limit = feasibility::MAX_FOUNDATION_STEP + 0.02;
    sources
        .iter()
        .any(|w| feasibility::pose_lower_bound(surface, shape, dirs, w, limit) <= limit)
}
fn deficit_message(cause: &str) -> &'static str {
    match cause {
        "pente" => {
            "Déficit urbain : pente trop forte pour l'assise de tout bâtiment natif admissible (marche > 0,75 m) ; lot laissé ouvert."
        }
        _ => {
            "Déficit urbain : aucun bâtiment natif admissible ne tient sur ce lot ; lot laissé ouvert."
        }
    }
}
/// The urban-deficit warning of a set of site requests (counts by cause and
/// households not lodged), in French, or `None` when every lot is buildable.
pub fn deficit_warning(requests: &[Value]) -> Option<String> {
    let (mut shape, mut slope, mut households) = (0usize, 0usize, 0.0f64);
    for r in requests {
        let d = &r["programme"]["deficit"];
        match d["cause"].as_str() {
            Some("pente") => slope += 1,
            Some(_) => shape += 1,
            None => continue,
        }
        households += d["households"].as_f64().unwrap_or(0.0);
    }
    (shape + slope > 0).then(|| {
        format!(
            "Déficit urbain : {} lot(s) sans bâtiment natif admissible ({} par la pente, {} par la forme) ; {:.1} ménage(s) non logé(s), aucun remplacement par un bâtiment plus petit.",
            shape + slope,
            slope,
            shape,
            households
        )
    })
}
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
    /// Minimum array budget for the next individual site when it did not fit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_bytes: Option<usize>,
}

struct LayoutIndex {
    layout: usize,
    frontages: super::parcels::FrontageIndex,
    districts: BTreeMap<usize, (String, Option<f64>)>,
}
struct PartitionIndex {
    partition: usize,
    layout: usize,
    adjacent: Vec<Vec<usize>>,
    // Numeric block/culture slots are prepared once; morphology is resolved
    // only when a page first requests a site from that slot.
    tissues: Vec<std::sync::OnceLock<Option<(String, super::Morph)>>>,
}
struct SiteIndex {
    partition: usize,
    allocation: usize,
    parcel: usize,
    tissue: usize,
}

/// Numeric references and small context caches into immutable retained inputs.
/// No cadastral geometry, terrain patch, preview or request payload is cloned at
/// preparation. The caller must retain the same layouts/partitions until done.
/// No generated payload is retained between page calls, including failed budgets.
pub struct BuildingSiteIndex {
    layouts: Vec<LayoutIndex>,
    partitions: Vec<PartitionIndex>,
    sites: Vec<SiteIndex>,
    #[cfg(test)]
    generated: std::cell::Cell<usize>,
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
            generated: std::cell::Cell::new(0),
        };
        let mut layout_indices = BTreeMap::new();
        let mut selected = std::collections::BTreeSet::new();
        for &partition_id in selected_partition_indices {
            if !selected.insert(partition_id) {
                return Err("Duplicate selected architecture partition".into());
            }
            let partition = partitions
                .get(partition_id)
                .ok_or("Selected architecture partition missing")?;
            // Match the first layout just like the original collect path.
            let layout_id = layouts
                .iter()
                .position(|l| l.key == partition.key)
                .ok_or("Missing layout for architecture sites")?;
            let Some(pr) = &partition.programme else {
                continue;
            };
            let layout = &layouts[layout_id];
            let layout_slot = *layout_indices.entry(layout_id).or_insert_with(|| {
                let slot = index.layouts.len();
                index.layouts.push(LayoutIndex {
                    layout: layout_id,
                    frontages: super::parcels::FrontageIndex::new(layout),
                    districts: district_programmes(layout),
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
            required_bytes: None,
        };
        let mut bytes = 2; // JSON array brackets.
        for i in offset..offset.saturating_add(limit).min(self.total()) {
            let request = self.request_one(
                i,
                seed,
                layouts,
                partitions,
                surface,
                water_level,
                architecture_culture,
            )?;
            let size = json_bytes(&request)?;
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
            page.next = i + 1;
        }
        Ok(page)
    }

    #[allow(clippy::too_many_arguments)]
    fn request_one(
        &self,
        i: usize,
        seed: &str,
        layouts: &[Layout],
        partitions: &[Partition],
        surface: Surface<'_>,
        water_level: &[f32],
        architecture_culture: Option<&str>,
    ) -> Result<Value, String> {
        #[cfg(test)]
        self.generated.set(self.generated.get() + 1);
        let site = &self.sites[i];
        let partition_index = &self.partitions[site.partition];
        let layout_index = &self.layouts[partition_index.layout];
        let layout = layouts
            .get(layout_index.layout)
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
        let building_culture = architecture_culture
            .filter(|c| !c.is_empty() && *c != "site")
            .unwrap_or(&allocation.culture);
        let mut culture =
            super::culture::parcel_mapping(layout, parcel, building_culture, &allocation.function)
                .ok_or("No contextual native recipe")?;
        // Lots admitted by the pack's compact house (courtyard cultures)
        // request that recipe, never the court house they cannot hold.
        if let Some(small) = super::parcels::compact_fallback(
            &culture.architecture_pack,
            &pr.context.period,
            &culture.admissibility,
        ) {
            let fits = |a: &super::culture::UrbanAdmissibility| {
                parcel
                    .envelope
                    .as_ref()
                    .is_some_and(|e| super::parcels::witnessed_by(e, a))
            };
            if !fits(&culture.admissibility)
                && (fits(&small)
                    || super::parcels::parcel_envelope(
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
        let lot = super::Shape {
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
        let delta = (surface.width / surface.n as f64).max(0.5);
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
        let mode = match pr.context.mode.as_str() {
            "strict" => "historical_strict",
            "fantasy" => "fantasy_mix",
            _ => "historical_inspired",
        };
        let function = match allocation.function.as_str() {
            "market" | "common" => "open_space",
            f => f,
        };
        let grid = ground_patch(surface, &parcel.shape);
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
        let tissue = partition_index.tissues[site.tissue].get_or_init(|| {
            super::culture::parcel_morph(layout, partition, &allocation.culture, parcel.block)
                .map(|(zone, morph)| (zone.to_owned(), morph))
        });
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
            (lo + ((hi.saturating_sub(lo)) as f64 * parcel.pressure).round() as u32).clamp(
                culture.admissibility.floors[0],
                culture.admissibility.floors[1],
            )
        });
        // The stored cadastral witness is reused when it has this recipe's
        // dimensions; the search only reruns for a different admission.
        let reusable = parcel
            .envelope
            .as_ref()
            .filter(|e| super::parcels::witnessed_by(e, &culture.admissibility));
        let hint = reusable.cloned().or_else(|| {
            super::parcels::parcel_envelope(
                parcel,
                culture.admissibility.min_frontage,
                culture.admissibility.min_depth,
                culture.admissibility.min_access_width,
            )
        });
        let programme = programme_of(allocation, parcel, layout, &layout_index.districts);
        let wealth = programme["wealth"].as_f64().unwrap_or(0.5);
        let site_seed = super::edits::building_seed(seed, &parcel.id, partition); // edits hook (urban/edits.rs): lot salt
        let role = programme["role"].as_str().unwrap_or("").to_string();
        let functional = super::culture::functional_programme(
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
            .map(|(zone, morph)| super::parcels::Occupancy {
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
        let (parts, realized) = occupancy.as_ref().map_or((Vec::new(), None), |o| {
            super::parcels::occupation_preview(parcel, o)
        });
        let kind = realized.or_else(|| occupancy.as_ref().map(super::parcels::occupation_kind));
        let preview: Vec<_> = parts.iter().map(|(s, _)| s).collect();
        let preview_parts: Vec<_> = parts.iter().map(|(_, l)| *l).collect();
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
        if let Some(range) = floors_range {
            programme["floors"] = json!(range);
        }
        // The programme houses' shortlist reads (composition, then floors) is
        // chosen so that the sources it is certain to draw are ones the lot
        // holds: the wished composition unless another one of the culture
        // brings more of them; floors among the levels those witnesses offer
        // (the insula levels already come from its witnesses).
        let wished = composition;
        // The typology follows the programme: the composition is the one whose
        // first shortlist group draws a source of the programme's own role
        // (Roman shop → dwelling over a shop, house → masonry house, tenement
        // → street block), among the sources the lot holds (`asked`).
        let composition = if feasible { asked(composition) } else { composition };
        programme["composition"] = json!(composition);
        // The street wall stays the urban intent of the wished form.
        programme["frontage_continuity"] = json!(frontage_continuity(wished));
        if feasible
            && tall.is_none()
            && !fits.is_empty()
            && let Some(wish) = wish
        {
            programme["floors"] = json!(feasibility::feasible_floors(wish, composition, fits));
        }
        let built: f64 = parts.iter().map(|(s, _)| super::geometry::area(s)).sum();
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
        // Urban deficit: a lot no admissible native house can occupy is not
        // sent to houses to be drawn and refused, and no smaller house stands
        // for its programme: it stays open land and its households are stated.
        let accesses = access_segments(layout, parcel, &layout_index.frontages);
        // Houses poses its sources along a declared access or the hint edge.
        let direction = |a: super::Point, b: super::Point| {
            let l = (b.x - a.x).hypot(b.y - a.y);
            (l > 0.1).then(|| super::Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            })
        };
        let point = |v: &Value| {
            Some(super::Point {
                x: v["x"].as_f64()?,
                y: v["y"].as_f64()?,
            })
        };
        let dirs: Vec<super::Point> = accesses
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
            && super::culture::functional_choice_registered(
                building_culture,
                &culture.architecture_pack,
                &role,
                &allocation.function,
                composition,
                mode,
            );
        let admission_recipe = functional.map(|p| p.recipe_id.as_str()).or_else(|| {
            (!domestic && !registered).then_some(culture.admissibility.recipe_id.as_str())
        });
        // A registered functional envelope draws only its declared simple
        // sources: the built target stays inside the body-area range their
        // nominal dimensions span (the rest of the lot is its yard), never a
        // footprint no declared source can take.
        let choice_sources = registered
            .then(|| {
                super::culture::functional_choice_sources(
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
        let drawable: Vec<&NativeProfile> = if !feasibility_enabled() || function == "open_space" {
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
        let deficit = lot_deficit(&drawable, surface, &parcel.shape, &dirs, gradient);
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
                "floors":if domestic || functional.is_some() || registered {None} else {Some(floors)},"bodies":null,"courtyard_ratio":null,"overhang_m":null,"roof_pitch_deg":null,"site_slope_deg":null}});
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
        let mut request = json!({"id":format!("{}/building",parcel.id),"parcel_id":parcel.id,
            "placement_hint":hint.as_ref().map(|shape|vec![shape]),
            "preview":preview,"preview_parts":preview_parts,"programme":programme,
            "occupation":occupation,"feasibility":feasibility,
            "cadastral":[lot],"buildable":[lot],"reserves":lot.holes.iter().map(|hole|json!({"outer":hole,"holes":[]})).collect::<Vec<_>>(),"roof_domain":[lot],
            "accesses":accesses,"party_boundaries":party_boundaries,"neighbors":[],
            "culture":{"culture":building_culture,"pack":culture.architecture_pack,"mode":mode,
                "borrowing":if culture.borrowing.is_empty(){None}else{Some(&culture.borrowing)}},
            "function":function,"seed":site_seed,"config":config,
            "terrain":{"grid":grid,"origin":center,"ground_z_m":ground,"gradient":gradient,"water_z_m":water,"max_foundation_step_m":0.75}});
        if !candidates.is_empty() {
            request[if probe {
                "native_minimum_probe"
            } else {
                "native_minimum_candidates"
            }] = json!(candidates);
        }
        Ok(request)
    }
}

/// Count UTF-8 JSON bytes without allocating a second serialized payload.
fn json_bytes(value: &Value) -> Result<usize, String> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, value).map_err(|e| e.to_string())?;
    Ok(counter.0)
}

/// Existing collect API uses the same per-site generator and original ordering.
pub fn requests(
    seed: &str,
    layouts: &[Layout],
    partitions: &[Partition],
    surface: Surface<'_>,
    water_level: &[f32],
    architecture_culture: Option<&str>,
) -> Result<Vec<Value>, String> {
    let selected: Vec<_> = (0..partitions.len()).collect();
    let index = BuildingSiteIndex::prepare(layouts, partitions, &selected)?;
    (0..index.total())
        .map(|i| {
            index.request_one(
                i,
                seed,
                layouts,
                partitions,
                surface,
                water_level,
                architecture_culture,
            )
        })
        .collect()
}

fn ring_area(ring: &[Point]) -> f64 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        .abs()
        * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_fits(
        pack: &str,
        culture: &str,
        period: &str,
        strict: bool,
        parcel: &Parcel,
        keep: fn(&NativeProfile) -> bool,
    ) -> Vec<&'static NativeProfile> {
        let admissible = feasibility::admissible(pack, culture, period, strict);
        feasibility::lot_fit(parcel, &admissible)
            .fits
            .into_iter()
            .filter(|w| keep(w))
            .collect()
    }

    fn paging_fixture() -> (Vec<Layout>, Vec<Partition>) {
        let shape = |x: f64, y: f64, w: f64, d: f64| {
            json!({
                "outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],
                "holes":[]
            })
        };
        let culture = super::super::culture::mapping("european-organic").unwrap();
        let mut layouts = Vec::new();
        let mut partitions = Vec::new();
        for (k, count) in [("démo-a", 10), ("démo-b", 4)] {
            let y = if k == "démo-a" { 101. } else { 201. };
            let mut parcels = Vec::new();
            let mut allocations = Vec::new();
            let mut adjacency = Vec::new();
            for i in 0..count {
                let id = format!("{k}/lot-{i}");
                let lot = shape(20. + i as f64 * 12., y, 12., 26.);
                parcels.push(json!({"id":id,"shape":lot,"block":0,"use":"domestic",
                    "front":null,"axis":{"x":1.,"y":0.},"rank":0,"pressure":0.85,"family":"frontage"}));
                let function = if i == 3 {
                    "market"
                } else if i == 4 {
                    "mixed"
                } else {
                    "domestic"
                };
                allocations.push(json!({"parcelId":id,"demandId":"demand","function":function,
                    "culture":"european-organic","architecturePack":"EUR-MED","capacity":1.,
                    "unit":"domesticUnits","score":1.,"reasons":[],
                    "role":if i==2 { "open.garden" } else if i==3 { "commerce.market" } else { "dwelling" }}));
                if i > 0 {
                    adjacency
                        .push(json!({"a":format!("{k}/lot-{}",i-1),"b":id,"sharedLength":26.}));
                }
            }
            let programme = json!({"version":1,"population":2500,"context":{},"cultures":[culture],
                "demands":[],"reservations":[],"allocations":allocations,"adjacency":adjacency,
                "environment":[],"reconciliationPasses":0,"warnings":[]});
            let layout: Layout = serde_json::from_value(json!({"key":k,"culture":"european-organic",
                "config":{},"programme":programme,"center":{"x":70.,"y":y+13.},
                "quarters":[{"shape":shape(20.,y,120.,26.),"phase":0,"zone":"core"}],
                "streets":[{"path":[{"x":0.,"y":y-1.},{"x":160.,"y":y-1.}],"widths":[2.,2.],"rank":0,"role":"local"}],
                "blocks":[{"shape":shape(20.,y,120.,26.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
                "warnings":[],"structure":{"districts":[
                    {"id":0,"center":0,"phase":0,"tissue":"organic","quarters":[0],"role":"commoner","wealth":0.2},
                    {"id":1,"center":0,"phase":0,"tissue":"grid","quarters":[0],"role":"elite","wealth":0.9}
                ]}})).unwrap();
            layouts.push(layout);
            partitions.push(
                serde_json::from_value(json!({"key":k,"config":{},"parcels":parcels,
                "programme":programme,"warnings":[]}))
                .unwrap(),
            );
        }
        (layouts, partitions)
    }

    #[test]
    fn pages_match_collect_and_only_build_requested_sites_with_exact_byte_budgets() {
        let (layouts, partitions) = paging_fixture();
        let heights = vec![20.; 16 * 16];
        let water = vec![0; heights.len()];
        let surface = Surface {
            geometry: None,
            width: 512.,
            n: 16,
            height: &heights,
            water: &water,
        };
        let seed = "paged-sites";
        let collected = requests(seed, &layouts, &partitions, surface, &heights, None).unwrap();
        assert_eq!(
            collected.len(),
            12,
            "gardens omitted; open markets retained"
        );
        assert!(collected.iter().any(|r| r["function"] == "open_space"));
        assert!(collected.iter().any(|r| {
            r["party_boundaries"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
        }));
        let first = &collected[0];
        assert_eq!(first["id"], "démo-a/lot-0/building");
        assert_eq!(first["seed"], "paged-sites/démo-a/lot-0");
        assert_eq!(
            first["programme"]["district_role"], "elite",
            "last district metadata still wins"
        );
        assert_eq!(first["programme"]["wealth"], 0.9);
        assert!(first["programme"]["floors"].is_array());
        assert!(first["config"]["overrides"]["floors"].is_null());
        assert!(first["programme"]["composition"].is_string());
        assert!(
            !first["accesses"].as_array().unwrap().is_empty(),
            "fallback frontage exercised"
        );
        assert!(
            !first["terrain"]["grid"]["elevations_m"]
                .as_array()
                .unwrap()
                .is_empty()
        );

        for limit in [1, 7, 64] {
            let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0, 1]).unwrap();
            assert_eq!(index.generated.get(), 0, "opening must not build payloads");
            assert!(
                index
                    .partitions
                    .iter()
                    .flat_map(|p| &p.tissues)
                    .all(|t| t.get().is_none()),
                "unrequested block/culture morphologies remain lazy"
            );
            assert_eq!(index.total(), collected.len());
            let mut actual = Vec::new();
            while actual.len() < index.total() {
                let offset = actual.len();
                let page = index
                    .page(
                        seed,
                        &layouts,
                        &partitions,
                        surface,
                        &heights,
                        None,
                        offset,
                        limit,
                        MAX_SITE_PAGE_BYTES,
                    )
                    .unwrap();
                assert_eq!(page.offset, offset);
                assert_eq!(page.next, offset + page.requests.len());
                assert_eq!(page.total, collected.len());
                assert!(page.required_bytes.is_none());
                actual.extend(page.requests);
                assert_eq!(
                    index.generated.get(),
                    actual.len(),
                    "no lookahead beyond requested count"
                );
            }
            assert_eq!(
                serde_json::to_vec(&actual).unwrap(),
                serde_json::to_vec(&collected).unwrap()
            );
        }

        let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0, 1]).unwrap();
        let first_bytes = serde_json::to_vec(&vec![first]).unwrap().len();
        assert_eq!(
            first_bytes,
            json_bytes(first).unwrap() + 2,
            "UTF-8 and array framing counted exactly"
        );
        let empty = index
            .page(
                seed,
                &layouts,
                &partitions,
                surface,
                &heights,
                None,
                0,
                7,
                first_bytes - 1,
            )
            .unwrap();
        assert!(empty.requests.is_empty());
        assert_eq!(
            (empty.offset, empty.next, empty.required_bytes),
            (0, 0, Some(first_bytes))
        );
        assert_eq!(
            index.generated.get(),
            1,
            "no payload after the first unconsumed site"
        );
        let partial = index
            .page(
                seed,
                &layouts,
                &partitions,
                surface,
                &heights,
                None,
                0,
                7,
                first_bytes,
            )
            .unwrap();
        assert_eq!(partial.requests, vec![first.clone()]);
        assert_eq!(partial.next, 1);
        assert_eq!(
            partial.required_bytes,
            Some(json_bytes(&collected[1]).unwrap() + 2)
        );
        let replay = index
            .page(
                seed,
                &layouts,
                &partitions,
                surface,
                &heights,
                None,
                0,
                7,
                first_bytes,
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(&partial).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
        let end = index
            .page(
                seed,
                &layouts,
                &partitions,
                surface,
                &heights,
                None,
                index.total(),
                64,
                2,
            )
            .unwrap();
        assert!(end.requests.is_empty());
        assert_eq!(end.next, index.total());
        assert!(end.required_bytes.is_none());

        let mut selected = BuildingSiteIndex::prepare(&layouts, &partitions, &[1]).unwrap();
        let page = selected
            .page(
                seed,
                &layouts,
                &partitions,
                surface,
                &heights,
                None,
                0,
                64,
                MAX_SITE_PAGE_BYTES,
            )
            .unwrap();
        assert_eq!(page.requests, collected[9..]);
        let changed = selected
            .page(
                "new-seed",
                &layouts,
                &partitions,
                surface,
                &heights,
                Some("bastide"),
                0,
                1,
                MAX_SITE_PAGE_BYTES,
            )
            .unwrap();
        assert_eq!(changed.requests[0]["seed"], "new-seed/démo-b/lot-0");
        assert_eq!(
            changed.requests[0]["culture"]["culture"], "bastide",
            "no candidate cache crosses query bindings"
        );

        let mut invalid = partitions.clone();
        invalid[1].programme.as_mut().unwrap().allocations[3].parcel_id = "missing".into();
        assert!(BuildingSiteIndex::prepare(&layouts, &invalid, &[0, 1]).is_err());
        invalid = partitions.clone();
        invalid[1].programme.as_mut().unwrap().allocations[3].culture = "missing".into();
        assert!(BuildingSiteIndex::prepare(&layouts, &invalid, &[0, 1]).is_err());
    }

    #[test]
    fn village_levels_use_a_real_low_native_recipe() {
        let culture = super::super::culture::mapping("halfling").unwrap();
        assert!(culture.admissibility.floors[0] <= 2);
        assert_ne!(culture.admissibility.recipe_id, "EUR-MED-B08");
        assert_eq!(typical_floors(&culture, "domestic", 200, 1.0), 1);
        let town = super::super::culture::mapping("european-organic").unwrap();
        assert_eq!(typical_floors(&town, "mixed", 2500, 0.9), 2);
        assert_eq!(typical_floors(&town, "workshop", 2500, 0.9), 1);
    }

    /// Role before tissue (CODEX_ROMAN_COURTYARD_REVIEW.md): in a roman-core
    /// core block (domus tissue), a tenement lot holding the pack's insula
    /// asks three floors or more, a shop fronts its street as a row, and a
    /// domus keeps its court in the preview and the composition alike.
    #[test]
    fn small_roman_lot_offers_the_insula_variants_that_fit_it() {
        // 9 × 14 m: too small for the B04 court insula (34 × 38 m), large
        // enough for the B13 strip witnesses (6.65 × 10.2 m + 0.6 m).
        let parcel: Parcel = serde_json::from_value(json!({"id":"small","block":0,"use":"plot",
            "shape":{"outer":[{"x":0.,"y":0.},{"x":9.,"y":0.},{"x":9.,"y":14.},{"x":0.,"y":14.}],"holes":[]},
            "front":[{"x":0.,"y":0.},{"x":9.,"y":0.}],"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.5,
            "family":"frontage","contacts":[{"a":{"x":0.,"y":0.},"b":{"x":9.,"y":0.},"street":0,"rank":1,"length":9.,"kind":"public"}]}))
        .unwrap();
        let fits = native_fits(
            "MED-ANT",
            "roman-core",
            "A",
            false,
            &parcel,
            tall_collective,
        );
        assert!(!fits.is_empty() && fits.iter().all(|p| p.recipe_id == "MED-ANT-B13"));
        // Levels come from the variants, by pressure; never 5 from B13.
        assert_eq!(collective_floors(&fits, 0.0), Some([3, 3]));
        assert_eq!(collective_floors(&fits, 1.0), Some([3, 4]));
        // Strict mode never takes an inspired-only source.
        let strict = native_fits("MED-ANT", "roman-core", "A", true, &parcel, tall_collective);
        assert!(collective_floors(&strict, 1.0).is_none());
    }
    #[test]
    fn roman_core_roles_choose_insula_shop_and_domus() {
        let y = 100.;
        let shape = |x: f64, w: f64, d: f64| json!({"outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],"holes":[]});
        let culture = super::super::culture::mapping("roman-core").unwrap();
        let lots = [
            ("tenement", 0., 40., 44., "domestic", "dwelling.tenement"),
            ("shop", 40., 8., 26., "mixed", "dwelling.shop"),
            ("domus", 48., 30., 32., "domestic", "dwelling.courtyard"),
            (
                "small-domus",
                78.,
                20.,
                30.,
                "domestic",
                "dwelling.courtyard",
            ),
        ];
        let (mut parcels, mut allocations) = (vec![], vec![]);
        for (id, x, w, d, function, role) in lots {
            let front = json!([{"x":x,"y":y},{"x":x+w,"y":y}]);
            parcels.push(json!({"id":id,"shape":shape(x, w, d),"block":0,"use":"plot",
                "front":front,"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.9,"family":"frontage",
                "contacts":[{"a":{"x":x,"y":y},"b":{"x":x+w,"y":y},"street":0,"rank":1,"length":w,"kind":"public"}]}));
            allocations.push(
                json!({"parcelId":id,"demandId":"demand","function":function,
                "culture":"roman-core","architecturePack":"MED-ANT","capacity":1.,
                "unit":"domesticUnits","score":1.,"reasons":[],"role":role}),
            );
        }
        let programme = json!({"version":1,"population":5000,"context":{},"cultures":[culture],
            "demands":[],"reservations":[],"allocations":allocations,"adjacency":[],
            "environment":[],"reconciliationPasses":0,"warnings":[]});
        let layout: Layout = serde_json::from_value(json!({"key":"rome","culture":"roman-core",
            "config":{},"programme":programme,"center":{"x":37.,"y":y+22.},
            "quarters":[{"shape":shape(0.,98.,44.),"phase":0,"zone":"core"}],
            "streets":[{"path":[{"x":-10.,"y":y-1.},{"x":90.,"y":y-1.}],"widths":[2.,2.],"rank":1,"role":"local"}],
            "blocks":[{"shape":shape(0.,98.,44.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
            "warnings":[]}))
        .unwrap();
        let partition: Partition = serde_json::from_value(json!({"key":"rome","config":{},
            "parcels":parcels,"programme":programme,"warnings":[]}))
        .unwrap();
        let heights = vec![20.; 16 * 16];
        let water = vec![0; heights.len()];
        let surface = Surface {
            geometry: None,
            width: 512.,
            n: 16,
            height: &heights,
            water: &water,
        };
        let sites = requests("rome", &[layout], &[partition], surface, &heights, None).unwrap();
        let site = |id: &str| {
            sites
                .iter()
                .find(|r| r["parcel_id"] == id)
                .unwrap_or_else(|| panic!("{id} site"))
        };
        let holes = |r: &Value| {
            r["preview"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["holes"].as_array().map_or(0, Vec::len))
                .sum::<usize>()
        };
        let tenement = site("tenement");
        assert!(
            tenement["programme"]["floors"][0].as_u64().unwrap() >= 3,
            "{}",
            tenement["programme"]
        );
        // The lot holds the pack's court insula: an Ostia-style court.
        assert_eq!(tenement["programme"]["composition"], "courtyard");
        assert!(holes(tenement) >= 1);
        let shop = site("shop");
        assert_eq!(
            shop["programme"]["frontage_continuity"], 1.0,
            "{}",
            shop["programme"]
        );
        assert_eq!(holes(shop), 0);
        let street_wall = shop["preview"][0]["outer"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["y"].as_f64().unwrap())
            .fold(f64::INFINITY, f64::min);
        assert!(
            street_wall < y + 0.5,
            "the shop fronts its street: {street_wall}"
        );
        let domus = site("domus");
        assert_eq!(domus["programme"]["composition"], "courtyard");
        assert!(holes(domus) >= 1, "a domus keeps its court");
        // 20 × 30 m holds no native Roman court house (B02 needs 28.1 m):
        // the programme asks what the lot holds, never a court houses refuses.
        let small = site("small-domus");
        assert_ne!(small["programme"]["composition"], "courtyard");
    }

    /// Invariant: a direct native pose is only proposed on a lot its witness
    /// fits — the whole site bounds inside the lot, the door facing the
    /// declared access, the contact on that access, the body founded within
    /// the limit — and never on a lot too narrow or too steep for it.
    #[test]
    fn native_candidates_only_on_lots_their_witness_fits() {
        let (x, y) = (100.0, 100.0);
        let lot = |w: f64, d: f64| super::super::Shape {
            outer: vec![
                Point { x, y },
                Point { x: x + w, y },
                Point { x: x + w, y: y + d },
                Point { x, y: y + d },
            ],
            holes: vec![],
        };
        let access = |w: f64| {
            vec![
                json!({"id":"lot/street/0","segment":[{"x":x,"y":y},{"x":x+w,"y":y}],
                "kind":"public","width_m":w}),
            ]
        };
        let flat = vec![20.0_f32; 16 * 16];
        let steep: Vec<f32> = (0..16 * 16)
            .map(|i| 20.0 + 0.25 * ((i / 16) as f32 + 0.5) * 32.0)
            .collect();
        let water = vec![0_u8; 16 * 16];
        let level = Surface {
            geometry: None,
            width: 512.,
            n: 16,
            height: &flat,
            water: &water,
        };
        let slope = Surface {
            geometry: None,
            width: 512.,
            n: 16,
            height: &steep,
            water: &water,
        };
        let Some(b12) = feasibility::pose_witness("MED-ANT-B12::default") else {
            // A table older than the houses export emits no pose at all.
            assert!(feasibility::pose_witness("MED-ANT-B01::default").is_none());
            return;
        };
        let poses = feasibility::minimum_candidates(b12, &lot(7.0, 12.0), &access(7.0), level);
        assert!(!poses.is_empty() && poses.len() <= 4);
        for c in &poses {
            let t = &c["transform"];
            let (ox, oy) = (
                t["origin"]["x"].as_f64().unwrap(),
                t["origin"]["y"].as_f64().unwrap(),
            );
            let a = t["orientation_deg"].as_f64().unwrap().to_radians();
            let world = |px: f64, py: f64| {
                (
                    ox + px * a.cos() - py * a.sin(),
                    oy + px * a.sin() + py * a.cos(),
                )
            };
            // Native site bounds of B12 (roof included) inside the lot.
            for (px, py) in [(-0.15, -0.15), (4.65, -0.15), (4.65, 7.2), (-0.15, 7.2)] {
                let (wx, wy) = world(px, py);
                assert!((x - 1e-6..=x + 7.0 + 1e-6).contains(&wx), "{c}");
                assert!((y - 1e-6..=y + 12.0 + 1e-6).contains(&wy), "{c}");
            }
            // The door (native y = 7) faces the street at y = 100.
            assert!(world(1.1, 7.0).1 < world(1.1, 0.0).1);
            let contact = &c["contact"];
            assert!((contact["y"].as_f64().unwrap() - y).abs() < 1e-9);
            let along = contact["x"].as_f64().unwrap() - x;
            assert!((0.425..=7.0 - 0.425).contains(&along));
            assert_eq!(c["access_id"], "lot/street/0");
            assert_eq!(c["identity"]["style_id"], "MED-ANT-B12::default");
        }
        // Too narrow for its 4.8 m site bounds, or too steep to found it.
        assert!(
            feasibility::minimum_candidates(b12, &lot(4.0, 12.0), &access(4.0), level).is_empty()
        );
        assert!(
            feasibility::minimum_candidates(b12, &lot(7.0, 12.0), &access(7.0), slope).is_empty()
        );
    }

    /// Invariant: a lot on which no source houses may draw has a founded
    /// pose is not sent to be drawn and refused, and no smaller house stands
    /// for it: it stays open land with an explicit deficit (cause and
    /// households), counted by the French warning. The same lot on level
    /// ground stays a home of the wished composition.
    #[test]
    fn a_lot_no_native_house_can_found_is_an_explicit_deficit() {
        let y = 100.;
        let shape = |x: f64, w: f64, d: f64| json!({"outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],"holes":[]});
        let culture = super::super::culture::mapping("roman-core").unwrap();
        let parcels = vec![
            json!({"id":"steep","shape":shape(0., 12., 20.),"block":0,"use":"plot",
            "front":[{"x":0.,"y":y},{"x":12.,"y":y}],"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.6,"family":"frontage",
            "contacts":[{"a":{"x":0.,"y":y},"b":{"x":12.,"y":y},"street":0,"rank":1,"length":12.,"kind":"public"}]}),
        ];
        let allocations = vec![
            json!({"parcelId":"steep","demandId":"demand","function":"domestic",
            "culture":"roman-core","architecturePack":"MED-ANT","capacity":1.,"households":2.,
            "unit":"domesticUnits","score":1.,"reasons":[],"role":"dwelling.house"}),
        ];
        let programme = json!({"version":1,"population":5000,"context":{},"cultures":[culture],
            "demands":[],"reservations":[],"allocations":allocations,"adjacency":[],
            "environment":[],"reconciliationPasses":0,"warnings":[]});
        let layout: Layout = serde_json::from_value(json!({"key":"rome","culture":"roman-core",
            "config":{},"programme":programme,"center":{"x":6.,"y":y+10.},
            "quarters":[{"shape":shape(0.,12.,20.),"phase":0,"zone":"core"}],
            "streets":[{"path":[{"x":-10.,"y":y-1.},{"x":30.,"y":y-1.}],"widths":[2.,2.],"rank":1,"role":"local"}],
            "blocks":[{"shape":shape(0.,12.,20.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
            "warnings":[]}))
        .unwrap();
        let partition: Partition = serde_json::from_value(json!({"key":"rome","config":{},
            "parcels":parcels,"programme":programme,"warnings":[]}))
        .unwrap();
        let water = vec![0; 16 * 16];
        // 14° plane rising away from the street: 1.1 m across any 4.5 m body.
        let steep: Vec<f32> = (0..16 * 16)
            .map(|i| 20.0 + 0.25 * ((i / 16) as f32 + 0.5) * 32.0)
            .collect();
        let flat = vec![20.0_f32; 16 * 16];
        let site = |height: &[f32]| {
            let surface = Surface {
                geometry: None,
                width: 512.,
                n: 16,
                height,
                water: &water,
            };
            requests(
                "rome",
                std::slice::from_ref(&layout),
                std::slice::from_ref(&partition),
                surface,
                height,
                None,
            )
            .unwrap()
            .remove(0)
        };
        let steep_site = site(&steep);
        assert_eq!(
            steep_site["function"], "open_space",
            "{}",
            steep_site["programme"]
        );
        assert_eq!(steep_site["programme"]["deficit"]["cause"], "pente");
        assert_eq!(steep_site["programme"]["deficit"]["households"], 2.0);
        assert!(steep_site.get("native_minimum_candidates").is_none());
        let warning = deficit_warning(std::slice::from_ref(&steep_site)).unwrap();
        assert!(
            warning.contains("1 lot(s)") && warning.contains("2.0 ménage(s)"),
            "{warning}"
        );
        let level = site(&flat);
        assert_eq!(level["function"], "domestic");
        assert!(level["programme"].get("deficit").is_none());
        assert!(deficit_warning(std::slice::from_ref(&level)).is_none());
        assert!(level["feasibility"]["fitting_witnesses"].as_u64().unwrap() > 0);
    }

    /// One-street fixture: rectangular lots side by side on a street at
    /// y = 99, the terrain rising away from it by `grade` m per m.
    fn lot_sites(
        culture: &str,
        pack: &str,
        lots: &[(&str, f64, f64, f64, &str, &str)],
        grade: f32,
    ) -> Vec<Value> {
        let y = 100.;
        let shape = |x: f64, w: f64, d: f64| json!({"outer":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+d},{"x":x,"y":y+d}],"holes":[]});
        let mapping = super::super::culture::mapping(culture).unwrap();
        let (mut parcels, mut allocations) = (vec![], vec![]);
        let mut right: f64 = 0.0;
        for &(id, x, w, d, function, role) in lots {
            right = right.max(x + w);
            parcels.push(json!({"id":id,"shape":shape(x, w, d),"block":0,"use":"plot",
                "front":[{"x":x,"y":y},{"x":x+w,"y":y}],"axis":{"x":1.,"y":0.},"rank":1,"pressure":0.6,"family":"frontage",
                "contacts":[{"a":{"x":x,"y":y},"b":{"x":x+w,"y":y},"street":0,"rank":1,"length":w,"kind":"public"}]}));
            allocations.push(
                json!({"parcelId":id,"demandId":"demand","function":function,
                "culture":culture,"architecturePack":pack,"capacity":1.,"households":1.,
                "unit":"domesticUnits","score":1.,"reasons":[],"role":role}),
            );
        }
        let programme = json!({"version":1,"population":5000,"context":{},"cultures":[mapping],
            "demands":[],"reservations":[],"allocations":allocations,"adjacency":[],
            "environment":[],"reconciliationPasses":0,"warnings":[]});
        let layout: Layout = serde_json::from_value(json!({"key":"lots","culture":culture,
            "config":{},"programme":programme,"center":{"x":right*0.5,"y":y+20.},
            "quarters":[{"shape":shape(0.,right,60.),"phase":0,"zone":"core"}],
            "streets":[{"path":[{"x":-10.,"y":y-1.},{"x":right+10.,"y":y-1.}],"widths":[2.,2.],"rank":1,"role":"local"}],
            "blocks":[{"shape":shape(0.,right,60.),"quarter":0,"kind":"housing","axis":{"x":1.,"y":0.},"zone":"core"}],
            "warnings":[]}))
        .unwrap();
        let partition: Partition = serde_json::from_value(json!({"key":"lots","config":{},
            "parcels":parcels,"programme":programme,"warnings":[]}))
        .unwrap();
        let height: Vec<f32> = (0..16 * 16)
            .map(|i| 20.0 + grade * ((i / 16) as f32 + 0.5) * 32.0)
            .collect();
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width: 512.,
            n: 16,
            height: &height,
            water: &water,
        };
        requests("lots", &[layout], &[partition], surface, &height, None).unwrap()
    }
    fn site_of<'a>(sites: &'a [Value], id: &str) -> &'a Value {
        sites
            .iter()
            .find(|r| r["parcel_id"] == id)
            .unwrap_or_else(|| panic!("{id} site"))
    }

    /// Invariant: a home's wished composition is one whose first houses
    /// shortlist group draws a source of the programme's own role among the
    /// sources the lot holds (a Roman shop or house never wishes the
    /// street-block insula MED-ANT-B13 first, a tenement does), while the
    /// street wall stays the wished one.
    #[test]
    fn roman_homes_wish_the_sources_of_their_own_programme() {
        let sites = lot_sites(
            "roman-core",
            "MED-ANT",
            &[
                ("house", 0., 10., 22., "domestic", "dwelling.house"),
                ("shop", 10., 9., 22., "mixed", "dwelling.shop"),
                ("tenement", 19., 12., 24., "domestic", "dwelling.tenement"),
            ],
            0.0,
        );
        let admissible = feasibility::admissible("MED-ANT", "roman-core", "", false);
        for (id, role) in [
            ("house", "dwelling"),
            ("shop", "mixed_residential"),
            ("tenement", "communal_dwelling"),
        ] {
            let site = site_of(&sites, id);
            let composition = site["programme"]["composition"].as_str().unwrap();
            let floors = wish_of(&site["programme"]["floors"]);
            let rank = |w: &NativeProfile| {
                let f = floors.map_or(0, |[lo, hi]| {
                    w.floors[0]
                        .saturating_sub(hi)
                        .max(lo.saturating_sub(w.floors[1]))
                });
                (feasibility::composition_rank(composition, w), f)
            };
            let parcel: Parcel = serde_json::from_value(json!({"id":id,"shape":site["cadastral"][0],
                "block":0,"use":"plot","axis":{"x":1.,"y":0.},"rank":1,"family":"frontage",
                "contacts":[{"a":site["accesses"][0]["segment"][0],"b":site["accesses"][0]["segment"][1],
                    "street":0,"rank":1,"length":site["accesses"][0]["width_m"],"kind":"public"}]}))
            .unwrap();
            let fits = feasibility::lot_fit(&parcel, &admissible).fits;
            let first = fits.iter().map(|w| rank(w)).min().unwrap();
            assert!(
                fits.iter().any(|w| rank(w) == first && w.role == role),
                "{id}: {composition} {}",
                site["programme"]
            );
        }
        assert_eq!(
            site_of(&sites, "house")["programme"]["composition"],
            "detached"
        );
        assert_eq!(
            site_of(&sites, "shop")["programme"]["composition"],
            "detached"
        );
        assert_eq!(
            site_of(&sites, "tenement")["programme"]["composition"],
            "row"
        );
        assert_eq!(
            site_of(&sites, "shop")["programme"]["frontage_continuity"],
            1.0
        );
    }

    /// Invariant: a functional choice houses resolves from its registry
    /// (Javanese granary, inn) asks for a built target inside the body-area
    /// range its declared simple sources span, never one none of them takes.
    #[test]
    fn registered_functional_targets_stay_within_their_sources() {
        let sites = lot_sites(
            "javanese-courts",
            "AS-ISL",
            &[("granary", 0., 40., 40., "warehouse", "storage.granary")],
            0.0,
        );
        let site = site_of(&sites, "granary");
        let (_, [lo, hi]) = super::super::culture::functional_choice_sources(
            "javanese-courts",
            "AS-ISL",
            "storage.granary",
            "warehouse",
            "hall",
            "historical_inspired",
        )
        .unwrap();
        let target = site["programme"]["built_area_m2"].as_f64().unwrap();
        assert!((lo..=hi).contains(&target), "{target} outside {lo}..{hi}");
        assert!(site["config"]["recipe"].is_null());
    }

    /// Invariant: a facility whose pinned native recipe (Roman horreum on the
    /// MED-ANT atrium court, 26 m) cannot be founded on its lot by any street
    /// pose is an explicit urban deficit, not a request houses refuses.
    #[test]
    fn a_facility_its_pinned_recipe_cannot_found_is_an_explicit_deficit() {
        let lots = [("horreum", 0., 45., 45., "warehouse", "storage.horreum")];
        let steep = lot_sites("roman-core", "MED-ANT", &lots, 0.06);
        let site = site_of(&steep, "horreum");
        assert!(site["config"]["recipe"].is_string(), "{}", site["config"]);
        assert_eq!(site["function"], "open_space", "{}", site["programme"]);
        assert_eq!(site["programme"]["deficit"]["cause"], "pente");
        let level = lot_sites("roman-core", "MED-ANT", &lots, 0.0);
        let site = site_of(&level, "horreum");
        assert_eq!(site["function"], "warehouse");
        assert!(site["programme"].get("deficit").is_none());
    }
}
