//! Shared stateless native/WASM framing. Plane offsets are relative to payload.
use super::*;
use serde_json::{Value, json};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    aridity: Option<f64>,
    discharge_scale: Option<f64>,
    confluence_angle: Option<f64>,
    operation: String,
    n: usize,
    width: f64,
    settings: Option<Settings>,
    climate: Option<Climate>,
    seed: Option<String>,
    conditioning: Option<Conditioning>,
    stats: Option<bool>,
    drainage: Option<bool>,
    drainage_outlets: Option<u32>,
    drainage_basin: Option<bool>,
    m: Option<usize>,
    target_n: Option<usize>,
    x: Option<f64>,
    y: Option<f64>,
    sample_width: Option<f64>,
}
struct Output {
    planes: Vec<Value>,
    bytes: Vec<u8>,
    meta: Value,
}
impl Output {
    fn new() -> Self {
        Self {
            planes: Vec::new(),
            bytes: Vec::new(),
            meta: json!({}),
        }
    }
    fn plane(&mut self, name: &str, kind: &str, len: usize, bytes: &[u8]) {
        while self.bytes.len() % 8 != 0 {
            self.bytes.push(0)
        }
        let mut plane = json!({"name":name,"kind":kind,"length":len,"offset":self.bytes.len()});
        let runs = matches!(
            name,
            "hydro.basin"
                | "hydro.sea"
                | "lake"
                | "lakeLevel"
                | "lakeKind"
                | "field.values"
                | "field.distance"
                | "distance"
        );
        let encoded = runs
            .then(|| encode_runs(bytes, if kind == "u8" { 1 } else { 4 }))
            .flatten();
        if let Some(encoded) = encoded {
            plane["encoding"] = json!("runs");
            plane["byteLength"] = json!(encoded.len());
            self.bytes.extend_from_slice(&encoded);
        } else {
            self.bytes.extend_from_slice(bytes);
        }
        self.planes.push(plane);
    }
    fn alias(&mut self, name: &str, original: &str) {
        let mut plane = self
            .planes
            .iter()
            .find(|p| p["name"] == original)
            .unwrap()
            .clone();
        plane["name"] = json!(name);
        self.planes.push(plane);
    }
    fn f32(&mut self, name: &str, p: &[f32]) {
        self.plane(name, "f32", p.len(), &le_bytes(p))
    }
    fn i32(&mut self, name: &str, p: &[i32]) {
        self.plane(name, "i32", p.len(), &le_bytes(p))
    }
    fn f64(&mut self, name: &str, p: &[f64]) {
        self.plane(name, "f64", p.len(), &le_bytes(p))
    }
    fn u8(&mut self, name: &str, p: &[u8]) {
        self.plane(name, "u8", p.len(), p)
    }
    fn hydro(&mut self, h: &Hydrology, order: bool, basin: bool) {
        let g = &h.grids;
        self.f32("hydro.filled", &g.filled);
        self.i32("hydro.receiver", &g.receiver);
        self.f32("hydro.accumulation", &g.accumulation);
        // Only intermediate drainage is uploaded again. Renderers never read order.
        if order {
            self.i32("hydro.order", &g.order);
        }
        if basin {
            if g.basin.is_empty() {
                // Intermediate conditioning never exposes basin IDs to a TS
                // consumer. Derive them only if unbalanced water retains it.
                let mut labels = vec![0; h.n * h.n];
                let mut id = 0;
                for &cell in &g.order {
                    let c = cell as usize;
                    labels[c] = if g.receiver[c] < 0 {
                        id += 1;
                        id - 1
                    } else {
                        labels[g.receiver[c] as usize]
                    };
                }
                self.i32("hydro.basin", &labels);
            } else {
                self.i32("hydro.basin", &g.basin);
            }
        }
        self.u8("hydro.sea", &g.sea);
        self.meta["hydro"] =
            json!({"n":h.n,"width":h.width,"cellArea":h.cell_area(),"outlets":g.outlets,"ms":0.0})
    }
    fn network(&mut self, n: &rivers::Network) -> Value {
        let groups = [
            &n.rivers,
            &n.lake_links,
            &n.oxbows,
            &n.braids,
            &n.distributaries,
        ];
        let mut values = Vec::new();
        let mut lines = Vec::new();
        for group in groups {
            for line in group {
                // Five (offset,length) pairs, then id/joins/outlet. -1 length = absent threads.
                for p in [
                    Some(&line.points),
                    Some(&line.area),
                    Some(&line.level),
                    Some(&line.kind),
                    line.threads.as_ref(),
                ] {
                    lines.push(values.len() as i32);
                    lines.push(p.map_or(-1, |p| p.len() as i32));
                    if let Some(p) = p {
                        values.extend_from_slice(p);
                    }
                }
                lines.extend([
                    line.id.map_or(-1, |v| v as i32),
                    line.joins.unwrap_or(i32::MIN),
                    line.outlet.map_or(-1, |v| v as i32),
                ]);
            }
        }
        self.f64("rivers.values", &values);
        self.i32("rivers.lines", &lines);
        json!({"groups":groups.map(|g|g.len()),"widthScale":n.width_scale,"meanderRuns":n.meander_runs,
            "lengthKm":n.length_km,"meanderKm":n.meander_km,"braidedKm":n.braided_km,
            "avulsions":n.avulsions,"deltas":n.deltas,"ms":n.ms})
    }
    fn finish(mut self) -> Result<Vec<u8>, String> {
        self.meta["planes"] = json!(self.planes);
        let mut header = serde_json::to_vec(&self.meta).map_err(|e| e.to_string())?;
        while (4 + header.len()) % 8 != 0 {
            header.push(b' ')
        }
        let mut out = Vec::with_capacity(4 + header.len() + self.bytes.len());
        out.extend_from_slice(&(header.len() as u32).to_le_bytes());
        out.extend(header);
        out.extend(self.bytes);
        Ok(out)
    }
}
// Binary (u32 run length, scalar bits) records. Skip encoding when it would
// save less than 25%; continuous terrain planes retain zero-copy decoding.
fn encode_runs(bytes: &[u8], size: usize) -> Option<Vec<u8>> {
    let mut chunks = bytes.chunks_exact(size);
    let mut previous = chunks.next()?;
    let mut count = 1;
    for value in chunks {
        if value != previous {
            count += 1;
            previous = value;
        }
    }
    let encoded_size = count * (4 + size);
    if encoded_size >= bytes.len() * 3 / 4 {
        return None;
    }
    let mut out = Vec::with_capacity(encoded_size);
    let mut previous = &bytes[..size];
    let mut count = 0_u32;
    for value in bytes.chunks_exact(size) {
        if value != previous {
            out.extend_from_slice(&count.to_le_bytes());
            out.extend_from_slice(previous);
            previous = value;
            count = 0;
        }
        count += 1;
    }
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(previous);
    Some(out)
}
// These private implementations accept only primitive scalars with no padding.
trait WireScalar: Copy {
    fn append_le(self, out: &mut Vec<u8>);
}
macro_rules! scalar {
    ($t:ty) => {
        impl WireScalar for $t {
            fn append_le(self, out: &mut Vec<u8>) {
                out.extend_from_slice(&self.to_le_bytes());
            }
        }
    };
}
scalar!(f32);
scalar!(i32);
scalar!(f64);
fn le_bytes<T: WireScalar>(p: &[T]) -> std::borrow::Cow<'_, [u8]> {
    if cfg!(target_endian = "little") {
        // SAFETY: WireScalar is private and implemented only for f32/i32/f64.
        std::borrow::Cow::Borrowed(unsafe {
            std::slice::from_raw_parts(p.as_ptr().cast(), std::mem::size_of_val(p))
        })
    } else {
        let mut bytes = Vec::with_capacity(std::mem::size_of_val(p));
        for &v in p {
            v.append_le(&mut bytes);
        }
        std::borrow::Cow::Owned(bytes)
    }
}
fn read_f32(data: &[u8], offset: &mut usize, count: usize) -> Result<Vec<f32>, String> {
    let len = count.checked_mul(4).ok_or("Water plane too large")?;
    let end = offset.checked_add(len).ok_or("Water plane too large")?;
    let bytes = data.get(*offset..end).ok_or("Incomplete water plane")?;
    *offset = end;
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect())
}
fn read_i32(data: &[u8], offset: &mut usize, count: usize) -> Result<Vec<i32>, String> {
    Ok(read_f32(data, offset, count)?
        .into_iter()
        .map(|v| v.to_bits() as i32)
        .collect())
}
pub fn request(body: &[u8]) -> Result<Vec<u8>, String> {
    request_with_clock(body, &|| 0.0)
}
pub fn request_with_clock(body: &[u8], now: &dyn Fn() -> f64) -> Result<Vec<u8>, String> {
    let len = u32::from_le_bytes(
        body.get(..4)
            .ok_or("Incomplete water header")?
            .try_into()
            .unwrap(),
    ) as usize;
    let end = 4_usize.checked_add(len).ok_or("Invalid water header")?;
    let input: Input = serde_json::from_slice(body.get(4..end).ok_or("Incomplete water header")?)
        .map_err(|e| e.to_string())?;
    let data = body.get(end..).ok_or("Incomplete water data")?;
    let n = input.n;
    if !(2..=8192).contains(&n) || !input.width.is_finite() || input.width <= 0.0 {
        return Err("Invalid water grid".into());
    }
    let mut offset = 0;
    let height = read_f32(data, &mut offset, n * n)?;
    if height.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite water height".into());
    }
    let mut out = Output::new();
    match input.operation.as_str() {
        "condition" | "chain" => {
            let s = input
                .conditioning
                .as_ref()
                .ok_or("Missing conditioning settings")?;
            validate_conditioning(s)?;
            let stats = input.stats.unwrap_or(true);
            let conditioning_started = now();
            let chain = input.operation == "chain";
            let drainage = chain || input.drainage.unwrap_or(stats);
            let accumulate = !chain || !input.settings.as_ref().is_some_and(|s| s.balance);
            let result = conditioning::condition_options(&height, n, input.width, s, stats, drainage, accumulate);
            out.f32("height", &result.height);
            out.f32("delta", &result.delta);
            out.meta["conditioning"] = json!({"before":result.before,"after":result.after,"breaches":result.breaches,"steps":result.steps,"ms":now()-conditioning_started});
            if input.operation == "chain" {
                let s = input.settings.as_ref().ok_or("Missing water settings")?;
                let climate = input.climate.ok_or("Missing climate")?;
                validate_settings(s, climate)?;
                let water = compute_water_timed(
                    &result.height,
                    n,
                    input.width,
                    s,
                    climate,
                    input.seed.as_deref().unwrap_or(""),
                    result.hydrology,
                    now,
                );
                write_water(&mut out, &water, s)
            } else if let Some(h) = result.hydrology {
                out.hydro(&h, true, false)
            }
        }
        "water" => {
            let s = input.settings.as_ref().ok_or("Missing water settings")?;
            let climate = input.climate.ok_or("Missing climate")?;
            validate_settings(s, climate)?;
            let drainage = if let Some(outlets) = input.drainage_outlets {
                let count = n * n;
                let filled = read_f32(data, &mut offset, count)?;
                let receiver = read_i32(data, &mut offset, count)?;
                let accumulation = read_f32(data, &mut offset, count)?;
                let order = read_i32(data, &mut offset, count)?;
                let basin = if input.drainage_basin.unwrap_or(true) {
                    read_i32(data, &mut offset, count)?
                } else {
                    Vec::new()
                };
                let sea = data
                    .get(offset..offset + count)
                    .ok_or("Incomplete drainage sea plane")?
                    .to_vec();
                validate_drainage(&receiver, &order)?;
                Some(Hydrology {
                    n,
                    width: input.width,
                    height: height.clone(),
                    grids: FloodGrids {
                        filled,
                        receiver,
                        accumulation,
                        order,
                        basin,
                        sea,
                        outlets,
                    },
                })
            } else {
                None
            };
            let water = compute_water_timed(
                &height,
                n,
                input.width,
                s,
                climate,
                input.seed.as_deref().unwrap_or(""),
                drainage,
                now,
            );
            write_water(&mut out, &water, s)
        }
        "hydrology" => out.hydro(&hydrology(&height, n, input.width), true, true),
        "rivers" | "bodies" | "balance" => {
            let count = n * n;
            let filled = read_f32(data, &mut offset, count)?;
            let receiver = read_i32(data, &mut offset, count)?;
            let accumulation = read_f32(data, &mut offset, count)?;
            let order = read_i32(data, &mut offset, count)?;
            let basin = if input.drainage_basin.unwrap_or(true) {
                read_i32(data, &mut offset, count)?
            } else {
                Vec::new()
            };
            let sea = data
                .get(offset..offset + count)
                .ok_or("Incomplete drainage")?
                .to_vec();
            offset += count;
            validate_drainage(&receiver, &order)?;
            let h = Hydrology {
                n,
                width: input.width,
                height: height.clone(),
                grids: FloodGrids {
                    filled,
                    receiver,
                    accumulation,
                    order,
                    basin,
                    sea,
                    outlets: input.drainage_outlets.unwrap_or(0),
                },
            };
            let s = input.settings.as_ref().ok_or("Missing water settings")?;
            validate_settings(s, input.climate.unwrap_or(Climate { temperature: 11.0, precipitation: 800.0 }))?;
            if [input.aridity, input.discharge_scale, input.confluence_angle].into_iter().flatten().any(|v| !v.is_finite()) {
                return Err("Invalid river settings".into());
            }
            if input.operation == "rivers" {
                let mask = data
                    .get(offset..offset + count)
                    .ok_or("Incomplete lake mask")?;
                let field = lake_field(mask, n);
                let network = rivers::vector_rivers(
                    &h,
                    mask,
                    &field,
                    s,
                    input.seed.as_deref().unwrap_or(""),
                    input.aridity.unwrap_or(1.0),
                    input.discharge_scale.unwrap_or(1.0),
                    input.confluence_angle,
                );
                out.meta["rivers"] = out.network(&network);
            } else if input.operation == "bodies" {
                let (lake, lakes, area) = water_bodies(&h, s);
                out.u8("lake", &lake);
                let river_cells = (0..count)
                    .filter(|&c| {
                        h.grids.sea[c] == 0
                            && lake[c] == 0
                            && h.grids.accumulation[c] as f64 >= s.river_area * 1e6
                    })
                    .count();
                out.meta["bodies"] =
                    json!({"lakes":lakes,"lakeAreaKm2":area,"riverCells":river_cells});
            } else {
                let climate = input.climate.ok_or("Missing climate")?;
                let b = balance::water_balance(
                    &height,
                    n,
                    input.width,
                    &h.grids.sea,
                    climate,
                    s.lake_depth,
                    s.lake_area * 1e4,
                    Some(&h),
                );
                out.f32("routingHeight", &b.routing_height);
                out.f32("weight", &b.weight);
                out.i32("lakeOf", &b.lake_of);
                out.f32("level", &b.level);
                out.u8("closed", &b.closed);
                out.f32("loss", &b.loss);
                out.meta["balance"] = json!({"lakes":b.lakes,"closedLakes":b.closed_lakes,"lakeArea":b.lake_area,"runoff":climate.runoff(),"ms":0.0});
            }
        }
        "field" => {
            let mask: Vec<u8> = height.iter().map(|&v| u8::from(v != 0.0)).collect();
            let f = lake_field(&mask, n);
            out.f32("values", &f.values);
            out.f32("distance", &f.distance)
        }
        "delta" => {
            let target = input.target_n.ok_or("Missing delta target size")?;
            if !(2..=8192).contains(&target) {
                return Err("Invalid delta target".into());
            }
            let values = if input.x.is_none() && input.y.is_none() && input.sample_width.is_none() {
                upsample_delta(&height, n, target)
            } else {
                let x = input.x.unwrap_or(0.0);
                let y = input.y.unwrap_or(0.0);
                let width = input.sample_width.unwrap_or(input.width);
                if !x.is_finite() || !y.is_finite() || !width.is_finite() || width <= 0.0 {
                    return Err("Invalid delta region".into());
                }
                interpolate_delta(&height, n, target, x, y, width, input.width)
            };
            out.f32("values", &values)
        }
        "downsample" => {
            let m = input.m.ok_or("Missing downsample size")?;
            if m < 2 || m > n {
                return Err("Invalid downsample size".into());
            }
            out.f32("values", &downsample(&height, n, m))
        }
        _ => return Err("Unsupported water operation".into()),
    }
    out.finish()
}
fn validate_conditioning(s: &Conditioning) -> Result<(), String> {
    if ![s.strength, s.max_depth, s.max_length]
        .iter()
        .all(|v| v.is_finite())
        || !["none", "erosion", "breach", "both"].contains(&s.mode.as_str())
    {
        return Err("Invalid conditioning settings".into());
    }
    Ok(())
}
fn validate_settings(s: &Settings, c: Climate) -> Result<(), String> {
    if ![
        s.river_area,
        s.lake_depth,
        s.lake_area,
        s.flat_slope,
        s.sinuosity,
        s.width_scale,
        s.braiding,
        c.temperature,
        c.precipitation,
    ]
    .iter()
    .all(|v| v.is_finite())
        || s.river_area <= 0.0
        || s.width_scale <= 0.0
        || c.precipitation < 0.0
    {
        return Err("Invalid water settings".into());
    }
    Ok(())
}
fn validate_drainage(receiver: &[i32], order: &[i32]) -> Result<(), String> {
    let count = receiver.len();
    let mut rank = vec![usize::MAX; count];
    for (k, &cell) in order.iter().enumerate() {
        if cell < 0 || cell as usize >= count || rank[cell as usize] != usize::MAX {
            return Err("Drainage order must be a permutation".into());
        }
        rank[cell as usize] = k;
    }
    for (c, &r) in receiver.iter().enumerate() {
        if r < -1 || r >= count as i32 || (r >= 0 && rank[r as usize] >= rank[c]) {
            return Err("Drainage receiver must precede its cell".into());
        }
    }
    Ok(())
}
fn write_water(out: &mut Output, w: &Water, s: &Settings) {
    out.hydro(&w.hydro, false, true);
    out.u8("lake", &w.lake);
    if let Some(p) = &w.lake_level {
        out.f32("lakeLevel", p)
    }
    if let Some(p) = &w.lake_kind {
        out.u8("lakeKind", p)
    }
    out.f32("field.values", &w.field.values);
    if w.field.distance == w.field.values {
        out.alias("field.distance", "field.values");
    } else {
        out.f32("field.distance", &w.field.distance);
    }
    let network = w.rivers.as_ref().map(|n| out.network(n));
    out.meta["water"] = json!({"lakes":w.lakes,"closedLakes":w.closed_lakes,"lakeAreaKm2":w.lake_area_km2,"riverCells":w.river_cells,"rivers":network,"widthScale":s.width_scale,"riverArea":s.river_area,"metrics":w.metrics,"runoff":w.runoff,"confluenceAngle":w.confluence_angle,"hydrologyMs":w.hydrology_ms,"balanceMs":w.balance_ms})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_planes_preserve_every_f64_and_optional_field() {
        let line = rivers::Line {
            points: vec![0.0, -0.0, 123.45678901234567, 1e100],
            area: vec![1e-100, 1e10],
            level: vec![-2.3, 4.5],
            kind: vec![0.0, 3.0],
            id: Some(17),
            joins: Some(-1),
            outlet: Some(4095),
            threads: Some(vec![1.0, 2.0]),
        };
        let network = rivers::Network {
            rivers: vec![line.clone()],
            lake_links: vec![rivers::Line::default()],
            ..Default::default()
        };
        let mut output = Output::new();
        output.meta["rivers"] = output.network(&network);
        let bytes = output.finish().unwrap();
        let len = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        let meta: Value = serde_json::from_slice(&bytes[4..4 + len]).unwrap();
        assert_eq!(meta["rivers"]["groups"], json!([1, 1, 0, 0, 0]));
        let values = &meta["planes"][0];
        let start = 4 + len + values["offset"].as_u64().unwrap() as usize;
        assert_eq!(start % 8, 0);
        let count = values["length"].as_u64().unwrap() as usize;
        let decoded: Vec<_> = bytes[start..start + count * 8]
            .chunks_exact(8)
            .map(|b| f64::from_le_bytes(b.try_into().unwrap()).to_bits())
            .collect();
        let expected: Vec<_> = [
            &line.points,
            &line.area,
            &line.level,
            &line.kind,
            line.threads.as_ref().unwrap(),
        ]
        .into_iter()
        .flatten()
        .map(|v| v.to_bits())
        .collect();
        assert_eq!(decoded, expected);
        let index = &meta["planes"][1];
        let start = 4 + len + index["offset"].as_u64().unwrap() as usize;
        let index: Vec<_> = bytes[start..]
            .chunks_exact(4)
            .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        assert_eq!(&index[10..13], &[17, -1, 4095]);
        assert_eq!(&index[22..26], &[-1, -1, i32::MIN, -1]);
    }
}
