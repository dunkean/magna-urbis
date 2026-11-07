//! Retained native relief engine of the local profile: the browser `TerrainEngine`
//! (construction, sketch edit, coast, sampling) kept in a session, so camera and
//! water requests never upload the source again and nothing runs in WASM.
//!
//! `POST /terrain/relief`. Request: u32 LE header length, JSON header padded with
//! spaces to a multiple of 4, then at most one raw little-endian f32 plane.
//! Header: `session`, `op` (`build` | `edit` | `coast` | `read`), `tuning` (erosion
//! overrides in `EROSION_TUNING` order, null = relief default) and the operation's
//! fields. Reply: the same framing; the header carries the engine metadata and the
//! descriptors of the planes that follow (f32 planes first, then u8 planes).
//!
//! A session lives in the shared `Sessions` map and its LRU eviction; only `build`
//! creates one, the other operations report `[relief_session_missing]` so the client
//! replays its construction instead of reading an empty engine.

use super::{ApiResult, Region, Reply, Session, Sessions, decode, extend_f32_le};
use magna_urbis_core::{TerrainGenerator, TerrainZones};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Mutex;

const INCOMPLETE: &str = "Relief request incomplete.";
const MISSING: &str = "[relief_session_missing] Retained relief session expired; rebuild it.";

#[derive(Deserialize)]
struct Header {
    session: String,
    op: String,
    #[serde(default)]
    tuning: Vec<Option<f64>>,
}

/// The WASM constructors used by the local profile: `with_source`, `with_surface`, `with_zoned_surface`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Build {
    kind: String,
    seed: String,
    width: f64,
    #[serde(default)]
    relief: String,
    #[serde(default)]
    erosion: f64,
    #[serde(default)]
    motif_size: f64,
    #[serde(default)]
    mountain_mix: f64,
    environment: Option<String>,
    zones: Option<TerrainZones>,
}

/// `set_coast`, or with `surface` the prepared plane: `configure_coast` + `set_coast_surface`.
#[derive(Deserialize)]
struct Coast {
    mask: u32,
    mode: String,
    #[serde(default)]
    surface: bool,
}

#[derive(Deserialize)]
struct Read {
    region: Option<Region>,
    #[serde(default)]
    physical: bool,
    #[serde(default)]
    base: bool,
    #[serde(default)]
    cave: bool,
}

pub(crate) fn handle(body: &[u8], sessions: &Mutex<Sessions>) -> ApiResult<Reply> {
    let header_len = u32::from_le_bytes(body.get(..4).ok_or(INCOMPLETE)?.try_into().map_err(|_| INCOMPLETE)?) as usize;
    let end = 4_usize.checked_add(header_len).ok_or(INCOMPLETE)?;
    let raw = body.get(4..end).ok_or(INCOMPLETE)?;
    let header: Header = decode(raw)?;
    let data = &body[end..];
    if data.len() % 4 != 0 {
        return Err("Relief plane misaligned.".into());
    }
    let plane: Vec<f32> = data.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    let session = {
        let mut sessions = sessions.lock().map_err(|_| "Sessions unavailable.")?;
        if header.op != "build" && !sessions.entries.contains_key(&header.session) {
            return Err(MISSING.into());
        }
        sessions.get(&header.session)?
    };
    let mut state = session.lock().map_err(|_| "Session unavailable.")?;
    // Tuning is thread-local in core: install this operation's overrides, then clear them.
    let tuning: Vec<f64> = header.tuning.iter().map(|v| v.unwrap_or(f64::NAN)).collect();
    magna_urbis_core::set_erosion_tuning(&tuning);
    let result = apply(&header.op, raw, plane, &mut state);
    magna_urbis_core::set_erosion_tuning(&[]);
    result
}

fn apply(op: &str, raw: &[u8], plane: Vec<f32>, state: &mut Session) -> ApiResult<Reply> {
    match op {
        "build" => {
            let build: Build = decode(raw)?;
            // Free the previous engine and the `/terrain` cache before allocating the next one.
            state.terrain = None;
            state.terrain_key.clear();
            state.field = Vec::new();
            let generator = match build.kind.as_str() {
                "source" => TerrainGenerator::new_mixed_with_source(&build.seed, build.width, &build.relief, build.erosion,
                    build.motif_size, build.mountain_mix, plane, build.environment.as_deref())?,
                "surface" => TerrainGenerator::with_surface_owned(&build.seed, build.width, plane)?,
                "zonedSurface" => TerrainGenerator::with_zoned_surface(&build.seed, build.width, build.motif_size, &plane,
                    build.zones.as_ref().ok_or("Zoned relief surface without zones.")?)?,
                _ => return Err("Unknown relief build kind.".into()),
            };
            reply(state.terrain.insert(generator), Vec::new(), Vec::new(), Value::Null)
        }
        "edit" => {
            let terrain = state.terrain.as_mut().ok_or(MISSING)?;
            terrain.set_edited_surface(&plane)?;
            reply(terrain, Vec::new(), Vec::new(), Value::Null)
        }
        "coast" => {
            let coast: Coast = decode(raw)?;
            if coast.mask > 255 {
                return Err("Invalid coast mask (integer 0 to 255).".into());
            }
            let terrain = state.terrain.as_mut().ok_or(MISSING)?;
            if coast.surface {
                terrain.configure_coast(coast.mask, &coast.mode)?;
                terrain.set_coast_surface(&plane)?;
            } else {
                terrain.set_coast(coast.mask, &coast.mode)?;
            }
            reply(terrain, Vec::new(), Vec::new(), Value::Null)
        }
        "read" => {
            let read: Read = decode(raw)?;
            let terrain = state.terrain.as_ref().ok_or(MISSING)?;
            let (mut floats, mut bytes, mut region) = (Vec::new(), Vec::new(), Value::Null);
            if let Some(r) = read.region {
                let data = terrain.sample_region(r.x, r.y, r.extent, r.resolution)?;
                region = json!({"x": data.x, "y": data.y, "width": data.width, "resolution": data.resolution,
                    "minHeight": data.min_height, "maxHeight": data.max_height});
                floats.extend([("height", data.height), ("normalX", data.normal_x), ("normalY", data.normal_y), ("normalZ", data.normal_z)]);
                bytes.push(("caveMask", data.cave_mask));
            }
            if read.physical {
                floats.push(("physical", terrain.physical_height_field()));
            }
            if read.base {
                floats.push(("base", terrain.sampling_base_field()));
            }
            if read.cave {
                bytes.push(("physicalCave", terrain.physical_cave_field()));
            }
            reply(terrain, floats, bytes, region)
        }
        _ => Err("Unknown relief operation.".into()),
    }
}

