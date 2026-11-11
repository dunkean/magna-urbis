//! The transports share this decoder: JSON metadata and raw little-endian raster planes.
use super::*;
#[derive(Deserialize)]
struct Plane {
    name: String,
    offset: usize,
    length: usize,
    kind: String,
}
pub fn execute(header: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut v = decode_header(header, bytes)?;
    // Move the large trees into Input instead of cloning and deserializing them twice.
    let geometry = v["geometry"].take();
    let options = v["options"].take();
    let plan = v["plan"].take();
    let mut input: Input = serde::Deserialize::deserialize(&v).map_err(|e| e.to_string())?;
    input.geometry = geometry;
    input.options = options;
    input.plan = if plan.is_null() { None } else { Some(plan) };
    for plane in arr(&v["planes"]) {
        let plane: Plane = serde_json::from_value(plane.clone()).map_err(|e| e.to_string())?;
        let stride = if plane.kind == "u8" {
            1
        } else if plane.kind == "f32" {
            4
        } else {
            return Err("Invalid landuse plane kind".into());
        };
        let length = plane
            .length
            .checked_mul(stride)
            .ok_or("Landuse plane overflow")?;
        let end = plane
            .offset
            .checked_add(length)
            .ok_or("Landuse plane overflow")?;
        let data = bytes
            .get(plane.offset..end)
            .ok_or("Incomplete landuse plane")?;
        if plane.kind == "u8" {
            match plane.name.as_str() {
                "water" => input.water = data.to_vec(),
                "pass" => input.pass = data.to_vec(),
                _ => return Err("Unknown byte landuse plane".into()),
            }
            continue;
        }
        let values = data
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        match plane.name.as_str() {
            "height" => input.height = values,
            "slope" => input.slope = values,
            "cost" => input.cost = values,
            "hab" => input.hab = values,
            "dWater" => input.d_water = values,
            "dSea" => input.d_sea = values,
            "naturalForest" => input.natural_forest = values,
            "soil" => input.soil = values,
            _ => return Err("Unknown float landuse plane".into()),
        }
    }
    if let Some(start) = input.travel_from.filter(|_| input.cost.is_empty()) {
        let n = input.w;
        if input.w != input.h || start >= n * n || input.pass.len() != n * n || input.height.len() != n * n {
            return Err("Invalid travel cost request".into());
        }
        input.cost = crate::site::travel_cost(n, input.cell, start, &input.pass, &input.height);
    }
    match s(&v["operation"]) {
        "rural" => encode(&generate_rural(&input)?),
        "natural" => encode(&generate_natural_cover(&input)?),
        "landscape" => encode(&urban_landscape_ground(&input, yes(&v["appearance"]))),
        "natural-ground" => encode(&ground::urban_natural_ground(&input)),
        "cover-ground" => encode(&landscape_cover_ground(&input, &regions(&v["ground"]))),
        "water-ground" | "protected-ground" | "layer-ground" | "dry-ground" => {
            encode(&ground::operation(&input, &v)?)
        }
        _ => return Err("Unknown landuse operation".into()),
    }
}

