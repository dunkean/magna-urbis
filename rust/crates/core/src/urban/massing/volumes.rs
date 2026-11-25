//! Procedural building volumes and their display representation.

use super::*;

pub(super) struct Vol {
    pub(super) ring: Vec<Point>,
    pub(super) n: u32,
    pub(super) eave: f64,
    pub(super) roof: Roof,
    pub(super) cover: &'static str,
    pub(super) wall: &'static str,
    pub(super) tone: f64,
    pub(super) parapet: f64,
    pub(super) features: Vec<Value>,
    pub(super) overhang: f64,
    pub(super) trim: &'static str,
    pub(super) form: &'static str,
    /// Height (m) of the posts the body stands on.
    pub(super) stilts: f64,
    /// Inhabitants' size against a human, for doors and windows.
    pub(super) body: f64,
    /// Bottom of the volume above the building ground (m): an upper tier, a
    /// chimney or a dormer starts above the ground.
    pub(super) base: f64,
    /// Stands on the volume under it (resolved once the lot's volumes stand).
    pub(super) stack: bool,
    /// Ridge axis and the high side of a shed, for the composed roof.
    pub(super) axis: Point,
    pub(super) high: Point,
    /// The roof's true kind (`halfhip`, `gablet`, `gambrel`…); `roof.kind` is
    /// the plain kind a renderer without the pans falls back to.
    pub(super) form_roof: &'static str,
    /// Roof pitch (degrees) the volume was raised with.
    pub(super) pitch: f64,
    /// Eaves past the walls (m) when the mass rule sets them.
    pub(super) eaves: Option<f64>,
    /// Composed roof (`forms::roof`): visible pans, and wall faces above the wall top.
    pub(super) pans: Option<Vec<Vec<[f64; 3]>>>,
    pub(super) gables: Vec<Vec<[f64; 3]>>,
    /// Small decorative volume (chimney, dormer, porch).
    pub(super) minor: bool,
    /// `none` | `door` | "" (windows by storey).
    pub(super) openings: &'static str,
}
fn faces_json(faces: &[Vec<[f64; 3]>]) -> Value {
    Value::Array(faces.iter().map(|f| Value::Array(f.iter().flat_map(|p| p.iter().map(|&c| json!(round2(c)))).collect())).collect())
}
impl Vol {
    /// Whether `forms::roof` composes this volume's roof: a pitched kind on a
    /// plain walled body (huts, tents, tree and pile houses keep their own).
    pub(super) fn composes(&self) -> bool {
        super::super::forms::roof::composed(self.form_roof) && self.pans.is_none() && self.form.is_empty()
            && self.overhang == 0.0 && self.stilts == 0.0 && self.roof.rise > 0.05
    }
    /// Raises the whole volume by `d` metres (a stacked part on its support).
    pub(super) fn lift(&mut self, d: f64) {
        if d <= 0.0 {
            return;
        }
        self.base += d;
        self.eave += d;
        for p in self.pans.iter_mut().flatten().chain(self.gables.iter_mut()).flatten() {
            p[2] += d;
        }
    }
    pub(super) fn json(&self) -> Value {
        let mut v = json!({"ring":ring_json(&self.ring),"floors":self.n,"eave_m":round2(self.eave),"rise_m":round2(self.roof.rise),
            "roof":self.roof.kind,"ridges":self.roof.ridges,"cover":self.cover,"wall":self.wall,"tone":round2(self.tone)});
        if self.base > 0.0 {
            v["base_m"] = json!(round2(self.base));
        }
        if let Some(pans) = &self.pans {
            v["pans"] = faces_json(pans);
            if !self.gables.is_empty() {
                v["gables"] = faces_json(&self.gables);
            }
        }
        if self.form_roof != self.roof.kind {
            v["roof_form"] = json!(self.form_roof);
        }
        if self.minor {
            v["minor"] = json!(true);
        }
        if !self.openings.is_empty() {
            v["openings"] = json!(self.openings);
        }
        if self.parapet > 0.0 {
            v["parapet_m"] = json!(round2(self.parapet));
        }
        if self.overhang > 0.0 {
            v["overhang_m"] = json!(round2(self.overhang));
        }
        if !self.form.is_empty() && self.form != "stilt" {
            v["form"] = json!(self.form);
        }
        if self.stilts > 0.0 {
            v["stilts_m"] = json!(round2(self.stilts));
        }
        if !self.trim.is_empty() {
            v["trim"] = json!(self.trim);
        }
        if !self.features.is_empty() {
            v["features"] = Value::Array(self.features.clone());
        }
        if self.body > 0.0 {
            v["body_scale"] = json!(round2(self.body));
        }
        v
    }
}

/// One preview piece on its way to the display contract: an entry already
/// written (stepped terrace, ruin, court ring) or the volumes to finish.
pub(super) enum Piece {
    Raw(Value),
    Vols(Vec<Vol>, u32),
}

/// Whether `p` lies inside ring `r` (even-odd).
pub(super) fn within(r: &[Point], p: Point) -> bool {
    let mut inside = false;
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y) {
            inside = !inside;
        }
    }
    inside
}