/// Engine metadata (the WASM getters the bridge reads synchronously), then the planes.
fn reply(terrain: &TerrainGenerator, floats: Vec<(&str, Vec<f32>)>, bytes: Vec<(&str, Vec<u8>)>, region: Value) -> ApiResult<Reply> {
    let arrays: Vec<Value> = floats.iter().map(|(name, data)| json!({"name": name, "type": "f32", "count": data.len()}))
        .chain(bytes.iter().map(|(name, data)| json!({"name": name, "type": "u8", "count": data.len()})))
        .collect();
    let header = json!({"sourceN": terrain.source_resolution(), "minHeight": terrain.min_height(), "maxHeight": terrain.max_height(),
        "erosionSpacing": terrain.erosion_spacing(), "samplingParameters": terrain.sampling_parameters(),
        "region": region, "arrays": arrays});
    let mut encoded = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
    encoded.resize(encoded.len().next_multiple_of(4), b' ');
    let size: usize = floats.iter().map(|(_, d)| d.len() * 4).sum::<usize>() + bytes.iter().map(|(_, d)| d.len()).sum::<usize>();
    let mut body = Vec::with_capacity(4 + encoded.len() + size);
    body.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
    body.extend_from_slice(&encoded);
    for (_, data) in &floats {
        extend_f32_le(&mut body, data);
    }
    for (_, data) in &bytes {
        body.extend_from_slice(data);
    }
    Ok(Reply { kind: "application/octet-stream", body })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(header: Value, plane: &[f32]) -> Vec<u8> {
        let mut encoded = serde_json::to_vec(&header).unwrap();
        encoded.resize(encoded.len().next_multiple_of(4), b' ');
        let mut body = (encoded.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(&encoded);
        extend_f32_le(&mut body, plane);
        body
    }

    /// Header and named f32 planes of a reply.
    fn planes(body: &[u8]) -> (Value, Vec<(String, Vec<f32>)>) {
        let len = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&body[4..4 + len]).unwrap();
        let mut offset = 4 + len;
        let mut out = Vec::new();
        for array in header["arrays"].as_array().unwrap() {
            let count = array["count"].as_u64().unwrap() as usize;
            if array["type"] == "f32" {
                let values = body[offset..offset + count * 4].as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
                out.push((array["name"].as_str().unwrap().to_string(), values));
                offset += count * 4;
            } else {
                offset += count;
            }
        }
        assert_eq!(offset, body.len());
        (header, out)
    }

    #[test]
    fn retained_surface_samples_like_the_generator() {
        let n = 64;
        let surface: Vec<f32> = (0..n * n)
            .map(|i| ((i % n) as f32 * 0.21).sin() * 40.0 + ((i / n) as f32 * 0.13).cos() * 25.0 + 10.0)
            .collect();
        let sessions = Mutex::new(Sessions::default());
        let missing = handle(&request(json!({"session": "relief-test", "op": "read", "physical": true}), &[]), &sessions);
        assert!(missing.err().unwrap().contains("relief_session_missing"));
        let built = handle(&request(json!({"session": "relief-test", "op": "build", "kind": "surface", "seed": "s", "width": 2000.0}), &surface), &sessions).unwrap();
        let (meta, _) = planes(&built.body);
        assert_eq!(meta["sourceN"], n);
        let read = json!({"session": "relief-test", "op": "read", "region": {"x": 250.0, "y": 0.0, "extent": 1500.0, "resolution": 64}, "physical": true, "base": true});
        let (meta, arrays) = planes(&handle(&request(read, &[]), &sessions).unwrap().body);

        let reference = TerrainGenerator::with_surface_owned("s", 2000.0, surface.clone()).unwrap();
        let expected = reference.sample_region(250.0, 0.0, 1500.0, 64).unwrap();
        let get = |name: &str| arrays.iter().find(|(key, _)| key == name).unwrap().1.clone();
        let bits = |values: &[f32]| values.iter().map(|v| v.to_bits()).collect::<Vec<_>>();
        assert_eq!(bits(&get("height")), bits(&expected.height));
        assert_eq!(bits(&get("normalZ")), bits(&expected.normal_z));
        assert_eq!(bits(&get("physical")), bits(&reference.physical_height_field()));
        assert_eq!(bits(&get("base")), bits(&reference.sampling_base_field()));
        assert_eq!(meta["region"]["resolution"], 64);
        assert!((meta["maxHeight"].as_f64().unwrap() - reference.max_height()).abs() < 1e-9);
        assert!((meta["minHeight"].as_f64().unwrap() - reference.min_height()).abs() < 1e-9);
    }
}
