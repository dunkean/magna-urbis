//! Small loopback service sharing the exact native crates with the browser builds.
//! Independent sessions retain terrain/urban layouts; rasters cross the boundary as bytes.
use magna_urbis_core::{TerrainGenerator, TerrainZones, settlements, urban};
use magna_urbis_houses::{catalogue, model::HouseConfig};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

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
    layouts: Option<(u64, Vec<urban::Layout>)>,
}
#[derive(Default)]
struct Sessions {
    clock: u64,
    entries: HashMap<String, (u64, Arc<Mutex<Session>>)>,
}
impl Sessions {
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
                None => return Err("Toutes les sessions locales sont occupées. Réessayez.".into()),
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
        return Err("Le neuronal utilise son service GPU dédié ; ce point d’entrée prépare le terrain procédural.".into());
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
                "L’esquisse doit être appliquée après la génération native par l’adaptateur."
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
    let count = header
        .n
        .checked_mul(header.n)
        .filter(|_| (16..=1024).contains(&header.n))
        .ok_or("Résolution invalide.")?;
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
    json_reply(json!({"ok": true, "session": header.session}))
}

fn settlement_reply(input: Value, state: &Session) -> ApiResult<Reply> {
    let terrain = state
        .settlements
        .as_ref()
        .ok_or("Générez le terrain avant les lieux et routes.")?;
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

fn urban_reply(input: Value, state: &mut Session) -> ApiResult<Reply> {
    let seed = input["seed"].as_str().ok_or("Graine absente.")?;
    let started = Instant::now();
    if input["kind"] == "quarters" {
        state.layouts = None;
        let terrain = state
            .settlements
            .as_ref()
            .ok_or("Générez le terrain avant les quartiers.")?;
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
        let retained = decode(&serde_json::to_vec(&result["layouts"]).map_err(|e| e.to_string())?)?;
        state.layouts = Some((input["id"].as_u64().ok_or("ID invalide.")?, retained));
        json_reply(result)
    } else if input["kind"] == "parcels" {
        if state.settlements.is_none() {
            return Err("Générez le terrain avant les quartiers.".into());
        }
        let explicit: Option<Vec<urban::Layout>> = input.get("layouts").map(value).transpose()?;
        let empty = Vec::new();
        let layouts = match explicit.as_ref() {
            Some(layouts) => layouts,
            None if input.get("layoutsId").is_none() => &empty,
            None => {
                &state
                    .layouts
                    .as_ref()
                    .filter(|(id, _)| Some(*id) == input["layoutsId"].as_u64())
                    .ok_or("Le plan a changé. Régénérez les quartiers avant les parcelles.")?
                    .1
            }
        };
        let config: urban::ParcelConfig = value(&input["parcelConfig"])?;
        let partitions = urban::generate_parcels(seed, layouts, &config)?;
        json_reply(json!({"id": input["id"], "partitions": partitions, "ms": millis(started)}))
    } else {
        Err("Étape urbaine inconnue.".into())
    }
}

fn houses_reply(path: &str, body: &[u8]) -> ApiResult<Reply> {
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
            "/houses/generate" => {
                let config: HouseConfig = decode(body)?;
                magna_urbis_houses::preflight(config.clone())?;
                serde_json::to_value(magna_urbis_houses::generate_batch(config)?)
                    .map_err(|e| e.to_string())
            }
            _ => Err("Opération maisons inconnue.".into()),
        }
    })();
    match result {
        Ok(data) => json_reply(json!({"ok": true, "data": data})),
        Err(message) => json_reply(
            json!({"ok": false, "error": {"code": "native_error", "field": null, "message": message}}),
        ),
    }
}

fn dispatch(path: &str, body: &[u8], sessions: &Mutex<Sessions>) -> ApiResult<Reply> {
    if path == "/status" {
        return json_reply(
            json!({"ok": true, "service": "magna-urbis-local", "backend": "rust-native", "version": 1}),
        );
    }
    if path == "/raster" {
        return raster_upload(body, sessions);
    }
    if path.starts_with("/houses/") {
        return houses_reply(path, body);
    }
    let input: Value = decode(body)?;
    let id = input["session"].as_str().ok_or("Session absente.")?;
    if path == "/release" {
        sessions
            .lock()
            .map_err(|_| "Sessions indisponibles.")?
            .entries
            .remove(id);
        return json_reply(json!({"ok": true}));
    }
    let session = sessions
        .lock()
        .map_err(|_| "Sessions indisponibles.")?
        .get(id)?;
    let mut state = session.lock().map_err(|_| "Session indisponible.")?;
    match path {
        "/terrain" => terrain_reply(value(&input)?, &mut state),
        "/settlements" => settlement_reply(input, &state),
        "/urban" => urban_reply(input, &mut state),
        _ => Err("Point d’entrée local inconnu.".into()),
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
    match dispatch(path, &bytes[head_end..head_end + length], sessions) {
        Ok(reply) => {
            let _ = respond(&mut stream, "200 OK", origin, reply);
        }
        Err(error) => {
            if let Ok(reply) = json_reply(json!({"error": error})) {
                let _ = respond(&mut stream, "400 Bad Request", origin, reply);
            }
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
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
