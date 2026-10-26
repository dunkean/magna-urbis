//! Ordered f64 GD height sampler, independent of rendering/GPU/Neural services.
//! No fast-math, interpolator substitution, source write or invented support.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Write,
    path::Path,
    time::Instant,
};

const INPUT: &[u8; 8] = b"MUHIN001";
const OUTPUT: &[u8; 8] = b"MUHOUT01";
const VERSION: &str = "gd-height-batch-1";
const MAX_BODY: usize = 512 * 1024 * 1024;
const MAX_SOURCE_LAYERS: usize = 7;
const MAX_SOURCE_SAMPLES: usize = MAX_SOURCE_LAYERS * 1024 * 1024;
const SOURCE_BUDGET_VERSION: &str = "height-source-chain-2";
const MAX_KNOWN_BUFFERS: usize = 384 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Bounds {
    min_x: f64,
    min_z: f64,
    max_x: f64,
    max_z: f64,
}
impl Bounds {
    fn valid(&self) -> bool {
        [self.min_x, self.min_z, self.max_x, self.max_z]
            .iter()
            .all(|v| v.is_finite())
            && self.min_x <= self.max_x
            && self.min_z <= self.max_z
    }
    fn contains(&self, x: f64, z: f64) -> bool {
        x >= self.min_x && x <= self.max_x && z >= self.min_z && z <= self.max_z
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LayerInput {
    bounds: Bounds,
    width: usize,
    height: usize,
    origin_x: f64,
    origin_z: f64,
    spacing_m: f64,
    last_sample_x: Option<f64>,
    last_sample_z: Option<f64>,
    reconstruction: String,
    dtype: String,
    offset: usize,
    length: usize,
    source_id: String,
    source_version: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: String,
    job: serde_json::Value,
    source_id: String,
    source_version: String,
    width: usize,
    height: usize,
    sample_origin_x: f64,
    sample_origin_z: f64,
    relative_origin_y: f64,
    spacing_m: f64,
    display_spacing_m: f64,
    domains: Vec<Bounds>,
    layers: Vec<LayerInput>,
}
struct Grid {
    meta: LayerInput,
    values: Vec<f64>,
}
#[derive(Clone, Copy)]
struct Tap {
    at: [usize; 4],
    weights: [f64; 4],
    t: f64,
}
fn coordinate(value: f64, start: f64, spacing: f64, count: usize, end: Option<f64>) -> f64 {
    let end = end.unwrap_or(start + (count - 1) as f64 * spacing);
    let value = value.clamp(start, end);
    let last = start + (count - 2) as f64 * spacing;
    if value > last && end < start + (count - 1) as f64 * spacing && end > last {
        (count - 2) as f64 + (value - last) / (end - last)
    } else {
        ((value - start) / spacing).clamp(0., (count - 1) as f64)
    }
}
fn weights(t: f64) -> [f64; 4] {
    [
        (1. - t).powf(3.) / 6.,
        (3. * t * t * t - 6. * t * t + 4.) / 6.,
        (-3. * t * t * t + 3. * t * t + 3. * t + 1.) / 6.,
        t * t * t / 6.,
    ]
}
fn tap(value: f64, start: f64, spacing: f64, count: usize, end: Option<f64>, cubic: bool) -> Tap {
    let u = coordinate(value, start, spacing, count, end);
    let i = u.floor() as usize;
    let t = u - i as f64;
    Tap {
        at: if cubic {
            [
                i.saturating_sub(1),
                i,
                (i + 1).min(count - 1),
                (i + 2).min(count - 1),
            ]
        } else {
            [i, (i + 1).min(count - 1), i, i]
        },
        weights: weights(t),
        t,
    }
}
fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
fn sample(grid: &Grid, x: Tap, z: Tap) -> f64 {
    let w = grid.meta.width;
    if grid.meta.reconstruction == "bilinear-samples" {
        return lerp(
            lerp(
                grid.values[z.at[0] * w + x.at[0]],
                grid.values[z.at[0] * w + x.at[1]],
                x.t,
            ),
            lerp(
                grid.values[z.at[1] * w + x.at[0]],
                grid.values[z.at[1] * w + x.at[1]],
                x.t,
            ),
            z.t,
        );
    }
    let mut value = 0.;
    // Exact row-major multiplication/addition order of surface_geometry.gd.
    for j in 0..4 {
        for i in 0..4 {
            value += grid.values[z.at[j] * w + x.at[i]] * x.weights[i] * z.weights[j];
        }
    }
    value
}
fn at(grid: &Grid, x: f64, z: f64) -> f64 {
    let m = &grid.meta;
    let cubic = m.reconstruction == "cubic-bspline-controls";
    sample(
        grid,
        tap(x, m.origin_x, m.spacing_m, m.width, m.last_sample_x, cubic),
        tap(z, m.origin_z, m.spacing_m, m.height, m.last_sample_z, cubic),
    )
}
fn smooth(edge: f64, band: f64) -> f64 {
    let t = (edge / band.max(0.0001)).clamp(0., 1.);
    t * t * (3. - 2. * t)
}
fn height(
    grids: &[Grid],
    x: f64,
    z: f64,
    display_spacing: f64,
    taps: Option<(&[Vec<Tap>], &[Vec<Tap>], usize, usize)>,
) -> f64 {
    let read = |i: usize| {
        if let Some((xs, zs, ix, iz)) = taps {
            sample(&grids[i], xs[i][ix], zs[i][iz])
        } else {
            at(&grids[i], x, z)
        }
    };
    for (i, g) in grids.iter().enumerate() {
        let b = &g.meta.bounds;
        if !b.contains(x, z) {
            continue;
        }
        let edge = (x - b.min_x)
            .min(b.max_x - x)
            .min(z - b.min_z)
            .min(b.max_z - z);
        let band = (g.meta.spacing_m * 4.).max(display_spacing * 2.);
        if edge >= band.max(0.0001) {
            return read(i);
        }
        break;
    }
    let mut value = f64::NAN;
    for (i, g) in grids.iter().enumerate().rev() {
        let b = &g.meta.bounds;
        if !b.contains(x, z) {
            continue;
        }
        let child = read(i);
        if value.is_finite() {
            let edge = (x - b.min_x)
                .min(b.max_x - x)
                .min(z - b.min_z)
                .min(b.max_z - z);
            value = lerp(
                value,
                child,
                smooth(edge, (g.meta.spacing_m * 4.).max(display_spacing * 2.)),
            );
        } else {
            value = child
        }
    }
    value // Callers must supply a validated covered point. No off-source clamp.
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn decode(bytes: &[u8]) -> Result<(Request, Vec<Grid>)> {
    if bytes.len() < 16 || bytes.len() > MAX_BODY || &bytes[..8] != INPUT {
        return Err("input framing/budget".into());
    }
    let ml = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let pl = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let start = (16 + ml).div_ceil(8) * 8;
    if ml == 0
        || ml > 1024 * 1024
        || start.checked_add(pl) != Some(bytes.len())
        || 16 + ml > bytes.len()
    {
        return Err("input lengths".into());
    }
    let request: Request =
        serde_json::from_slice(&bytes[16..16 + ml]).map_err(|e| format!("manifest: {e}"))?;
    if request.version != VERSION
        || !request.job.is_object()
        || request.width < 2
        || request.height < 2
        || request.width > 4096
        || request.height > 4096
        || request.domains.is_empty()
        || request.domains.len() > 7
        || request.layers.is_empty()
        || request.layers.len() > MAX_SOURCE_LAYERS
    {
        return Err("request shape/version".into());
    }
    if request.source_id.is_empty()
        || request.source_version.is_empty()
        || !request.domains.iter().all(Bounds::valid)
        || ![
            request.sample_origin_x,
            request.sample_origin_z,
            request.relative_origin_y,
            request.spacing_m,
            request.display_spacing_m,
        ]
        .iter()
        .all(|v| v.is_finite())
        || request.spacing_m <= 0.
        || request.display_spacing_m <= 0.
    {
        return Err("request finite/source identity".into());
    }
    let mut total = 0usize;
    let mut end = 0usize;
    let mut grids = Vec::new();
    let mut previous_spacing = 0.;
    for layer in &request.layers {
        let n = layer
            .width
            .checked_mul(layer.height)
            .ok_or("source overflow")?;
        total = total.checked_add(n).ok_or("sample overflow")?;
        let stride = match layer.dtype.as_str() {
            "f32" => 4,
            "f64" => 8,
            _ => return Err("source dtype".into()),
        };
        let count = n.checked_mul(stride).ok_or("payload overflow")?;
        if total > MAX_SOURCE_SAMPLES
            || layer.width < 2
            || layer.height < 2
            || layer.length != n
            || layer.offset != end
            || !layer.bounds.valid()
            || ![layer.origin_x, layer.origin_z, layer.spacing_m]
                .iter()
                .all(|v| v.is_finite())
            || layer.spacing_m <= 0.
            || layer.spacing_m < previous_spacing
            || layer.source_id != request.source_id
            || layer.source_version != request.source_version
            || !["bilinear-samples", "cubic-bspline-controls"]
                .contains(&layer.reconstruction.as_str())
        {
            return Err("invalid source grid/lineage/budget/kernel/order".into());
        }
        end = end.checked_add(count).ok_or("offset overflow")?;
        if end > pl {
            return Err("source payload bounds".into());
        }
        let last_x = layer
            .last_sample_x
            .unwrap_or(layer.origin_x + (layer.width - 1) as f64 * layer.spacing_m);
        let last_z = layer
            .last_sample_z
            .unwrap_or(layer.origin_z + (layer.height - 1) as f64 * layer.spacing_m);
        if !last_x.is_finite()
            || !last_z.is_finite()
            || last_x < layer.origin_x
            || last_z < layer.origin_z
            || layer.bounds.min_x < layer.origin_x - 0.000001
            || layer.bounds.min_z < layer.origin_z - 0.000001
            || layer.bounds.max_x > last_x + 0.000001
            || layer.bounds.max_z > last_z + 0.000001
        {
            return Err("source footprint".into());
        }
        previous_spacing = layer.spacing_m;
    }
    if !request
        .domains
        .iter()
        .all(|b| request.layers.iter().any(|l| l.bounds == *b))
        || !request
            .layers
            .iter()
            .all(|l| request.domains.contains(&l.bounds))
    {
        return Err("source/display domain mismatch".into());
    }
    if end != pl {
        return Err("unused source payload".into());
    }
    // Preflight before promoting any source controls or allocating output/taps.
    // Includes a 32 MiB reserve for decoded JSON/metadata; not a process RSS claim.
    let known = bytes.len()
        + total * 8
        + request.width * request.height * 8
        + (request.width + request.height) * request.layers.len() * std::mem::size_of::<Tap>()
        + 32 * 1024 * 1024;
    if known > MAX_KNOWN_BUFFERS {
        return Err("native known buffer budget".into());
    }
    for layer in &request.layers {
        let stride = if layer.dtype == "f32" { 4 } else { 8 };
        let mut values = Vec::with_capacity(layer.length);
        for chunk in bytes[start + layer.offset..start + layer.offset + layer.length * stride]
            .chunks_exact(stride)
        {
            let v = if stride == 4 {
                f32::from_le_bytes(chunk.try_into().unwrap()) as f64
            } else {
                f64::from_le_bytes(chunk.try_into().unwrap())
            };
            if !v.is_finite() {
                return Err("nonfinite source control".into());
            }
            values.push(v);
        }
        // Move metadata below without duplicating the full request's payload.
        grids.push(values);
    }
    let mut request = request;
    let metas = std::mem::take(&mut request.layers);
    Ok((
        request,
        metas
            .into_iter()
            .zip(grids)
            .map(|(meta, values)| Grid { meta, values })
            .collect(),
    ))
}
fn run(input: &Path, output: &Path, expected: &str) -> Result<()> {
    if input == output
        || output.exists()
        || fs::metadata(input).map_err(|e| e.to_string())?.len() > MAX_BODY as u64
    {
        return Err("input/output budget/path; output must be new".into());
    }
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    let input_hash = sha(&bytes);
    if expected.len() != 64 || expected != input_hash {
        return Err("input SHA256 mismatch".into());
    }
    let started = Instant::now();
    let (r, grids) = decode(&bytes)?;
    let source_samples: usize = grids.iter().map(|g| g.values.len()).sum();
    let source_bytes: usize = grids
        .iter()
        .map(|g| g.values.len() * if g.meta.dtype == "f32" { 4 } else { 8 })
        .sum();
    let known = bytes.len()
        + source_samples * 8
        + r.width * r.height * 8
        + (r.width + r.height) * grids.len() * std::mem::size_of::<Tap>()
        + 32 * 1024 * 1024;
    let xs: Vec<Vec<Tap>> = grids
        .iter()
        .map(|g| {
            (0..r.width)
                .map(|x| {
                    tap(
                        r.sample_origin_x + x as f64 * r.spacing_m,
                        g.meta.origin_x,
                        g.meta.spacing_m,
                        g.meta.width,
                        g.meta.last_sample_x,
                        g.meta.reconstruction == "cubic-bspline-controls",
                    )
                })
                .collect()
        })
        .collect();
    let zs: Vec<Vec<Tap>> = grids
        .iter()
        .map(|g| {
            (0..r.height)
                .map(|z| {
                    tap(
                        r.sample_origin_z + z as f64 * r.spacing_m,
                        g.meta.origin_z,
                        g.meta.spacing_m,
                        g.meta.height,
                        g.meta.last_sample_z,
                        g.meta.reconstruction == "cubic-bspline-controls",
                    )
                })
                .collect()
        })
        .collect();
    let n = r.width * r.height;
    let mut heights = Vec::with_capacity(n * 4);
    let mut controls = Vec::with_capacity(n * 4);
    let mut low = f64::INFINITY;
    let mut high = f64::NEG_INFINITY;
    let mut holes = 0u64;
    for iz in 0..r.height {
        for ix in 0..r.width {
            let x = r.sample_origin_x + ix as f64 * r.spacing_m;
            let z = r.sample_origin_z + iz as f64 * r.spacing_m;
            let covered = r.domains.iter().any(|b| b.contains(x, z));
            let value = if covered {
                height(&grids, x, z, r.display_spacing_m, Some((&xs, &zs, ix, iz)))
            } else {
                let mut distance = f64::INFINITY;
                let mut point = None;
                for b in &r.domains {
                    let px = x.clamp(b.min_x, b.max_x);
                    let pz = z.clamp(b.min_z, b.max_z);
                    let d = (px - x) * (px - x) + (pz - z) * (pz - z);
                    if d < distance {
                        distance = d;
                        point = Some((px, pz));
                    }
                }
                let (px, pz) = point.ok_or("no physical nearest source")?;
                height(&grids, px, pz, r.display_spacing_m, None)
            };
            let stored = (value - r.relative_origin_y) as f32;
            if !value.is_finite() || !stored.is_finite() {
                return Err("source/RF nonfinite; refusing invented filler".into());
            }
            if covered {
                low = low.min(value);
                high = high.max(value)
            } else {
                holes += 1
            }
            heights.extend_from_slice(&stored.to_le_bytes());
            controls.extend_from_slice(&(if covered { 0u32 } else { 4u32 }).to_le_bytes());
        }
    }
    if !low.is_finite() || !high.is_finite() {
        return Err("resident contains no source support".into());
    }
    let mut digest = Sha256::new();
    digest.update(&heights);
    digest.update(&controls);
    let payload_hash = format!("{:x}", digest.finalize());
    let manifest=serde_json::to_vec(&serde_json::json!({"version":VERSION,"job":r.job,"inputSha256":input_hash,"payloadSha256":payload_hash,"width":r.width,"height":r.height,"heightBytes":heights.len(),"controlBytes":controls.len(),"minimumM":low,"maximumM":high,"holes":holes,"sampleMs":started.elapsed().as_secs_f64()*1000.,"sourceSamples":source_samples,"sourceBytes":source_bytes,"sourceLayers":grids.len(),"sourceSampleBudget":MAX_SOURCE_SAMPLES,"sourceBudgetVersion":SOURCE_BUDGET_VERSION,"nativeKnownBufferUpperBytes":known,"provenance":"Rust f64 scalar ordered16taps; no fast-math; GD positive-kernel seam policy"})).map_err(|e|e.to_string())?;
    let temporary = output.with_extension(format!("partial-{}", std::process::id()));
    let result = (|| -> Result<()> {
        let mut file = File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(OUTPUT).map_err(|e| e.to_string())?;
        file.write_all(&(manifest.len() as u32).to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&((heights.len() + controls.len()) as u32).to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&manifest).map_err(|e| e.to_string())?;
        let padding = (16 + manifest.len()).div_ceil(8) * 8 - (16 + manifest.len());
        file.write_all(&vec![0; padding])
            .map_err(|e| e.to_string())?;
        file.write_all(&heights).map_err(|e| e.to_string())?;
        file.write_all(&controls).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, output).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = if args.len() == 4 {
        run(Path::new(&args[1]), Path::new(&args[2]), &args[3])
    } else {
        Err("usage: helper input.bin output.bin input-sha256".into())
    };
    if let Err(error) = result {
        eprintln!("surface-height-batch: {error}");
        std::process::exit(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(change: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let b = serde_json::json!({"minX":0.,"minZ":0.,"maxX":2.,"maxZ":2.});
        let mut m = serde_json::json!({"version":VERSION,"job":{"id":"boundary-test"},"sourceId":"source","sourceVersion":"version","width":4,"height":4,"sampleOriginX":-1.,"sampleOriginZ":-1.,"relativeOriginY":0.,"spacingM":1.,"displaySpacingM":1.,"domains":[b.clone()],"layers":[{"bounds":b,"width":3,"height":3,"originX":0.,"originZ":0.,"spacingM":1.,"reconstruction":"bilinear-samples","dtype":"f32","offset":0,"length":9,"sourceId":"source","sourceVersion":"version"}]});
        change(&mut m);
        let metadata = serde_json::to_vec(&m).unwrap();
        let start = (16 + metadata.len()).div_ceil(8) * 8;
        let mut bytes = vec![0u8; start];
        bytes[..8].copy_from_slice(INPUT);
        bytes[8..12].copy_from_slice(&(metadata.len() as u32).to_le_bytes());
        bytes[12..16].copy_from_slice(&36u32.to_le_bytes());
        bytes[16..16 + metadata.len()].copy_from_slice(&metadata);
        for z in 0..3 {
            for x in 0..3 {
                bytes.extend_from_slice(&((x + 2 * z) as f32).to_le_bytes())
            }
        }
        bytes
    }
    #[test]
    fn malformed_and_unsupported_are_refused() {
        for edit in [0, 1, 2, 3, 4, 5] {
            let bytes = fixture(|m| match edit {
                0 => m["layers"][0]["reconstruction"] = "catmull-rom".into(),
                1 => m["layers"][0]["sourceVersion"] = "other".into(),
                2 => m["layers"][0]["length"] = 8.into(),
                3 => m["domains"][0]["maxX"] = 3.into(),
                4 => m["width"] = 4097.into(),
                _ => m["layers"][0]["dtype"] = "u32".into(),
            });
            assert!(decode(&bytes).is_err(), "malformed case {edit}");
        }
        let mut bytes = fixture(|_| {});
        let last = bytes.len() - 4;
        bytes[last..].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(decode(&bytes).is_err());
    }
    #[test]
    fn atomic_output_known_plane_holes_and_hash() {
        let directory =
            std::env::temp_dir().join(format!("magna-height-unit-{}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let input = directory.join("input.bin");
        let output = directory.join("output.bin");
        let bytes = fixture(|_| {});
        fs::write(&input, &bytes).unwrap();
        assert!(run(&input, &output, &"0".repeat(64)).is_err());
        assert!(!output.exists());
        run(&input, &output, &sha(&bytes)).unwrap();
        assert_eq!(fs::read(&input).unwrap(), bytes);
        let result = fs::read(&output).unwrap();
        assert_eq!(&result[..8], OUTPUT);
        let n = u32::from_le_bytes(result[8..12].try_into().unwrap()) as usize;
        let start = (16 + n).div_ceil(8) * 8;
        let header: serde_json::Value = serde_json::from_slice(&result[16..16 + n]).unwrap();
        assert_eq!(header["payloadSha256"], sha(&result[start..]));
        for z in 0..4 {
            for x in 0..4 {
                let i = z * 4 + x;
                let value = f32::from_le_bytes(
                    result[start + i * 4..start + i * 4 + 4].try_into().unwrap(),
                );
                assert_eq!(
                    value,
                    ((x as i32 - 1).clamp(0, 2) + 2 * (z as i32 - 1).clamp(0, 2)) as f32
                );
                let hole = u32::from_le_bytes(
                    result[start + 64 + i * 4..start + 64 + i * 4 + 4]
                        .try_into()
                        .unwrap(),
                );
                assert_eq!(hole, if x == 0 || z == 0 { 4 } else { 0 });
            }
        }
        assert_eq!(header["holes"], 7);
        assert_eq!(header["sourceSamples"], 9);
        assert_eq!(header["sourceLayers"], 1);
        assert_eq!(header["sourceBytes"], 36);
        assert_eq!(header["sourceSampleBudget"], MAX_SOURCE_SAMPLES);
        assert_eq!(header["sourceBudgetVersion"], SOURCE_BUDGET_VERSION);
        fs::remove_file(input).unwrap();
        fs::remove_file(output).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn seven_full_grids_and_sample_budget_are_checked_before_promotion() {
        let make = |extra: usize, layers: usize| {
            let mut m: serde_json::Value = serde_json::from_slice(
                &fixture(|_| {})[16..16
                    + u32::from_le_bytes(fixture(|_| {})[8..12].try_into().unwrap()) as usize],
            )
            .unwrap();
            let prototype = m["layers"][0].clone();
            let mut offset = 0usize;
            m["layers"] = serde_json::json!([]);
            m["domains"] = serde_json::json!([]);
            for index in 0..layers {
                let mut layer = prototype.clone();
                let width = 1024 + if index == layers - 1 { extra } else { 0 };
                let spacing = index + 1;
                layer["width"] = width.into();
                layer["height"] = 1024.into();
                layer["length"] = (width * 1024).into();
                layer["offset"] = offset.into();
                layer["spacingM"] = spacing.into();
                layer["bounds"]["maxX"] = ((width - 1) * spacing).into();
                layer["bounds"]["maxZ"] = (1023 * spacing).into();
                m["domains"]
                    .as_array_mut()
                    .unwrap()
                    .push(layer["bounds"].clone());
                m["layers"].as_array_mut().unwrap().push(layer);
                offset += width * 1024 * 4;
            }
            let metadata = serde_json::to_vec(&m).unwrap();
            let start = (16 + metadata.len()).div_ceil(8) * 8;
            let mut bytes = vec![0u8; start + offset];
            bytes[..8].copy_from_slice(INPUT);
            bytes[8..12].copy_from_slice(&(metadata.len() as u32).to_le_bytes());
            bytes[12..16].copy_from_slice(&(offset as u32).to_le_bytes());
            bytes[16..16 + metadata.len()].copy_from_slice(&metadata);
            bytes
        };
        let bytes = make(0, 7);
        let (_, grids) = decode(&bytes).unwrap();
        assert_eq!(grids.len(), 7);
        assert_eq!(
            grids.iter().map(|g| g.values.len()).sum::<usize>(),
            MAX_SOURCE_SAMPLES
        );
        assert_eq!(height(&grids, 1., 1., 1., None).to_bits(), 0f64.to_bits());
        drop(grids);
        drop(bytes);
        assert_eq!(
            decode(&make(1, 7)).err().unwrap(),
            "invalid source grid/lineage/budget/kernel/order"
        );
        assert_eq!(decode(&make(0, 8)).err().unwrap(), "request shape/version");
    }
}