// Polygon coordinates are always lossless f64 LE pairs. The metadata contains
// {"$xy":[byteOffset,pointCount]}; tuple-coordinate tools use "$uv" instead.
thread_local! { static OUTPUT: std::cell::RefCell<Option<Vec<u8>>> = const { std::cell::RefCell::new(None) }; }
struct OutputGuard;
impl Drop for OutputGuard {
    fn drop(&mut self) {
        OUTPUT.with(|p| {
            p.borrow_mut().take();
        });
    }
}
fn coordinates<S: serde::Serializer>(
    points: impl Iterator<Item = (f64, f64)>,
    count: usize,
    key: &str,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let offset = OUTPUT.with(|out| {
        let mut out = out.borrow_mut();
        let out = out
            .as_mut()
            .expect("binary polygon serializer outside encode");
        let offset = out.len();
        for (x, y) in points {
            out.extend_from_slice(&x.to_le_bytes());
            out.extend_from_slice(&y.to_le_bytes());
        }
        offset
    });
    use serde::ser::SerializeMap;
    let mut map = serializer.serialize_map(Some(1))?;
    map.serialize_entry(key, &[offset, count])?;
    map.end()
}
pub(crate) fn polygon<S: serde::Serializer>(p: &Polygon, serializer: S) -> Result<S::Ok, S::Error> {
    if OUTPUT.with(|out| out.borrow().is_none())
        || p.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return p.serialize(serializer);
    }
    coordinates(p.iter().map(|p| (p.x, p.y)), p.len(), "$xy", serializer)
}
struct Ring<'a>(&'a Polygon);
impl Serialize for Ring<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        polygon(self.0, s)
    }
}
pub(crate) fn polygons<S: serde::Serializer>(
    p: &[Polygon],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let mut seq = serializer.serialize_seq(Some(p.len()))?;
    for p in p {
        seq.serialize_element(&Ring(p))?;
    }
    seq.end()
}
pub(crate) fn optional_polygons<S: serde::Serializer>(
    p: &Option<Vec<Polygon>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match p {
        Some(p) => polygons(p, serializer),
        None => serializer.serialize_none(),
    }
}
struct BinaryValue<'a>(&'a Value);
impl Serialize for BinaryValue<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        match self.0 {
            Value::Array(a) => {
                if !a.is_empty() && OUTPUT.with(|o| o.borrow().is_some()) {
                    let xy = a.iter().all(|v| {
                        v.as_object().is_some_and(|m| {
                            m.len() == 2
                                && m.get("x").and_then(Value::as_f64).is_some()
                                && m.get("y").and_then(Value::as_f64).is_some()
                        })
                    });
                    if xy {
                        return coordinates(
                            a.iter().map(|v| (num(&v["x"]), num(&v["y"]))),
                            a.len(),
                            "$xy",
                            s,
                        );
                    }
                    let uv = a.iter().all(|v| {
                        v.as_array()
                            .is_some_and(|a| a.len() == 2 && a.iter().all(|v| v.as_f64().is_some()))
                    });
                    if uv {
                        return coordinates(
                            a.iter().map(|v| (num(&v[0]), num(&v[1]))),
                            a.len(),
                            "$uv",
                            s,
                        );
                    }
                }
                let mut seq = s.serialize_seq(Some(a.len()))?;
                for v in a {
                    seq.serialize_element(&BinaryValue(v))?;
                }
                seq.end()
            }
            Value::Object(o) => {
                let mut map = s.serialize_map(Some(o.len()))?;
                for (k, v) in o {
                    map.serialize_entry(k, &BinaryValue(v))?;
                }
                map.end()
            }
            v => v.serialize(s),
        }
    }
}
pub(crate) fn values<S: serde::Serializer>(p: &[Value], serializer: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let mut seq = serializer.serialize_seq(Some(p.len()))?;
    for v in p {
        seq.serialize_element(&BinaryValue(v))?;
    }
    seq.end()
}
pub fn encode<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, String> {
    OUTPUT.with(|p| {
        assert!(p.borrow().is_none());
        *p.borrow_mut() = Some(Vec::new());
    });
    let _guard = OutputGuard;
    let mut header = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    header.resize(header.len().div_ceil(8) * 8 + 4, b' '); // 4 + header length is aligned to 8.
    let planes = OUTPUT.with(|p| p.borrow_mut().take().unwrap());
    let mut out = Vec::with_capacity(4 + header.len() + planes.len());
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(&planes);
    Ok(out)
}
pub fn encode_value(value: &Value) -> Result<Vec<u8>, String> {
    encode(&BinaryValue(value))
}
pub fn decode_header(header: &str, bytes: &[u8]) -> Result<Value, String> {
    let mut value: Value = serde_json::from_str(header).map_err(|e| e.to_string())?;
    expand(&mut value, bytes, false)?;
    Ok(value)
}
fn expand(value: &mut Value, bytes: &[u8], objects: bool) -> Result<(), String> {
    if let Some(o) = value.as_object() {
        if o.len() == 1 {
            if let Some(d) = o.get("$f64") {
                let d = d
                    .as_array()
                    .filter(|d| d.len() == 2)
                    .ok_or("Invalid numeric plane")?;
                let offset = d[0]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or("Invalid numeric offset")?;
                let count = d[1]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or("Invalid numeric count")?;
                let end = count
                    .checked_mul(8)
                    .and_then(|n| offset.checked_add(n))
                    .ok_or("Numeric plane overflow")?;
                let data = bytes.get(offset..end).ok_or("Incomplete numeric plane")?;
                let mut values = Vec::with_capacity(count);
                for b in data.chunks_exact(8) {
                    let n = f64::from_le_bytes(b.try_into().unwrap());
                    if !n.is_finite() {
                        return Err("Invalid numeric plane value".into());
                    }
                    values.push(Value::from(n));
                }
                *value = Value::Array(values);
                return Ok(());
            }
            if let Some((key, descriptor)) = o
                .iter()
                .next()
                .filter(|(k, _)| k.as_str() == "$xy" || k.as_str() == "$uv")
            {
                let d = descriptor.as_array().ok_or("Invalid landuse coordinates")?;
                if d.len() != 2 {
                    return Err("Invalid landuse coordinates".into());
                }
                let offset = d[0]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or("Invalid coordinate offset")?;
                let count = d[1]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or("Invalid coordinate count")?;
                let end = count
                    .checked_mul(16)
                    .and_then(|n| offset.checked_add(n))
                    .ok_or("Landuse coordinate overflow")?;
                let data = bytes
                    .get(offset..end)
                    .ok_or("Incomplete landuse coordinates")?;
                if data
                    .chunks_exact(8)
                    .any(|b| !f64::from_le_bytes(b.try_into().unwrap()).is_finite())
                {
                    return Err("Invalid landuse coordinate".into());
                }
                let as_objects = objects && key == "$xy";
                let points = data
                    .chunks_exact(16)
                    .map(|b| {
                        let x = f64::from_le_bytes(b[..8].try_into().unwrap());
                        let y = f64::from_le_bytes(b[8..].try_into().unwrap());
                        if as_objects {
                            serde_json::json!({"x":x,"y":y})
                        } else {
                            serde_json::json!([x, y])
                        }
                    })
                    .collect();
                *value = Value::Array(points);
                return Ok(());
            }
        }
    }
    match value {
        Value::Array(a) => {
            for v in a {
                expand(v, bytes, objects)?;
            }
        }
        Value::Object(o) => {
            for v in o.values_mut() {
                expand(v, bytes, objects)?;
            }
        }
        _ => (),
    }
    Ok(())
}
/// Replay/diagnostic decoder: reconstruct the ordinary products, including point objects.
pub fn decode_reply(body: &[u8]) -> Result<Value, String> {
    let n = u32::from_le_bytes(
        body.get(..4)
            .ok_or("Incomplete landuse reply")?
            .try_into()
            .unwrap(),
    ) as usize;
    let end = n.checked_add(4).ok_or("Landuse reply overflow")?;
    let header = std::str::from_utf8(body.get(4..end).ok_or("Incomplete landuse reply header")?)
        .map_err(|e| e.to_string())?;
    let mut v = serde_json::from_str(header).map_err(|e| e.to_string())?;
    expand(
        &mut v,
        body.get(end..).ok_or("Incomplete landuse reply planes")?,
        true,
    )?;
    Ok(v)
}
