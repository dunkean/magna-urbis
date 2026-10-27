//! Small loopback service sharing the exact native crates with the browser builds.
//! Independent sessions retain terrain/urban layouts; rasters cross the boundary as bytes.
mod urban_session;
#[cfg(test)]
mod urban_source_tests;

use magna_urbis_core::{TerrainGenerator, TerrainZones, settlements, urban};
use magna_urbis_houses::{catalogue, model::HouseConfig};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use urban_session::{RetainedUrban, UrbanSourceHandle};

const MAX_BODY: usize = 128 * 1024 * 1024;
const MAX_SESSIONS: usize = 8;
const FIELD_N: usize = 1024;
type ApiResult<T> = Result<T, String>;

#[derive(Default)]
struct Session {
    terrain: Option<TerrainGenerator>,
    terrain_key: String,
    field: Vec<f32>,
    field_exact: bool,
    settlements: Option<settlements::Terrain>,
    layouts: Option<(u64, Arc<Vec<urban::Layout>>)>,
    urban: RetainedUrban,
}
#[derive(Default)]
struct Sessions {
    clock: u64,
    entries: HashMap<String, (u64, Arc<Mutex<Session>>)>,
}
impl Sessions {
    /// A retained-source read must never recreate an evicted session.
    fn existing(&mut self, id: &str) -> ApiResult<Arc<Mutex<Session>>> {
        let entry = self.entries.get_mut(id).ok_or(
            "[urban_source_missing] Retained urban session expired; regenerate it explicitly.",
        )?;
        self.clock += 1;
        entry.0 = self.clock;
        Ok(Arc::clone(&entry.1))
    }

