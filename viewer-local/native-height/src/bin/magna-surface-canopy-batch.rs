//! Exact scalar port of SurfaceCanopy's renderer-only TOP atlas rasterizer.
//! This does not choose, move, thin or generate a tree. Godot still makes mips.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path, time::Instant};
type Result<T> = std::result::Result<T, String>;
const VERSION: &str = "native-canopy-raster-1";
const MAX_WIRE: usize = 256 * 1024 * 1024;
const MAX_KNOWN: usize = 384 * 1024 * 1024;
const MAX_TREES: usize = 100_000;
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Mask {
    width: usize,
    height: usize,
    origin_x: f64,
    origin_z: f64,
    spacing: f64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: String,
    job: Value,
    width: usize,
    height: usize,
    origin_x: f64,
    origin_z: f64,
    spacing: f64,
    tree_count: usize,
    mask: Option<Mask>,
}
fn sha(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn u32le(b: &[u8]) -> usize {
    u32::from_le_bytes(b.try_into().unwrap()) as usize
}
fn finite(v: f64) -> bool {
    v.is_finite()
}
fn decode(bytes: &[u8]) -> Result<(Request, usize, usize)> {
    if bytes.len() < 16 || bytes.len() > MAX_WIRE || &bytes[..8] != b"MUCIN001" {
        return Err("input framing/budget".into());
    }
    let j = u32le(&bytes[8..12]);
    let p = u32le(&bytes[12..16]);
    if j > 1024 * 1024 {
        return Err("manifest budget".into());
    }
    let start = (16 + j).div_ceil(8) * 8;
    if start > bytes.len()
        || start.checked_add(p) != Some(bytes.len())
        || bytes[16 + j..start].iter().any(|&x| x != 0)
    {
        return Err("input lengths/padding".into());
    }
    let r: Request = serde_json::from_slice(&bytes[16..16 + j]).map_err(|e| e.to_string())?;
    if r.version != VERSION
        || !(2..=2048).contains(&r.width)
        || !(2..=2048).contains(&r.height)
        || !r.width.is_power_of_two()
        || !r.height.is_power_of_two()
        || r.tree_count > MAX_TREES
        || !finite(r.origin_x)
        || !finite(r.origin_z)
        || !finite(r.spacing)
        || r.spacing <= 0.0
        || !r.job.is_object()
    {
        return Err("raster request shape/coordinates".into());
    }
    let mask_pixels = if let Some(m) = &r.mask {
        if !(2..=1024).contains(&m.width)
            || !(2..=1024).contains(&m.height)
            || !finite(m.origin_x)
            || !finite(m.origin_z)
            || !finite(m.spacing)
            || m.spacing <= 0.0
        {
            return Err("mask shape/coordinates".into());
        }
        m.width * m.height
    } else {
        0
    };
    let expected = r.tree_count * 8 * 8 + mask_pixels * 33;
    if p != expected {
        return Err("typed payload lengths".into());
    }
    let n = r.width * r.height;
    let known =
        bytes.len() + n * (if r.mask.is_some() { 52 } else { 36 }) + n * 4 + 32 * 1024 * 1024;
    if known > MAX_KNOWN {
        return Err("known native buffer budget".into());
    }
    Ok((r, start, known))
}
fn f64at(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn f32at(b: &[u8], o: usize) -> f32 {
    f32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
fn address(m: &Mask, x: f64, z: f64) -> Option<(usize, f64, f64)> {
    let gx = (x - m.origin_x) / m.spacing;
    let gz = (z - m.origin_z) / m.spacing;
    if gx < 0.0 || gz < 0.0 || gx > (m.width - 1) as f64 || gz > (m.height - 1) as f64 {
        return None;
    }
    let ix = (gx.floor() as usize).min(m.width - 2);
    let iz = (gz.floor() as usize).min(m.height - 2);
    // The GD address is a Vector3, so interpolation fractions first round to f32.
    Some((
        iz * m.width + ix,
        (gx - ix as f64) as f32 as f64,
        (gz - iz as f64) as f32 as f64,
    ))
}
fn sample(mask: &[u8], m: &Mask, a: (usize, f64, f64)) -> f64 {
    let (p, x, z) = a;
    lerp(
        lerp(mask[p] as f64, mask[p + 1] as f64, x),
        lerp(mask[p + m.width] as f64, mask[p + m.width + 1] as f64, x),
        z,
    ) / 255.0
}
fn response(bytes: &[u8], m: &Mask, a: (usize, f64, f64)) -> [f32; 4] {
    let (p, x, z) = a;
    let mut out = [0.; 4];
    for (k, v) in out.iter_mut().enumerate() {
        let at = |p: usize| f32at(bytes, (p * 4 + k) * 4) as f64;
        *v = lerp(
            lerp(at(p), at(p + 1), x),
            lerp(at(p + m.width), at(p + m.width + 1), x),
            z,
        ) as f32;
    }
    out
}
fn normal(v: [f32; 3]) -> [f32; 3] {
    let q = (v[0] * v[0] + v[1] * v[1]) + v[2] * v[2];
    if q == 0.0 {
        return [0.; 3];
    }
    let l = q.sqrt();
    [v[0] / l, v[1] / l, v[2] / l]
}
fn bin(r: f64) -> usize {
    let radii = [2.5, 4., 5.5, 7.];
    let mut b = 0;
    for i in 1..4 {
        if (r - radii[i]).abs() < (r - radii[b]).abs() {
            b = i
        }
    }
    b
}
struct Raster {
    coverage: Vec<f32>,
    counts: Vec<f32>,
    normals: Vec<f32>,
    colors: Vec<f32>,
    trees: usize,
    selected: usize,
    unsupported: usize,
}
fn raster(r: &Request, p: &[u8]) -> Result<Raster> {
    let n = r.width * r.height;
    let mut out = Raster {
        coverage: vec![0.; n],
        counts: vec![0.; n * 4],
        normals: vec![0.; n * 4],
        colors: if r.mask.is_some() {
            vec![0.; n * 4]
        } else {
            vec![]
        },
        trees: 0,
        selected: 0,
        unsupported: 0,
    };
    let mut crowns = vec![f32::NEG_INFINITY; n];
    let mut height_origin = None;
    let mut visited: usize = 0;
    let off = r.tree_count * 64;
    let mp = r.mask.as_ref().map(|m| m.width * m.height).unwrap_or(0);
    let mask = &p[off..off + mp];
    let normals = &p[off + mp..off + mp + mp * 16];
    let colors = &p[off + mp + mp * 16..];
    for chunk in p[..off].chunks_exact(8) {
        if !finite(f64at(chunk, 0)) {
            return Err("nonfinite tree value".into());
        }
    }
    for chunk in p[off + mp..].chunks_exact(4) {
        if !f32at(chunk, 0).is_finite() {
            return Err("nonfinite asset response".into());
        }
    }
    for i in 0..r.tree_count {
        let at = |k| f64at(p, (i * 8 + k) * 8);
        let x = at(0);
        let z = at(1);
        let radius = at(2);
        let y = at(3);
        let size = at(4);
        let angle = at(5);
        if ![0., 1.].contains(&at(6)) || ![0., 1.].contains(&at(7)) || size <= 0. || radius <= 0. {
            return Err("tree flags/dimensions".into());
        }
        let h0 = *height_origin.get_or_insert(y);
        if at(7) == 1. {
            out.unsupported += 1;
            continue;
        }
        let selected = at(6) == 1.;
        let b = bin(radius);
        let cosine = angle.cos();
        let sine = angle.sin();
        let support = radius * if r.mask.is_some() { 1.1 } else { 1. };
        out.trees += 1;
        if selected {
            out.selected += 1
        }
        let minz = (((z - support - r.origin_z) / r.spacing).ceil() as i64).max(0);
        let maxz =
            (((z + support - r.origin_z) / r.spacing).floor() as i64).min(r.height as i64 - 1);
        for iz in minz..=maxz {
            let dz = r.origin_z + iz as f64 * r.spacing - z;
            let half = (support * support - dz * dz).max(0.).sqrt();
            let minx = (((x - half - r.origin_x) / r.spacing).ceil() as i64).max(0);
            let maxx =
                (((x + half - r.origin_x) / r.spacing).floor() as i64).min(r.width as i64 - 1);
            visited = visited
                .checked_add((maxx - minx + 1).max(0) as usize)
                .ok_or("raster work overflow")?;
            if visited > 64 * 1024 * 1024 {
                return Err("canopy raster work budget".into());
            }
            for ix in minx..=maxx {
                let index = iz as usize * r.width + ix as usize;
                let dx = r.origin_x + ix as f64 * r.spacing - x;
                let location = if let Some(m) = &r.mask {
                    let a = address(
                        m,
                        (cosine * dx - sine * dz) / radius,
                        (sine * dx + cosine * dz) / radius,
                    );
                    if a.is_none() || sample(mask, m, a.unwrap()) < 0.5 {
                        continue;
                    }
                    a
                } else {
                    None
                };
                out.coverage[index] = 1.;
                let top = (1. - (dx * dx + dz * dz) / (radius * radius))
                    .max(0.)
                    .sqrt();
                let vr = size * 0.33;
                let crown = if r.mask.is_some() {
                    y - h0 + size * 0.5
                } else {
                    y - h0 + size * 0.72 + top * vr
                };
                if crown > crowns[index] as f64 {
                    crowns[index] = crown as f32;
                    let mut norm = normal([
                        (dx / radius) as f32,
                        (top * radius / vr.max(0.01)) as f32,
                        (dz / radius) as f32,
                    ]);
                    if let Some(m) = &r.mask {
                        let a = location.unwrap();
                        let nv = response(normals, m, a);
                        let cv = response(colors, m, a);
                        let alpha = nv[3].max(0.00001);
                        let scales = [radius as f32, size as f32, radius as f32];
                        let mut local = [0.; 3];
                        for k in 0..3 {
                            local[k] = ((nv[k] / alpha) * 2. - 1.) / scales[k]
                        }
                        norm = normal([
                            (cosine * local[0] as f64 + sine * local[2] as f64) as f32,
                            local[1],
                            (-sine * local[0] as f64 + cosine * local[2] as f64) as f32,
                        ]);
                        for k in 0..3 {
                            out.colors[index * 4 + k] =
                                (cv[k] as f64 / (cv[3] as f64).max(0.00001)) as f32
                        }
                        out.colors[index * 4 + 3] = 1.;
                    }
                    for k in 0..3 {
                        out.normals[index * 4 + k] = (norm[k] as f64 * 0.5 + 0.5) as f32
                    }
                    out.normals[index * 4 + 3] = 1.;
                }
                if selected {
                    out.counts[index * 4 + b] += 1.
                }
            }
        }
    }
    if out
        .normals
        .iter()
        .chain(&out.colors)
        .any(|x| !x.is_finite())
    {
        return Err("nonfinite output".into());
    }
    Ok(out)
}
fn plane_bytes(p: &[f32]) -> &[u8] {
    // Supported Windows/Linux targets are little endian. No allocating conversion.
    unsafe { std::slice::from_raw_parts(p.as_ptr().cast::<u8>(), p.len() * 4) }
}
fn run(input: &Path, output: &Path, expected: &str) -> Result<()> {
    if !cfg!(target_endian = "little") {
        return Err("little endian target required".into());
    }
    if output.exists() {
        return Err("existing output refused".into());
    }
    if fs::metadata(input).map_err(|e| e.to_string())?.len() > MAX_WIRE as u64 {
        return Err("input file budget".into());
    }
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    if sha(&bytes) != expected {
        return Err("input sha256".into());
    }
    let (r, start, known) = decode(&bytes)?;
    let started = Instant::now();
    let a = raster(&r, &bytes[start..])?;
    let planes = [&a.coverage, &a.counts, &a.normals, &a.colors];
    let mut digest = Sha256::new();
    for p in planes {
        digest.update(plane_bytes(p))
    }
    let payload_hash = format!("{:x}", digest.finalize());
    let lengths: Vec<_> = planes.iter().map(|p| p.len() * 4).collect();
    let total: usize = lengths.iter().sum();
    let extremes: Vec<Option<[f32; 2]>> = planes
        .iter()
        .map(|p| {
            if p.is_empty() {
                None
            } else {
                Some(p.iter().fold([f32::INFINITY, f32::NEG_INFINITY], |a, &v| {
                    [a[0].min(v), a[1].max(v)]
                }))
            }
        })
        .collect();
    let header=serde_json::to_vec(&serde_json::json!({"version":VERSION,"job":r.job,"inputSha256":expected,"payloadSha256":payload_hash,"width":r.width,"height":r.height,"planeBytes":lengths,"planeExtremes":extremes,"trees":a.trees,"selectedTrees":a.selected,"unsupportedTrees":a.unsupported,"nativeKnownBufferUpperBytes":known,"sampleMs":started.elapsed().as_secs_f64()*1000.})).map_err(|e|e.to_string())?;
    let temporary = output.with_extension(format!("partial-{}", std::process::id()));
    let result = (|| -> Result<()> {
        let mut f = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        f.write_all(b"MUCOUT01").map_err(|e| e.to_string())?;
        f.write_all(&(header.len() as u32).to_le_bytes())
            .map_err(|e| e.to_string())?;
        f.write_all(&(total as u32).to_le_bytes())
            .map_err(|e| e.to_string())?;
        f.write_all(&header).map_err(|e| e.to_string())?;
        f.write_all(&vec![
            0;
            (16 + header.len()).div_ceil(8) * 8 - 16 - header.len()
        ])
        .map_err(|e| e.to_string())?;
        for p in planes {
            f.write_all(plane_bytes(p)).map_err(|e| e.to_string())?
        }
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        fs::rename(&temporary, output).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let result = if args.len() == 4 {
        run(Path::new(&args[1]), Path::new(&args[2]), &args[3])
    } else {
        Err("Expected input output inputSHA256".into())
    };
    if let Err(e) = result {
        eprintln!("canopy batch: {}", e.chars().take(512).collect::<String>());
        std::process::exit(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_fractions_and_radius_ties() {
        let m = Mask {
            width: 2,
            height: 2,
            origin_x: 0.,
            origin_z: 0.,
            spacing: 1.,
        };
        assert_eq!(
            sample(&[0, 255, 255, 0], &m, address(&m, 0.5, 0.5).unwrap()),
            0.5
        );
        assert_eq!(bin(3.25), 0);
        assert_eq!(normal([0.; 3]), [0.; 3]);
        assert!(address(&m, -0.01, 0.).is_none())
    }
    #[test]
    fn framing_refuses_before_allocation() {
        for bytes in [&b""[..], &b"MUCIN001"[..]] {
            assert!(decode(bytes).is_err())
        }
    }
    fn request() -> Value {
        serde_json::json!({"version":VERSION,"job":{"worldId":"authored"},"width":2,"height":2,"originX":0.,"originZ":0.,"spacing":1.,"treeCount":0,"mask":null})
    }
    fn wire(r: &Value, payload: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(r).unwrap();
        let mut out = vec![0; (16 + json.len()).div_ceil(8) * 8];
        out[..8].copy_from_slice(b"MUCIN001");
        out[8..12].copy_from_slice(&(json.len() as u32).to_le_bytes());
        out[12..16].copy_from_slice(&(payload.len() as u32).to_le_bytes());
        out[16..16 + json.len()].copy_from_slice(&json);
        out.extend_from_slice(payload);
        out
    }
    #[test]
    fn shapes_types_limits_and_unclaimed_bytes_fail_before_raster() {
        assert!(decode(&wire(&request(), &[])).is_ok());
        for (k, value) in [
            ("width", serde_json::json!(4096)),
            ("height", serde_json::json!(3)),
            ("treeCount", serde_json::json!(100001)),
            ("job", serde_json::json!([])),
            ("spacing", serde_json::json!(0)),
            ("unknown", serde_json::json!(1)),
            (
                "mask",
                serde_json::json!({"width":2048,"height":2,"originX":0.,"originZ":0.,"spacing":1.}),
            ),
        ] {
            let mut r = request();
            r[k] = value;
            assert!(decode(&wire(&r, &[])).is_err(), "{k}");
        }
        assert!(decode(&wire(&request(), &[1, 2, 3, 4])).is_err());
        let mut r = request();
        r["treeCount"] = serde_json::json!(1);
        let mut data = vec![0; 64];
        data[16..24].copy_from_slice(&f64::NAN.to_le_bytes());
        let w = wire(&r, &data);
        let (r, start, _) = decode(&w).unwrap();
        assert!(raster(&r, &w[start..]).is_err());
    }
    #[test]
    fn atomic_output_hash_and_existing_destination() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("magna-canopy-test-{}-{nonce}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        let input = dir.join("input.bin");
        let output = dir.join("output.bin");
        let bytes = wire(&request(), &[]);
        fs::write(&input, &bytes).unwrap();
        assert!(run(&input, &output, "wrong-hash").is_err());
        assert!(!output.exists());
        run(&input, &output, &sha(&bytes)).unwrap();
        let result = fs::read(&output).unwrap();
        assert_eq!(&result[..8], b"MUCOUT01");
        let len = u32le(&result[8..12]);
        let h: Value = serde_json::from_slice(&result[16..16 + len]).unwrap();
        let start = (16 + len).div_ceil(8) * 8;
        assert_eq!(h["payloadSha256"], sha(&result[start..]));
        assert!(run(&input, &output, &sha(&bytes)).is_err());
        assert_eq!(fs::read(&output).unwrap(), result);
        fs::remove_file(input).unwrap();
        fs::remove_file(output).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
