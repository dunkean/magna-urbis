//! Neutral coarse placement intents. No dependency on the architectural engine:
//! JSON follows the documented houses placement boundary, without renderer data.
use crate::urban::warnings;
use super::geometry::interior_point;
use super::{Layout, Parcel, Partition, Point, Surface};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};

#[path = "funerary.rs"]
mod funerary;
#[path = "hillside.rs"]
mod hillside;

mod site_geometry;
use site_geometry::{access_segments, ground_patch, shared_boundaries, lone_farmhouse, ring_area};
mod architecture;
use architecture::{drawn_culture, apply_massing_overrides, inherit_house_config, typical_floors};
#[path = "feasibility.rs"]
mod feasibility;
use feasibility::Witness as NativeProfile;
#[cfg(test)] std::thread_local! {static PREVIEW_TOPOLOGY:std::cell::Cell<bool>=const{std::cell::Cell::new(true)};}
fn preview_topology_enabled()->bool {
    #[cfg(test)] {PREVIEW_TOPOLOGY.with(std::cell::Cell::get)}
    #[cfg(not(test))] {true}
}
pub(super) fn recipe_admission_witness(recipe:&str) -> Option<([f64;2],f64,String,[u32;2])> {
    let w=feasibility::recipe_sources(recipe).into_iter().find(|w|w.supported)?;
    Some((w.envelope,w.access,w.layout.clone(),w.floors))
}

mod admission;
use admission::{feasibility_probe, wish_of, feasibility_enabled, court_layout, tall_collective, collective_floors, lot_deficit, deficit_message};
pub(super) use admission::{round7, recipe_foundable, clear_probe_cache};
pub use admission::deficit_warning;
mod programmes;
use programmes::{district_programmes, programme_of, composition_of, frontage_continuity};
mod index;
pub use index::{MAX_SITE_PAGE_SIZE, MAX_SITE_PAGE_BYTES, SitePage, BuildingSiteIndex};

/// Count UTF-8 JSON bytes without allocating a second serialized payload.
#[cfg(test)]
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
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let out = requests_range(
        seed,
        layouts,
        partitions,
        surface,
        water_level,
        architecture_culture,
        0,
        usize::MAX,
    );
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!("  building_sites: {:.0} ms (farmsteads, all calls so far: {:?} ms cpu, calls)", tick.elapsed().as_secs_f64() * 1000.0, super::farmsteads::cpu_ms());
    }
    out
}

/// Number of building sites `requests` emits for these inputs.
pub fn request_count(layouts: &[Layout], partitions: &[Partition]) -> Result<usize, String> {
    let selected: Vec<_> = (0..partitions.len()).collect();
    Ok(BuildingSiteIndex::prepare(layouts, partitions, &selected)?.total())
}

/// `display::site_display_buffers(&requests(..), origin)` byte for byte, without
/// ever holding the requests of the whole town: sites are generated in parallel
/// by chunks, each reduced to a flat display row on its worker (the request tree
/// is dropped there) and appended in site order. The terrain grid, which the
/// display never reads, is not computed.
#[allow(clippy::too_many_arguments)]
pub fn display_buffers(
    seed: &str,
    layouts: &[Layout],
    partitions: &[Partition],
    surface: Surface<'_>,
    water_level: &[f32],
    architecture_culture: Option<&str>,
    origin: Point,
    version: u32,
    blocks: Option<&BTreeMap<String, std::collections::BTreeSet<usize>>>,
) -> Result<Vec<u8>, String> {
    const CHUNK: usize = 8192;
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let selected: Vec<_> = (0..partitions.len()).collect();
    let mut index = BuildingSiteIndex::prepare(layouts, partitions, &selected)?;
    if let Some(blocks) = blocks {
        index.sites.retain(|site| {
            let partition = &partitions[index.partitions[site.partition].partition];
            blocks.get(&partition.key).is_some_and(|own| own.contains(&partition.parcels[site.parcel].block))
        });
    }
    let total = index.total();
    let mut display = super::display::SiteDisplay::new(origin, total, version);
    let mut start = 0;
    while start < total {
        let end = (start + CHUNK).min(total);
        let rows = super::par::range(end - start, |k| {
            index
                .request_site(start + k, seed, layouts, partitions, surface, water_level, architecture_culture, false)
                .map(|request| super::display::SiteRow::new(&request, origin, version))
        });
        // The first error in site order wins, as in a serial loop.
        for row in rows {
            display.push(row?);
        }
        start = end;
    }
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!("  building_sites display: {:.0} ms, {total} sites", tick.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(display.finish())
}

/// Sites `start..end` (clamped) of `requests`: pure per site, generated in
/// parallel and returned in order, so concatenated ranges equal `requests`.
/// As in a serial loop, the first error in site order wins.
#[allow(clippy::too_many_arguments)]
pub fn requests_range(
    seed: &str,
    layouts: &[Layout],
    partitions: &[Partition],
    surface: Surface<'_>,
    water_level: &[f32],
    architecture_culture: Option<&str>,
    start: usize,
    end: usize,
) -> Result<Vec<Value>, String> {
    let selected: Vec<_> = (0..partitions.len()).collect();
    let index = BuildingSiteIndex::prepare(layouts, partitions, &selected)?;
    let end = end.min(index.total());
    let start = start.min(end);
    super::par::range(end - start, |k| {
        index.request_one(
            start + k,
            seed,
            layouts,
            partitions,
            surface,
            water_level,
            architecture_culture,
        )
    })
    .into_iter()
    .collect()
}

#[cfg(test)]
mod tests;
mod previews;
pub(super) use previews::{previewed_parcels, SitePreviews};