    fn get(&mut self, id: &str) -> ApiResult<Arc<Mutex<Session>>> {
        if id.is_empty() || id.len() > 128 {
            return Err("Identifiant de session invalide.".into());
        }
        self.clock += 1;
        if !self.entries.contains_key(id) && self.entries.len() >= MAX_SESSIONS {
            // Active requests keep their Arc and are never removed mid-generation.
            let oldest = self
                .entries
                .iter()
                .filter(|(_, (_, session))| Arc::strong_count(session) == 1)
                .min_by_key(|(_, (clock, _))| *clock)
                .map(|(key, _)| key.clone());
            match oldest {
                Some(key) => {
                    self.entries.remove(&key);
                }
                None => return Err("Toutes les sessions locales sont occupÃƒÆ’Ã‚Â©es. RÃƒÆ’Ã‚Â©essayez.".into()),
            }
        }
        let entry = self.entries.entry(id.into()).or_default();
        entry.0 = self.clock;
        Ok(entry.1.clone())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerrainSettings {
    seed: String,
    width: f64,
    relief: String,
    erosion: f64,
    motif_size: f64,
    mountain_mix: f64,
    environment: Option<String>,
    zones: Option<TerrainZones>,
    #[serde(default)]
    coast_mask: u32,
    #[serde(default = "island")]
    island_mode: String,
    #[serde(default)]
    erosion_tuning: HashMap<String, f64>,
    sketch: Option<Value>,
    surface: Option<Vec<f32>>,
    source: Option<String>,
}
fn island() -> String {
    "island".into()
}
#[derive(Deserialize)]
struct Region {
    x: f64,
    y: f64,
    extent: f64,
    resolution: usize,
}
#[derive(Deserialize)]
struct TerrainRequest {
    session: String,
    settings: Value,
    region: Region,
    #[serde(default)]
    field: bool,
}

struct Reply {
    kind: &'static str,
    body: Vec<u8>,
}
fn json_reply(value: impl Serialize) -> ApiResult<Reply> {
    Ok(Reply {
        kind: "application/json",
        body: serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    })
}
fn decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> ApiResult<T> {
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}
fn value<T: for<'de> Deserialize<'de>>(v: &Value) -> ApiResult<T> {
    serde_json::from_value(v.clone()).map_err(|e| e.to_string())
}
fn millis(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

/// Padded JSON header followed by tightly packed arrays, all little-endian.
/// f32 blocks precede u8 blocks so TypedArray views require no copies in JS.
fn terrain_reply(input: TerrainRequest, state: &mut Session) -> ApiResult<Reply> {
    let settings: TerrainSettings = value(&input.settings)?;
    if settings
        .source
        .as_deref()
        .is_some_and(|source| source != "procedural")
    {
        return Err("Le neuronal utilise son service GPU dÃƒÆ’Ã‚Â©diÃƒÆ’Ã‚Â© ; ce point dÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢entrÃƒÆ’Ã‚Â©e prÃƒÆ’Ã‚Â©pare le terrain procÃƒÆ’Ã‚Â©dural.".into());
    }
    let key = serde_json::to_string(&input.settings).map_err(|e| e.to_string())?;
    let started = Instant::now();
    let mut prepare_ms = 0.0;
    // Tuning is thread-local in core. Install it for each request, including coast work.
    let tuning: Vec<f64> = magna_urbis_core::EROSION_TUNING
        .iter()
        .map(|name| {
            settings
                .erosion_tuning
                .get(*name)
                .copied()
                .unwrap_or(f64::NAN)
        })
        .collect();
    magna_urbis_core::set_erosion_tuning(&tuning);
    if state.terrain.is_none() || state.terrain_key != key {
        // Free old grids before creating the next ones, bounding peak session memory.
        state.terrain = None;
        state.field.clear();
        let mix = if settings.relief == "mixed" {
            settings.mountain_mix
        } else {
            0.5
        };
        let processing = settings
            .sketch
            .as_ref()
            .and_then(|s| s["processing"].as_str());
        let mut terrain = if let Some(heights) = settings.surface.as_ref() {
            if processing == Some("erosion") {
                let mut generator = TerrainGenerator::new_with_environment(
                    &settings.seed,
                    settings.width,
                    &settings.relief,
                    settings.erosion,
                    settings.motif_size,
                    mix,
                    settings.environment.as_deref(),
                )?;
                generator.set_edited_surface(heights)?;
                generator
            } else if processing == Some("surface") {
                TerrainGenerator::with_surface(&settings.seed, settings.width, heights)?
            } else {
                return Err("Mode de traitement de heightmap invalide.".into());
            }
        } else if settings.sketch.is_some() {
            return Err(
                "LÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢esquisse doit ÃƒÆ’Ã‚Âªtre appliquÃƒÆ’Ã‚Â©e aprÃƒÆ’Ã‚Â¨s la gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©ration native par lÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢adaptateur."
                    .into(),
            );
        } else {
            match settings.zones.as_ref() {
                Some(zones) => TerrainGenerator::with_zones(
                    &settings.seed,
                    settings.width,
                    &settings.relief,
                    settings.erosion,
                    settings.motif_size,
                    mix,
                    settings.environment.as_deref(),
                    zones,
                )?,
                None => TerrainGenerator::new_with_environment(
                    &settings.seed,
                    settings.width,
                    &settings.relief,
                    settings.erosion,
                    settings.motif_size,
                    mix,
                    settings.environment.as_deref(),
                )?,
            }
        };
        if processing.is_none() {
            terrain.set_coast(settings.coast_mask, &settings.island_mode)?;
        }
        // Regional and coastal/zoned fields are already physical metre rasters.
        // Preserve their control points rather than smoothing them a second time.
        let family = terrain.sampling_parameters()[5];
        state.field_exact = (family == 1.0 || family == 4.0) && settings.relief != "cavern";
        state.field = if settings.relief == "cavern" {
            Vec::new()
        } else if state.field_exact {
            let mut field = terrain.sampling_field();
            field.truncate(FIELD_N * FIELD_N);
            field
        } else {
            terrain
                .sample_region(0.0, 0.0, settings.width, FIELD_N)?
                .height
        };
        state.terrain = Some(terrain);
        state.terrain_key = key;
        prepare_ms = millis(started);
    }
    let terrain = state.terrain.as_ref().ok_or("Terrain local absent.")?;
    let sampling_started = Instant::now();
    let r = input.region;
    let data = terrain.sample_region(r.x, r.y, r.extent, r.resolution)?;
    let sampling_ms = millis(sampling_started);
    let mut arrays = vec![
        ("height", data.height.as_slice()),
        ("normalX", data.normal_x.as_slice()),
        ("normalY", data.normal_y.as_slice()),
        ("normalZ", data.normal_z.as_slice()),
    ];
    if input.field && !state.field.is_empty() {
        arrays.push(("field", &state.field));
    }
    let descriptors: Vec<Value> = arrays
        .iter()
        .map(|(name, data)| json!({"name": name, "type": "f32", "count": data.len()}))
        .chain(std::iter::once(
            json!({"name": "caveMask", "type": "u8", "count": data.cave_mask.len()}),
        ))
        .collect();
    let header = json!({"session": input.session, "x": data.x, "y": data.y, "width": data.width,
        "resolution": data.resolution, "minHeight": data.min_height, "maxHeight": data.max_height,
        "globalMinHeight": terrain.min_height(), "globalMaxHeight": terrain.max_height(),
        "motifSize": settings.motif_size, "prepareMs": prepare_ms, "samplingMs": sampling_ms,
        "fieldExact": state.field_exact, "fieldN": FIELD_N, "arrays": descriptors,
        "erosionDefaults": magna_urbis_core::erosion_defaults(&settings.relief, settings.width, settings.motif_size, settings.mountain_mix)?});
    let mut encoded = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
    encoded.resize(encoded.len().next_multiple_of(4), b' ');
    let count: usize = arrays.iter().map(|(_, a)| a.len() * 4).sum();
    let mut body = Vec::with_capacity(4 + encoded.len() + count + data.cave_mask.len());
    body.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
    body.extend_from_slice(&encoded);
    for (_, array) in arrays {
        for number in array {
            body.extend_from_slice(&number.to_le_bytes());
        }
    }
    body.extend_from_slice(&data.cave_mask);
    Ok(Reply {
        kind: "application/octet-stream",
        body,
    })
}

#[derive(Deserialize)]
struct RasterHeader {
    session: String,
    width: f64,
    n: usize,
    geometry: Option<urban::VectorGeography>,
}
fn raster_upload(body: &[u8], sessions: &Mutex<Sessions>) -> ApiResult<Reply> {
    let header_len = u32::from_le_bytes(
        body.get(..4)
            .ok_or("Raster incomplet.")?
            .try_into()
            .map_err(|_| "Raster incomplet.")?,
    ) as usize;
    let end = 4_usize.checked_add(header_len).ok_or("Raster invalide.")?;
    let header: RasterHeader = decode(body.get(4..end).ok_or("Raster incomplet.")?)?;
    let session = sessions
        .lock()
        .map_err(|_| "Sessions indisponibles.")?
        .get(&header.session)?;
    let mut state = session.lock().map_err(|_| "Session indisponible.")?;
    // Match the browser boundary: an invalid replacement cannot retain old layouts
    // or silently route against a previous terrain. Release its grids before rebuilding.
    state.settlements = None;
    state.layouts = None;
    state.urban.invalidate_terrain();
    let count = header
        .n
        .checked_mul(header.n)
        .filter(|_| (16..=1024).contains(&header.n))
        .ok_or("RÃƒÆ’Ã‚Â©solution invalide.")?;
    let data = body
        .get(end..)
        .filter(|data| data.len() == count * 17)
        .ok_or("Raster incomplet.")?;
    let floats = |index| -> Vec<f32> {
        data[index * count * 4..(index + 1) * count * 4]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect()
    };
    let height = floats(0);
    let water_level = floats(1);
    let river_width = floats(2);
    let river_ids: Vec<i32> = data[3 * count * 4..4 * count * 4]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|bytes| i32::from_le_bytes(*bytes))
        .collect();
    let water = &data[4 * count * 4..];
    let mut terrain = settlements::Terrain::new(settlements::Raster {
        width: header.width,
        n: header.n,
        height: &height,
        water,
        water_level: &water_level,
        river_width: &river_width,
        river_ids: &river_ids,
    })?;
    if let Some(geometry) = header.geometry {
        terrain.set_urban_geometry(geometry)?;
    }
    state.settlements = Some(terrain);
    state.urban.retain_terrain()?;
    json_reply(json!({"ok": true, "session": header.session}))
}

fn settlement_reply(input: Value, state: &Session) -> ApiResult<Reply> {
    let terrain = state
        .settlements
        .as_ref()
        .ok_or("GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rez le terrain avant les lieux et routes.")?;
    let seed = input["seed"].as_str().ok_or("Graine absente.")?;
    let mut sites = input
        .get("sites")
        .map(value::<Vec<settlements::roads::RoadSite>>)
        .transpose()?
        .unwrap_or_default();
    let mut placed = Value::Null;
    if let Some(config) = input.get("place").filter(|config| !config.is_null()) {
        let started = Instant::now();
        let result = terrain.place(seed, &value(config)?)?;
        sites = result
            .settlements
            .iter()
            .map(|s| settlements::roads::RoadSite {
                key: s.spec.key.clone(),
                population: s.spec.population,
                culture: s.spec.culture.clone(),
                center: s.center,
                radius: s.radius,
            })
            .collect();
        placed = serde_json::to_value(result).map_err(|e| e.to_string())?;
        placed["ms"] = json!(millis(started));
    }
    let mut roads = Value::Null;
    if let Some(config) = input.get("roads").filter(|config| !config.is_null()) {
        let started = Instant::now();
        roads = serde_json::to_value(terrain.roads(seed, &sites, &value(config)?)?)
            .map_err(|e| e.to_string())?;
        roads["ms"] = json!(millis(started));
    }
    let mut result = json!({"id": input["id"], "roads": roads});
    if !placed.is_null() {
        result["settlements"] = placed;
    }
    json_reply(result)
}

/// Serialize the original wire geometry once, then retain the exact decimal
/// boundary seen by explicit callers. Drop generated geometry before reparsing;
/// no whole-partition Value tree or duplicate JSON buffer is needed.
fn retained_parcels_reply(
    id: &Value,
    session: &str,
    layouts: Arc<Vec<urban::Layout>>,
    partitions: Vec<urban::Partition>,
    retained: &mut RetainedUrban,
    started: Instant,
) -> ApiResult<Reply> {
    let mut body = b"{\"id\":".to_vec();
    serde_json::to_writer(&mut body, id).map_err(|e| e.to_string())?;
    body.extend_from_slice(b",\"partitions\":");
    let begin = body.len();
    serde_json::to_writer(&mut body, &partitions).map_err(|e| e.to_string())?;
    let end = body.len();
    drop(partitions);
    let partitions = Arc::new(decode(&body[begin..end])?);
    retained.retain_partitions(layouts, partitions)?;
    let source = retained.source(session)?;
    body.extend_from_slice(b",\"urbanSource\":");
    serde_json::to_writer(&mut body, &source).map_err(|e| e.to_string())?;
    body.extend_from_slice(b",\"ms\":");
    serde_json::to_writer(&mut body, &millis(started)).map_err(|e| e.to_string())?;
    body.push(b'}');
    Ok(Reply {
        kind: "application/json",
        body,
    })
}

fn selected_partition_indices(
    layouts: &[urban::Layout],
    partitions: &[urban::Partition],
    keys: &[String],
) -> ApiResult<Vec<usize>> {
    let selected: HashSet<&str> = keys.iter().map(String::as_str).collect();
    if selected.len() != keys.len() {
        return Err("[urban_source_keys] Duplicate selected layout key.".into());
    }
    let known: HashSet<&str> = layouts.iter().map(|layout| layout.key.as_str()).collect();
    if selected.iter().any(|key| !known.contains(key)) {
        return Err("[urban_source_keys] Unknown selected layout key.".into());
    }
    let mut missing = selected.clone();
    let indices = partitions
        .iter()
        .enumerate()
        .filter_map(|(index, partition)| {
            if selected.contains(partition.key.as_str()) {
                missing.remove(partition.key.as_str());
                Some(index)
            } else {
                None
            }
        })
        .collect();
    if !missing.is_empty() {
        return Err("[urban_source_keys] Selected layout has no retained partition.".into());
    }
    Ok(indices)
}

fn urban_reply(input: Value, state: &mut Session, session: &str) -> ApiResult<Reply> {
    if input["kind"] == "buildingSite" {
        let source: UrbanSourceHandle = value(&input["source"])?;
        let seed = input["seed"].as_str().ok_or("Graine absente.")?;
        let culture = input
            .get("architectureCulture")
            .map(value::<String>)
            .transpose()?;
        let snapshot = state.urban.validate_source(session, &source)?;
        let keys: Option<Vec<String>> = input.get("keys").map(value).transpose()?;
        let selected = if let Some(keys) = keys {
            selected_partition_indices(snapshot.layouts, snapshot.partitions, &keys)?
        } else {
            (0..snapshot.partitions.len()).collect()
        };
        let offset: usize = value(&input["offset"])?;
        let max_bytes: usize = value(&input["maxBytes"])?;
        let expected_id = input["expectedId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 1024)
            .ok_or("[urban_site_identity] Invalid original building site ID.")?;
        let terrain = state
            .settlements
            .as_ref()
            .ok_or("Missing retained terrain for buildings")?;
        let started = Instant::now();
        let (placement_request, total) = state.urban.read_building_site(
            session,
            &source,
            &selected,
            seed,
            culture.as_deref(),
            terrain,
            offset,
            expected_id,
            max_bytes,
        )?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct SiteReply {
            placement_request: Value,
            offset: usize,
            total: usize,
            ms: f64,
        }
        return json_reply(SiteReply {
            placement_request,
            offset,
            total,
            ms: millis(started),
        });
    }
    if input["kind"] == "buildingSitesBegin" {
        let source: UrbanSourceHandle = value(&input["source"])?;
        let seed = input["seed"].as_str().ok_or("Graine absente.")?;
        let culture = input
            .get("architectureCulture")
            .map(value::<String>)
            .transpose()?;
        let snapshot = state.urban.validate_source(session, &source)?;
        let keys: Option<Vec<String>> = input.get("keys").map(value).transpose()?;
        let selected = if let Some(keys) = keys {
            selected_partition_indices(snapshot.layouts, snapshot.partitions, &keys)?
        } else {
            (0..snapshot.partitions.len()).collect()
        };
        if state.settlements.is_none() {
            return Err("Missing retained terrain for buildings".into());
        }
        return json_reply(state.urban.begin_building_sites(
            session,
            &source,
            &selected,
            seed,
            culture.as_deref(),
        )?);
    }
    if input["kind"] == "buildingSitesPage" {
        // These values are fixed by begin. Never silently swap seed, culture or
        // selection while continuing an occupation stream.
        if ["seed", "architectureCulture", "keys"]
            .iter()
            .any(|key| input.get(key).is_some())
        {
            return Err("[urban_sites_query] Page query is fixed by buildingSitesBegin.".into());
        }
        let source: UrbanSourceHandle = value(&input["source"])?;
        let source_id = input["sourceId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 128)
            .ok_or("[urban_sites_query] Invalid building sites sourceId.")?;
        let offset: usize = value(&input["offset"])?;
        let limit: usize = value(&input["limit"])?;
        let max_bytes: usize = value(&input["maxBytes"])?;
        let terrain = state
            .settlements
            .as_ref()
            .ok_or("Missing retained terrain for buildings")?;
        let started = Instant::now();
        let page = state.urban.page_building_sites(
            session, &source, source_id, terrain, offset, limit, max_bytes,
        )?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PageReply {
            placement_requests: Vec<Value>,
            offset: usize,
            next: usize,
            total: usize,
            #[serde(skip_serializing_if = "Option::is_none")]
            required_bytes: Option<usize>,
            ms: f64,
        }
        return json_reply(PageReply {
            placement_requests: page.requests,
            offset: page.offset,
            next: page.next,
            total: page.total,
            required_bytes: page.required_bytes,
            ms: millis(started),
        });
    }
    if input["kind"] == "displayBuffers" {
        let source: UrbanSourceHandle = value(&input["source"])?;
        let snapshot = state.urban.validate_source(session, &source)?;
        let ids = input
            .get("ids")
            .map(value::<bool>)
            .transpose()?
            .unwrap_or(false);
        let keys: Option<Vec<String>> = input.get("keys").map(value).transpose()?;
        let (layouts, partitions): (Vec<&urban::Layout>, Vec<&urban::Partition>) =
            if let Some(keys) = keys {
                let indices =
                    selected_partition_indices(snapshot.layouts, snapshot.partitions, &keys)?;
                let selected: HashSet<&str> = keys.iter().map(String::as_str).collect();
                (
                    snapshot
                        .layouts
                        .iter()
                        .filter(|layout| selected.contains(layout.key.as_str()))
                        .collect(),
                    indices
                        .into_iter()
                        .map(|index| &snapshot.partitions[index])
                        .collect(),
                )
            } else {
                (
                    snapshot.layouts.iter().collect(),
                    snapshot.partitions.iter().collect(),
                )
            };
        return Ok(Reply {
            kind: "application/octet-stream",
            body: urban::display::display_buffers_refs(&layouts, &partitions, ids),
        });
    }
    // Invalidate before parsing generation arguments, so a failed replacement
    // cannot leave a previously issued handle silently pointing at old data.
    match input["kind"].as_str() {
        Some("quarters") => {
            state.layouts = None;
            state.urban.invalidate_layouts();
        }
        Some("parcels" | "programme" | "builtCapacity") => state.urban.invalidate_partitions(),
        _ => {}
    }
    let seed = input["seed"].as_str().ok_or("Graine absente.")?;
    let started = Instant::now();
    if input["kind"] == "quarters" {
        let terrain = state
            .settlements
            .as_ref()
            .ok_or("GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rez le terrain avant les quartiers.")?;
        let sites = input
            .get("sites")
            .map(value::<Vec<urban::Site>>)
            .transpose()?
            .unwrap_or_default();
        let roads = input
            .get("roads")
            .map(value::<Vec<urban::Street>>)
            .transpose()?
            .unwrap_or_default();
        let config: urban::LayoutConfig = value(&input["layoutConfig"])?;
        let layouts = terrain.urban_quarters(seed, &sites, &config, &roads)?;
        let result = json!({"id": input["id"], "layouts": layouts, "ms": millis(started)});
        // Reparse serialized decimal coordinates, as the WASM parcel boundary does.
        // Deserializing Value directly retains native f64 bits and can change cuts.
        let retained = Arc::new(decode(
            &serde_json::to_vec(&result["layouts"]).map_err(|e| e.to_string())?,
        )?);
        state.urban.retain_layouts(Arc::clone(&retained))?;
        state.layouts = Some((input["id"].as_u64().ok_or("ID invalide.")?, retained));
        json_reply(result)
    } else if input["kind"] == "parcels" {
        if state.settlements.is_none() {
            return Err("GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rez le terrain avant les quartiers.".into());
        }
        let explicit: Option<Vec<urban::Layout>> = input.get("layouts").map(value).transpose()?;
        let layouts = match explicit {
            Some(layouts) => Arc::new(layouts),
            None if input.get("layoutsId").is_none() => Arc::new(Vec::new()),
            None => Arc::clone(
                &state
                    .layouts
                    .as_ref()
                    .filter(|(id, _)| Some(*id) == input["layoutsId"].as_u64())
                    .ok_or("Le plan a changÃƒÆ’Ã‚Â©. RÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rez les quartiers avant les parcelles.")?
                    .1,
            ),
        };
        let config: urban::ParcelConfig = value(&input["parcelConfig"])?;
        let partitions = urban::generate_parcels(seed, &layouts, &config)?;
        retained_parcels_reply(
            &input["id"],
            session,
            layouts,
            partitions,
            &mut state.urban,
            started,
        )
    } else if input["kind"] == "buildingSites" {
        let terrain = state
            .settlements
            .as_ref()
            .ok_or("Missing retained terrain for buildings")?;
        let culture = input["architectureCulture"].as_str();
        let output = if let Some(source) = input.get("source") {
            let source: UrbanSourceHandle = value(source)?;
            let snapshot = state.urban.validate_source(session, &source)?;
            if let Some(keys) = input.get("keys") {
                let keys: Vec<String> = value(keys)?;
                let indices =
                    selected_partition_indices(snapshot.layouts, snapshot.partitions, &keys)?;
                if indices.len() == snapshot.partitions.len() {
                    terrain.urban_building_sites_with_culture(
                        seed,
                        snapshot.layouts,
                        snapshot.partitions,
                        culture,
                    )?
                } else {
                    let mut output = Vec::new();
                    // Native sites are independently derived per partition and site
                    // identity. Iterate the retained order, never the caller's keys.
                    for index in indices {
                        output.extend(terrain.urban_building_sites_with_culture(
                            seed,
                            snapshot.layouts,
                            std::slice::from_ref(&snapshot.partitions[index]),
                            culture,
                        )?);
                    }
                    output
                }
            } else {
                terrain.urban_building_sites_with_culture(
                    seed,
                    snapshot.layouts,
                    snapshot.partitions,
                    culture,
                )?
            }
        } else {
            if input.get("keys").is_some() {
                return Err("[urban_source_keys] Selected keys require a retained source.".into());
            }
            let layouts: Vec<urban::Layout> = value(&input["layouts"])?;
            let partitions: Vec<urban::Partition> = value(&input["partitions"])?;
            terrain.urban_building_sites_with_culture(seed, &layouts, &partitions, culture)?
        };
        json_reply(json!({"id":input["id"],"placementRequests":output,"ms":millis(started)}))
    } else if input["kind"] == "builtCapacity" {
        let partitions: Vec<urban::Partition> = value(&input["partitions"])?;
        let scene: urban::programme::BuiltScene = value(&input["scene"])?;
        let output = urban::programme::reconcile_built(&partitions, &scene)?;
        json_reply(json!({"id":input["id"],"partitions":output,"ms":millis(started)}))
    } else if input["kind"] == "programme" {
        let layouts: Vec<urban::Layout> = value(&input["layouts"])?;
        let partitions: Vec<urban::Partition> = value(&input["partitions"])?;
        let output = urban::programme::reallocate(&layouts, &partitions)?;
        json_reply(json!({"id": input["id"], "partitions": output, "ms": millis(started)}))
    } else {
        Err("ÃƒÆ’Ã¢â‚¬Â°tape urbaine inconnue.".into())
    }
}

fn houses_reply(path: &str, body: &[u8]) -> ApiResult<Reply> {
    use magna_urbis_houses::plans::parent_session::{self,ParentSessionOperation as Op};
    let operation=match path{
        "/houses/begin-parent-session"=>Some(Op::Begin),"/houses/plan-parent-session"=>Some(Op::Plan),
        "/houses/ack-parent-session"=>Some(Op::Ack),"/houses/abort-parent-session"=>Some(Op::Abort),
        "/houses/release-parent-session"=>Some(Op::Release),_=>None,
    };
    if let Some(operation)=operation{
        // Exact cached native reply, BEFORE historical Value/json_reply.
        let raw=parent_session::host_runtime().json(operation,body,parent_session::host_clock_ms());
        return Ok(Reply{kind:"application/json",body:(*raw).clone()});
    }

    let result = (|| -> ApiResult<Value> {
        match path {
            "/houses/catalogue" => Ok(
                json!({"catalogue": catalogue::catalogue()?, "inventory": catalogue::source_inventory()?}),
            ),
            "/houses/preflight" => {
                let config: HouseConfig = decode(body)?;
                serde_json::to_value(magna_urbis_houses::preflight(config)?)
                    .map_err(|e| e.to_string())
            }
            "/houses/placement" => {
                let input = decode(body)?;
                serde_json::to_value(magna_urbis_houses::placement::place_batch(input)?)
                    .map_err(|e| e.to_string())
            }
            "/houses/plans" => {
                let input = decode(body)?;
                serde_json::to_value(magna_urbis_houses::plans::plan_batch(input)?)
                    .map_err(|e| e.to_string())
            }
            "/houses/plan-parent-batch" => {
                if body.len()>32*1024*1024{return Err("Native parent input exceeds32MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_parent_batch_request(body)?;
                serde_json::to_value(magna_urbis_houses::plans::parent_batch::plan_parent_batch(input)?).map_err(|e|e.to_string())
            }
            "/houses/unpack-parent" => {
                if body.len()>32*1024*1024{return Err("Native parent input exceeds32MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_parent_archive(body)?;
                serde_json::to_value(magna_urbis_houses::plans::parent_batch::unpack_parent(input)?).map_err(|e|e.to_string())
            }
            "/houses/realize-parent" => {
                if body.len()>32*1024*1024{return Err("Native parent input exceeds32MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_parent_realize_request(body)?;
                serde_json::to_value(magna_urbis_houses::plans::parent_batch::realize_parent(input)?).map_err(|e|e.to_string())
            }
            "/houses/unpack-parent-batch" => {
                if body.len()>32*1024*1024{return Err("Native parent input exceeds32MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_parent_unpack_batch_request(body)?;
                serde_json::to_value(magna_urbis_houses::plans::parent_batch::unpack_parent_batch(input)?).map_err(|e|e.to_string())
            }
            "/houses/native-assembly-capability" => Ok(json!(magna_urbis_houses::plans::assembly::ASSEMBLY_CAPABILITY)),
            "/houses/assemble-pair" => {
                if body.len()>32*1024*1024{return Err("Native assembly input exceeds 32 MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_pair_request(body)?;
                serde_json::to_value(magna_urbis_houses::plans::assembly::assemble_pair(input)?).map_err(|e|e.to_string())
            }
            "/houses/unpack-assembly" => {
                if body.len()>32*1024*1024{return Err("Native assembly archive exceeds 32 MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_archive(body)?;
                serde_json::to_value(magna_urbis_houses::plans::assembly::unpack_assembly(input)?).map_err(|e|e.to_string())
            }
            "/houses/realize-assembly" => {
                if body.len()>32*1024*1024{return Err("Native assembly archive exceeds 32 MiB".into());}
                let input=magna_urbis_houses::plans::assembly::transport::parse_realize_request(body)?;
                serde_json::to_value(magna_urbis_houses::plans::assembly::realize_assembly(input)?).map_err(|e|e.to_string())
            }
            "/houses/realize-plan" => {
                let input = decode(body)?;
                serde_json::to_value(magna_urbis_houses::plans::realize_plan(input)?)
                    .map_err(|e| e.to_string())
            }
            "/houses/style-index" => {
                serde_json::to_value(magna_urbis_houses::style_index::style_index()?)
                    .map_err(|e| e.to_string())
            }
            "/houses/profiles" => {
                serde_json::to_value(magna_urbis_houses::placement::admissibility_profiles()?)
                    .map_err(|e| e.to_string())
            }
            "/houses/enrich" => {
                let input = decode(body)?;
                serde_json::to_value(magna_urbis_houses::placement::enrich_placement(input)?)
                    .map_err(|e| e.to_string())
            }
            "/houses/generate" => {
                let config: HouseConfig = decode(body)?;
                magna_urbis_houses::preflight(config.clone())?;
                serde_json::to_value(magna_urbis_houses::generate_batch(config)?)
                    .map_err(|e| e.to_string())
            }
            _ => Err("OpÃƒÆ’Ã‚Â©ration maisons inconnue.".into()),
        }
    })();
    match result {
        Ok(data) => {
            let reply=json_reply(json!({"ok": true, "data": data}))?;
            if (path.ends_with("assembly") || path=="/houses/assemble-pair" || matches!(path,"/houses/plan-parent-batch"|"/houses/unpack-parent"|"/houses/realize-parent"|"/houses/unpack-parent-batch"|"/houses/begin-parent-session"|"/houses/plan-parent-session"|"/houses/ack-parent-session"|"/houses/abort-parent-session"|"/houses/release-parent-session")) && reply.body.len()>64*1024*1024 {
                return json_reply(json!({"ok":false,"error":{"code":"output_budget","field":null,"message":"Native assembly response exceeds 64 MiB"}}));
            }
            Ok(reply)
        },
        Err(message) => json_reply(
            json!({"ok": false, "error": {"code": "native_error", "field": null, "message": message}}),
        ),
    }
}

// Catch while the session guard is still held: unwinding past it poisons the
// mutex and leaves both this request and later retained-source reads unusable.
fn urban_guard<T>(state: &mut Session, work: impl FnOnce(&mut Session) -> ApiResult<T>) -> ApiResult<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(state))) {
        Ok(result) => result,
        Err(panic) => {
            state.layouts = None;
            state.urban.invalidate_layouts();
            let message = panic.downcast_ref::<String>().map(String::as_str)
                .or_else(|| panic.downcast_ref::<&str>().copied()).unwrap_or("unknown panic");
            eprintln!("[urban_panic] {message}");
            Err("[urban_panic] Urban generation failed; regenerate the urban plan.".into())
        }
    }
}

fn dispatch(path: &str, body: &[u8], sessions: &Mutex<Sessions>) -> ApiResult<Reply> {
    if path == "/status" {
        return json_reply(
            json!({"ok": true, "service": "magna-urbis-local", "backend": "rust-native", "version": 1,
                "capabilities": ["urban.programme", "urban.programme-functions-v1", "urban.building-sites", "urban.building-site-pages", "urban.building-site-read", "urban.built-capacity", "urban.architecture-culture", "urban.house-mix", "urban.retained-source", "urban.display-buffers",
                    "houses.placement", "houses.profiles", "houses.enrich", "houses.config-template", "houses.workshop-template", "houses.parcel-fit", "houses.compact-plans", "houses.style-index", "houses.native-minimum-candidates-v1", "houses.functional-choices-v1", "houses.native-assembly-pair-1", "houses.native-assembly-std-json-v1", "houses.native-parent-batch-1", "houses.native-parent-session-1"]}),
        );
    }
    if path == "/raster" {
        return raster_upload(body, sessions);
    }
    if path.starts_with("/houses/") {
        return houses_reply(path, body);
    }
    let input: Value = decode(body)?;
    if path == "/urban" && input["kind"] != "quarters"
        && input.pointer("/layoutConfig/programme/functions").is_some_and(|value| !value.is_null()) {
        return Err("Les fonctions du lieu se rÃƒÆ’Ã‚Â¨glent en rÃƒÆ’Ã‚Â©gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rant les quartiers ; cette ÃƒÆ’Ã‚Â©tape ne peut pas appliquer un nouveau programme de plan.".into());
    }
    let source = input
        .get("source")
        .map(value::<UrbanSourceHandle>)
        .transpose()?;
    if path == "/urban"
        && matches!(
            input["kind"].as_str(),
            Some("displayBuffers" | "buildingSitesBegin" | "buildingSitesPage" | "buildingSite")
        )
        && source.is_none()
    {
        return Err("[urban_source_invalid] This urban read requires a retained source.".into());
    }
    let id = if let Some(source) = source.as_ref() {
        source.validate_shape()?;
        if path != "/urban"
            || !matches!(
                input["kind"].as_str(),
                Some(
                    "buildingSites"
                        | "displayBuffers"
                        | "buildingSitesBegin"
                        | "buildingSitesPage"
                        | "buildingSite"
                )
            )
        {
            return Err("[urban_source_invalid] Unsupported retained urban read kind.".into());
        }
        if ["layouts", "partitions", "raster", "layoutsId"]
            .iter()
            .any(|key| input.get(key).is_some())
        {
            return Err(
                "[urban_source_invalid] Use either a retained source or explicit geometry.".into(),
            );
        }
        if input
            .get("session")
            .is_some_and(|session| session.as_str() != Some(source.session.as_str()))
        {
            return Err("[urban_source_invalid] Session does not match retained source.".into());
        }
        source.session.clone()
    } else {
        input["session"].as_str().ok_or("Session absente.")?.into()
    };
    if path == "/release" {
        sessions
            .lock()
            .map_err(|_| "Sessions indisponibles.")?
            .entries
            .remove(&id);
        return json_reply(json!({"ok": true}));
    }
    let session = {
        let mut sessions = sessions.lock().map_err(|_| "Sessions indisponibles.")?;
        if source.is_some() {
            sessions.existing(&id)?
        } else {
            sessions.get(&id)?
        }
    };
    let mut state = session.lock().map_err(|_| "Session indisponible.")?;
    match path {
        "/terrain" => terrain_reply(value(&input)?, &mut state),
        "/settlements" => settlement_reply(input, &state),
        "/urban" => urban_guard(&mut state, |state| urban_reply(input, state, &id)),
        _ => Err("Point dÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢entrÃƒÆ’Ã‚Â©e local inconnu.".into()),
    }
}

fn local_origin(origin: &str) -> bool {
    if matches!(
        origin,
        "null" | "tauri://localhost" | "https://tauri.localhost" | "http://tauri.localhost"
    ) {
        return true;
    }
    origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .is_some_and(|host| {
            host == "localhost"
                || host.starts_with("localhost:")
                || host == "127.0.0.1"
                || host.starts_with("127.0.0.1:")
                || host == "[::1]"
                || host.starts_with("[::1]:")
        })
}
fn respond(
    stream: &mut TcpStream,
    status: &str,
    origin: &str,
    reply: Reply,
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        reply.kind,
        reply.body.len()
    )?;
    if !origin.is_empty() {
        write!(
            stream,
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n"
        )?;
    }
    write!(stream, "\r\n")?;
    stream.write_all(&reply.body)
}
const MAX_NATIVE_ASSEMBLY_BODY:usize=32*1024*1024;
fn native_assembly_body_budget(path:&str,length:usize)->bool {
    !matches!(path,"/houses/assemble-pair"|"/houses/unpack-assembly"|"/houses/realize-assembly"|"/houses/native-assembly-capability"|"/houses/plan-parent-batch"|"/houses/unpack-parent"|"/houses/realize-parent"|"/houses/unpack-parent-batch"|"/houses/begin-parent-session"|"/houses/plan-parent-session"|"/houses/ack-parent-session"|"/houses/abort-parent-session"|"/houses/release-parent-session")
        ||length<=MAX_NATIVE_ASSEMBLY_BODY
}
fn respond_result(stream: &mut TcpStream, origin: &str, result: ApiResult<Reply>) {
    match result {
        Ok(reply) => { let _ = respond(stream, "200 OK", origin, reply); }
        Err(error) => {
            let status = if error.starts_with("[urban_panic]") { "500 Internal Server Error" } else { "400 Bad Request" };
            if let Ok(reply) = json_reply(json!({"error": error})) {
                let _ = respond(stream, status, origin, reply);
            }
        }
    }
}
fn handle(mut stream: TcpStream, sessions: &Mutex<Sessions>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(120)));
    let mut bytes = Vec::with_capacity(8192);
    let mut scratch = [0; 8192];
    let (head_end, header) = loop {
        match stream.read(&mut scratch) {
            Ok(0) | Err(_) => return,
            Ok(n) => bytes.extend_from_slice(&scratch[..n]),
        }
        if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
            if end > 16384 {
                return;
            }
            break (end + 4, String::from_utf8_lossy(&bytes[..end]).into_owned());
        }
        if bytes.len() > 16384 {
            return;
        }
    };
    let mut lines = header.lines();
    let mut request = lines.next().unwrap_or("").split_whitespace();
    let method = request.next().unwrap_or("");
    let path = request.next().unwrap_or("").split('?').next().unwrap_or("");
    let mut length = 0;
    let mut origin = "";
    let mut host = "";
    for line in lines {
        if let Some((name, val)) = line.split_once(':') {
            let val = val.trim();
            if name.eq_ignore_ascii_case("content-length") {
                length = val.parse().unwrap_or(MAX_BODY + 1);
            }
            if name.eq_ignore_ascii_case("origin") {
                origin = val;
            }
            if name.eq_ignore_ascii_case("host") {
                host = val;
            }
        }
    }
    let valid_host = local_origin(&format!("http://{host}"));
    if (!origin.is_empty() && !local_origin(origin)) || !valid_host {
        let _ = respond(
            &mut stream,
            "403 Forbidden",
            "",
            Reply {
                kind: "text/plain",
                body: b"Local clients only".to_vec(),
            },
        );
        return;
    }
    if method == "OPTIONS" {
        let _ = respond(
            &mut stream,
            "204 No Content",
            origin,
            Reply {
                kind: "text/plain",
                body: vec![],
            },
        );
        return;
    }
    // Route-specific limit BEFORE reading/allocating the complete body or
    // JSON extraction. Only the bounded header/prefetch buffer exists here.
    if !native_assembly_body_budget(path,length) {
        if let Ok(reply)=json_reply(json!({"ok":false,"error":{"code":"input_budget","field":null,"message":"Native assembly HTTP body exceeds 32 MiB"}})) {
            let _=respond(&mut stream,"413 Payload Too Large",origin,reply);
        }
        return;
    }
    if length > MAX_BODY || !matches!(method, "GET" | "POST") {
        let _ = respond(
            &mut stream,
            "400 Bad Request",
            origin,
            Reply {
                kind: "text/plain",
                body: b"Invalid request".to_vec(),
            },
        );
        return;
    }
    while bytes.len() - head_end < length {
        let remaining = length - (bytes.len() - head_end);
        let chunk = remaining.min(scratch.len());
        match stream.read(&mut scratch[..chunk]) {
            Ok(0) | Err(_) => return,
            Ok(n) => bytes.extend_from_slice(&scratch[..n]),
        }
    }
    respond_result(&mut stream, origin, dispatch(path, &bytes[head_end..head_end + length], sessions));
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Leave two cores to the desktop: rayon's global pool reads this on first use.
    if std::env::var_os("RAYON_NUM_THREADS").is_none() {
        let n = std::thread::available_parallelism().map_or(2, |n| n.get());
        // SAFETY: single-threaded here, before any thread or pool is spawned.
        unsafe { std::env::set_var("RAYON_NUM_THREADS", n.saturating_sub(2).max(1).to_string()) };
    }
    let mut addr: SocketAddr = std::env::var("MAGNA_LOCAL_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8791".into())
        .parse()?;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--port" {
            addr.set_port(args.next().ok_or("--port requires a number")?.parse()?);
        } else {
            return Err(format!("Unknown argument: {arg}").into());
        }
    }
    if !addr.ip().is_loopback() {
        return Err("The local engine must bind to a loopback address.".into());
    }
    let listener = TcpListener::bind(addr)?;
    println!(
        "{}",
        json!({"ready": true, "port": listener.local_addr()?.port()})
    );
    let sessions = Arc::new(Mutex::new(Sessions::default()));
    let active = Arc::new(AtomicUsize::new(0));
    let concurrency = std::thread::available_parallelism()
        .map_or(2, |n| n.get())
        .clamp(2, 8);
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        if active.fetch_add(1, Ordering::Relaxed) >= concurrency {
            active.fetch_sub(1, Ordering::Relaxed);
            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
            let _ = respond(
                &mut stream,
                "503 Service Unavailable",
                "",
                Reply {
                    kind: "text/plain",
                    body: b"Local engine busy; retry shortly".to_vec(),
                },
            );
            continue;
        }
        let sessions = Arc::clone(&sessions);
        let active = Arc::clone(&active);
        std::thread::spawn(move || {
            // A failing request must release its slot and preserve the service.
            let _ = std::panic::catch_unwind(|| handle(stream, &sessions));
            active.fetch_sub(1, Ordering::Relaxed);
        });
    }
    Ok(())
}

#[cfg(test)]
mod native_assembly_boundary_tests {
    use super::*;
    fn request_signature(v:&Value)->std::collections::BTreeMap<String,String>{
        fn walk(v:&Value,path:&str,out:&mut std::collections::BTreeMap<String,String>){
            let scalar=match v{
                Value::Number(n) if n.is_f64()=>Some(format!("f64:{:016x}",n.as_f64().unwrap().to_bits())),
                Value::Number(n)=>Some(format!("integer:{n}")),
                Value::String(s)=>Some(format!("string:{s}")),Value::Bool(b)=>Some(format!("bool:{b}")),Value::Null=>Some("null".into()),
                Value::Array(a)=>{out.insert(path.into(),format!("array:{}",a.len()));for (i,v) in a.iter().enumerate(){walk(v,&format!("{path}/{i}"),out);}None},
                Value::Object(a)=>{out.insert(path.into(),format!("object:{}",a.len()));for (k,v) in a{walk(v,&format!("{path}/{}",k.replace('~',"~0").replace('/',"~1")),out);}None},
            };if let Some(s)=scalar{out.insert(path.into(),s);}
        }
        let mut out=std::collections::BTreeMap::new();walk(v,"",&mut out);out
    }
    #[test]
    fn native_assembly_local_capability_and_archive_gate_are_explicit(){
        let legacy:Value=decode(br#"{"x":100.00000000119209}"#).unwrap();
        assert_eq!(legacy["x"].as_f64().unwrap().to_bits(),0x40590000000147ad);
        assert!(!native_assembly_body_budget("/houses/assemble-pair",MAX_NATIVE_ASSEMBLY_BODY+1));
        assert!(native_assembly_body_budget("/houses/plans",MAX_NATIVE_ASSEMBLY_BODY+1));
        let reply=dispatch("/status",b"{}",&Mutex::new(Sessions::default())).unwrap();
        let status:Value=serde_json::from_slice(&reply.body).unwrap();
        assert!(status["capabilities"].as_array().unwrap().iter().any(|v|v.as_str()==Some("houses.native-assembly-pair-1")));
        assert!(status["capabilities"].as_array().unwrap().iter().any(|v|v.as_str()==Some("houses.native-assembly-std-json-v1")));
        let reply=houses_reply("/houses/native-assembly-capability",b"{}").unwrap();
        let value:Value=serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(value["data"],"native-assembly-pair-1");
        let bad=br#"{"format":"old-single","sha256":"not-a-signature","payload":null}"#;
        let reply=houses_reply("/houses/unpack-assembly",bad).unwrap();
        let value:Value=serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(value["ok"],false);assert!(value["data"].is_null());
    }
    #[test]
    fn native_assembly_local_public_std_positive_is_standalone(){
        // Small root-validated native records on a SYNTHETIC site; this is a
        // public protocol regression, never a Java/capacity benchmark.
        let sessions=Mutex::new(Sessions::default());
        let status:Value=serde_json::from_slice(&dispatch("/status",b"{}",&sessions).unwrap().body).unwrap();
        for cap in ["houses.native-assembly-pair-1","houses.native-assembly-std-json-v1"]{
            assert!(status["capabilities"].as_array().unwrap().iter().any(|v|v.as_str()==Some(cap)));
        }
        let bytes=include_bytes!("../../houses/tests/fixtures/native-assembly-public-input.json");
        let expected_signature:Value=serde_json::from_slice(include_bytes!("../../houses/tests/fixtures/native-assembly-public-signature.json")).unwrap();
        let parsed=magna_urbis_houses::plans::assembly::transport::parse_pair_request(bytes).unwrap();
        assert_eq!(serde_json::to_value(request_signature(&serde_json::to_value(&parsed).unwrap())).unwrap(),expected_signature);
        let reply=dispatch("/houses/assemble-pair",bytes,&sessions).unwrap();
        let result:Value=serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(result["ok"],true);assert_eq!(result["data"]["outcome"],"assembled");
        let data=&result["data"];assert_eq!(data["assembly"]["members"].as_array().unwrap().len(),2);
        assert_eq!(data["assembly"]["circulation"]["branches"][1]["target"]["kind"],"member_branch_cap");
        assert!(data["assembly"]["outcome"]["housed_households"].is_null());
        assert!(data["assembly"]["outcome"]["actual_useful_m2"].is_null());
        let archive=data["archive"].clone();
        let expected:Value=serde_json::from_slice(include_bytes!("../../houses/tests/fixtures/native-assembly-public-archive.json")).unwrap();
        assert_eq!(archive,expected,"whole native authority, not a projection, must match");
        let unpack=dispatch("/houses/unpack-assembly",&serde_json::to_vec(&archive).unwrap(),&sessions).unwrap();
        let unpack:Value=serde_json::from_slice(&unpack.body).unwrap();assert_eq!(unpack["ok"],true);
        assert_eq!(unpack["data"]["members"].as_array().unwrap().len(),2);
        let detail=dispatch("/houses/realize-assembly",&serde_json::to_vec(&json!({"assembly":archive,"interiors":true})).unwrap(),&sessions).unwrap();
        let detail:Value=serde_json::from_slice(&detail.body).unwrap();assert_eq!(detail["ok"],true,"{detail}");
        assert_eq!(detail["data"]["members"].as_array().unwrap().len(),2);
        for member in detail["data"]["members"].as_array().unwrap(){
            let units=member["architecture"]["units"].as_array().unwrap();assert_eq!(units.len(),1);
            assert!(!units[0]["access"]["portals"].as_array().unwrap().is_empty());
            assert!(!units[0]["roofs"]["faces"].as_array().unwrap().is_empty());
        }
    }

}
