//! Compact wire form of the resource fields for the V2 view layers: grid meta, the rock
//! class and water bytes, soil fields and potentials quantised to u8 over a fixed range
//! (base64 in JSON), plus the deposit and anchor lists. Only what the layers show.
use super::{potentials, ResourceFields, ROCKS};
use serde::Serialize;

/// u8 raster: `value = lo + byte / 255 * (hi - lo)`.
#[derive(Serialize)]
pub struct Field {
    pub id: &'static str,
    pub lo: f32,
    pub hi: f32,
    pub data: String,
}

#[derive(Serialize)]
pub struct DepositView {
    pub id: String,
    pub family: &'static str,
    pub x: f64,
    pub y: f64,
    pub ore_t: f64,
    pub recoverable_t: f64,
    pub outcrop: bool,
}

#[derive(Serialize)]
pub struct AnchorView {
    pub id: String,
    pub kind: &'static str,
    pub resource: &'static str,
    pub x: f64,
    pub y: f64,
    pub potential: f32,
    pub annual_t: f32,
    pub season_mask: u16,
}

#[derive(Serialize)]
pub struct Payload {
    pub version: u32,
    pub nx: usize,
    pub ny: usize,
    /// Block side (m) and the map-frame position of the upper-left block corner.
    pub cell: f64,
    pub x0: f64,
    pub y0: f64,
    pub context: &'static str,
    pub rocks: Vec<&'static str>,
    /// Rock class per block ([`ROCKS`] order), base64.
    pub bedrock: String,
    /// 0 land, 1 sea, 2 lake, 3 river, base64.
    pub water: String,
    pub fields: Vec<Field>,
    pub deposits: Vec<DepositView>,
    pub anchors: Vec<AnchorView>,
}

/// Soil fields shown by the layers, with their quantisation range.
const SOIL: [(&str, f32, f32); 5] =
    [("soil_depth", 0.0, 3.0), ("stoniness", 0.0, 1.0), ("moisture", 0.0, 1.0), ("drainage", 0.0, 4.0), ("alluvial", 0.0, 1.0)];

pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= c.len() {
                out.push(T[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn quantise(id: &'static str, values: impl Iterator<Item = f32>, lo: f32, hi: f32) -> Field {
    let bytes: Vec<u8> = values.map(|v| (((v - lo) / (hi - lo)).clamp(0.0, 1.0) * 255.0).round() as u8).collect();
    Field { id, lo, hi, data: base64(&bytes) }
}

impl ResourceFields {
    pub fn payload(&self) -> Payload {
        let mut fields = Vec::with_capacity(SOIL.len() + potentials::IDS.len());
        for (id, lo, hi) in SOIL {
            let f = match id {
                "soil_depth" => quantise(id, self.soil_depth.iter().copied(), lo, hi),
                "stoniness" => quantise(id, self.stoniness.iter().copied(), lo, hi),
                "moisture" => quantise(id, self.moisture.iter().copied(), lo, hi),
                "drainage" => quantise(id, self.drainage.iter().map(|&d| d as f32), lo, hi),
                _ => quantise(id, self.alluvial.iter().copied(), lo, hi),
            };
            fields.push(f);
        }
        for id in potentials::IDS {
            fields.push(quantise(id, self.potentials.get(id).iter().copied(), 0.0, 1.0));
        }
        Payload {
            version: 1,
            nx: self.nx,
            ny: self.ny,
            cell: self.cell,
            x0: self.x0,
            y0: self.y0,
            context: self.prior.context,
            rocks: ROCKS.to_vec(),
            bedrock: base64(&self.bedrock),
            water: base64(&self.water),
            fields,
            deposits: self
                .deposits
                .iter()
                .map(|d| DepositView { id: format!("{:x}", d.id), family: d.family, x: d.x.round(), y: d.y.round(), ore_t: d.ore_t.round(), recoverable_t: d.recoverable_t.round(), outcrop: d.outcrop })
                .collect(),
            anchors: self
                .anchors
                .iter()
                .map(|a| AnchorView { id: format!("{:x}", a.id), kind: a.kind, resource: a.resource, x: a.x.round(), y: a.y.round(), potential: a.potential, annual_t: a.annual_t, season_mask: a.season_mask })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
