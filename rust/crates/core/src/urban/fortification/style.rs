//! Resolve fortification styles from settlement inputs, cultural presets and configuration.

use std::sync::OnceLock;
use serde_json::Value;
use crate::rng::Rng;
use crate::urban::{LayoutConfig, catalogue, warnings};
use super::moat;

pub(in super::super) const STYLES: [&str; 9] = [
    "palisade",
    "gord",
    "hedge",
    "curtain",
    "flanked",
    "concentric",
    "rammed-earth",
    "wengcheng",
    "bastioned",
];

pub(super) fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../fortifications.json")).expect("fortification table")
    })
}

#[derive(Clone, Debug)]
pub(in super::super) struct Style {
    pub id: String,
    pub kind: String,
    pub material: String,
    pub curtain_width: f64,
    pub height: f64,
    pub tower_height: f64,
    /// Corner, gate and water towers.
    pub tower_shape: String,
    pub flank_shape: String,
    /// Flank, then corner/gate half size.
    pub tower_radius: [f64; 2],
    pub flank_depth: f64,
    /// `None`: no intermediate flanking towers.
    pub tower_spacing: Option<[f64; 2]>,
    /// Corner towers where the curtain turns more than this (degrees).
    pub corner_turn: Option<f64>,
    pub salients_only: bool,
    pub gate_towers: bool,
    pub gate_major: String,
    pub gate_minor: String,
    pub gate_min_pop: u32,
    pub gate_height: f64,
    pub ditch: String,
    pub ditch_p: f64,
    pub ditch_width: [f64; 2],
    /// Ditch depth (m), for the 3D moat; 0: from its width (`build`).
    pub ditch_depth: f64,
    /// Form of the ditch: an id of the `moats` table (`moat::form`), the one a circuit digs when none of
    /// `moat_forms` suits its site.
    pub moat_form: String,
    /// Forms of the culture and their weights (`moatForms`): a circuit draws one among those its site allows
    /// (`moat::choose_moat`, the form's `needs`).
    pub moat_forms: Vec<(String, u32)>,
    pub berm: f64,
    pub outworks: Vec<String>,
    pub outer_gap: [f64; 2],
    pub outer_width: f64,
    pub outer_height: f64,
    pub court_radius: [f64; 2],
    pub attached: f64,
    /// Hill town: the curtain follows the growth outline (contour trace).
    pub hill: bool,
    pub forced: bool,
    pub medieval: bool,
    pub dry_ditches: bool,
    pub timber_culture: bool,
    pub ditch_wetness: Option<f64>,
    /// Underdark town: the circuit closes the passages into its chamber (`cave_circuits`); its rock runs
    /// are open passages of the curtain and it digs no wet moat.
    pub cave: bool,
    /// Canal town (`lagoon::canal_town`): its canals feed a canal moat.
    pub canals: bool,
}

pub(super) fn num(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn pair(v: &Value, default: [f64; 2]) -> [f64; 2] {
    match v {
        Value::Array(a) if a.len() == 2 => [
            a[0].as_f64().unwrap_or(default[0]),
            a[1].as_f64().unwrap_or(default[1]),
        ],
        Value::Number(n) => {
            let x = n.as_f64().unwrap_or(default[0]);
            [x, x]
        }
        _ => default,
    }
}
pub(super) fn text(v: &Value, key: &str, default: &str) -> String {
    v[key].as_str().unwrap_or(default).to_string()
}
/// A `moatForms` list: `[{form, weight}]`.
fn forms(v: &Value) -> Option<Vec<(String, u32)>> {
    v.as_array().map(|a| a.iter().filter_map(|f| Some((f["form"].as_str()?.to_string(), f["weight"].as_u64().unwrap_or(1) as u32))).collect())
}

impl Style {
    fn preset(id: &str) -> Option<Style> {
        let v = &data()["styles"][id];
        if !v.is_object() {
            return None;
        }
        let shape = text(v, "towerShape", "round");
        let height = num(v, "heightM", 7.0);
        Some(Style {
            id: id.into(),
            kind: v["kind"].as_str()?.into(),
            material: text(v, "material", "stone"),
            curtain_width: num(v, "curtainWidthM", 3.0),
            height,
            tower_height: num(v, "towerHeightM", height + 3.0),
            flank_shape: text(v, "flankShape", &shape),
            tower_shape: shape,
            tower_radius: pair(&v["towerRadius"], [3.0, 3.0]),
            flank_depth: num(v, "flankDepthM", 0.0),
            tower_spacing: (!v.get("legacyTowerSpacing").unwrap_or(&v["towerSpacing"]).is_null())
                .then(|| pair(&v["towerSpacing"], [55.0, 55.0])),
            corner_turn: v["cornerTurn"].as_f64(),
            salients_only: v["salientsOnly"].as_bool().unwrap_or(false),
            gate_towers: v["gateTowers"].as_bool().unwrap_or(false),
            gate_major: text(v, "gate", "opening"),
            gate_minor: text(v, "minorGate", "opening"),
            gate_min_pop: v["gateMinPop"].as_u64().unwrap_or(0) as u32,
            gate_height: num(v, "gateHeightM", 0.0),
            ditch: text(v, "ditch", "none"),
            ditch_p: num(v, "ditchP", 1.0),
            ditch_width: pair(&v["ditchWidthM"], [0.0, 0.0]),
            ditch_depth: num(v, "ditchDepthM", 0.0),
            moat_form: text(v, "moatForm", "earth"),
            moat_forms: forms(&v["moatForms"]).unwrap_or_default(),
            berm: num(v, "bermM", 2.0),
            outworks: v["outworks"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            outer_gap: pair(&v["outerGapM"], [10.0, 14.0]),
            outer_width: num(v, "outerWidthM", 2.0),
            outer_height: num(v, "outerHeightM", 6.0),
            court_radius: pair(&v["courtRadiusM"], [18.0, 30.0]),
            attached: num(v, "attached", 0.0),
            hill: false,
            forced: false,
            medieval: false,
            dry_ditches: false,
            timber_culture: false,
            ditch_wetness: None,
            cave: false,
            canals: false,
        })
    }
    pub(in super::super) fn options(&mut self, cfg: &LayoutConfig) {
        self.medieval = cfg.medieval_walls && cfg.wall_tower_spacing.is_none() && self.kind == "wall";
        self.dry_ditches = cfg.dry_ditches;
        // A culture's timber rampart yields to an explicit style or « Muraille ».
        // A hedge (kraal thorn boma, halfling hedgerow) stays a hedge.
        self.timber_culture &= !self.forced && cfg.fortification != "wall" && self.kind != "hedge";
        if self.timber_culture || self.kind == "palisade" || self.material.starts_with("timber") {
            if self.timber_culture {
                self.id = "gord".into(); self.kind = "palisade".into();
                self.tower_shape = "square".into(); self.flank_shape = "square".into();
                self.gate_major = "timber".into(); self.gate_minor = "opening".into();
                self.outworks.clear(); self.attached = 0.0;
            }
            self.material = if self.id == "gord" { "timber-earth" } else { "timber" }.into();
            self.curtain_width = self.curtain_width.min(if self.id == "gord" { 3.0 } else { 1.5 });
            self.height = self.height.min(3.5);
            self.tower_height = self.tower_height.min(5.0);
        }
        self.ditch_wetness = cfg.ditch_wetness;
        // The canal share asked for wins over the culture's (`lagoon::params`).
        self.canals = cfg.lagoon_canals.map_or(self.canals, |v| v > 0.0);
        // « Moat »: by culture and site (empty), none, or one kind for the
        // whole circuit; a style without a ditch of its own digs a 6–10 m one.
        self.override_moat(&cfg.moat);
        if self.medieval {
            self.tower_spacing = Some(pair(&data()["styles"][&self.id]["towerSpacing"], [25.0, 35.0])
                .map(|v| v.clamp(20.0, 40.0)));
        }
        if let Some(spacing) = cfg.wall_tower_spacing.filter(|v| *v > 0.0) {
            self.tower_spacing = Some([spacing; 2]);
            self.medieval = true;
        }
    }
    fn override_moat(&mut self, moat: &str) {
        if matches!(moat, "none" | "dry" | "wet") {
            self.ditch = moat.into();
            self.ditch_p = 1.0;
            self.ditch_wetness = None;
            self.dry_ditches = false;
            if self.ditch_width[1] <= 0.0 { self.ditch_width = [6.0, 10.0]; }
        }
    }

    /// The construction of one circuit, after the town-wide and older-circuit defaults.
    pub(in super::super) fn for_wall(&self, edit: Option<&crate::urban::overrides::WallOverride>, cfg: &LayoutConfig, culture: &str, pop: u32) -> std::borrow::Cow<'_, Self> {
        let Some(edit) = edit.filter(|e| e.style.is_some() || e.moat.is_some()) else {
            return std::borrow::Cow::Borrowed(self);
        };
        let mut style = if let Some(id) = &edit.style {
            let mut s = styled(id, culture, pop);
            s.forced = true;
            s.options(cfg);
            s.cave = self.cave;
            s
        } else { self.clone() };
        if let Some(moat) = &edit.moat { style.override_moat(moat); }
        std::borrow::Cow::Owned(style)
    }
    /// Culture overrides (`fortifications.json` then `catalogue.json`).
    fn apply(&mut self, o: &Value) {
        if !o.is_object() {
            return;
        }
        let fixed = data()["styles"][&self.id]["fixedTowers"]
            .as_bool()
            .unwrap_or(false);
        let own_flank = data()["styles"][&self.id]["flankShape"].is_string();
        if let Some(m) = o["material"].as_str()
            && self.kind == "wall"
        {
            self.material = m.into();
        }
        if let Some(t) = o["towers"].as_str()
            && !fixed
        {
            self.tower_shape = t.into();
            if !own_flank {
                self.flank_shape = t.into();
            }
        }
        if o.get("towerSpacing").is_some() && !fixed {
            self.tower_spacing =
                (!o["towerSpacing"].is_null()).then(|| pair(&o["towerSpacing"], [55.0, 55.0]));
        }
        if o.get("cornerTurn").is_some() && !fixed {
            self.corner_turn = o["cornerTurn"].as_f64();
        }
        if o["towerRadius"].is_array() || o["towerRadius"].is_number() {
            self.tower_radius = pair(&o["towerRadius"], self.tower_radius);
        }
        if let Some(gate) = o["gate"].as_str()
            && self.kind == "wall"
            && self.id != "bastioned"
        {
            self.gate_major = gate.into();
        }
        if let Some(d) = o["ditch"].as_str()
            && d != "auto"
        {
            self.ditch = d.into();
        }
        if let Some(d) = o["ditchDepthM"].as_f64() {
            self.ditch_depth = d;
        }
        // A single form named overrides the forms drawn from; a list replaces the list.
        if let Some(f) = o["moatForm"].as_str() {
            self.moat_form = f.into();
            self.moat_forms.clear();
        }
        if let Some(f) = forms(&o["moatForms"]) {
            self.moat_forms = f;
        }
        // A culture's own breadth of ditch (the broad moats of Angkor, of a Japanese castle town).
        if o["ditchWidthM"].is_array() || o["ditchWidthM"].is_number() {
            self.ditch_width = pair(&o["ditchWidthM"], self.ditch_width);
        }
        if let Some(h) = o["heightM"].as_f64().or_else(|| o["heightM"][1].as_f64()) {
            self.tower_height += h - self.height;
            self.height = h;
        }
        if let Some(w) = o["curtainWidthM"].as_f64()
            && self.id != "bastioned"
        {
            self.curtain_width = w;
        }
        if let Some(a) = o["attached"].as_f64() {
            self.attached = a;
        }
    }
    /// Draw the ditch form among the culture's forms its site allows (`steep`: a hill circuit; the canals of a canal
    /// town), by weight, on a fork of `rng` (the other draws stay those of a culture with one form).
    pub(in super::super) fn draw_form(&mut self, rng: &Rng, steep: bool) {
        let forms: Vec<(&'static str, u32)> = self.moat_forms.iter().map(|(f, w)| (moat::form_id(f), *w)).filter(|&(f, w)| w > 0 && moat::suits(moat::form(f), steep, self.canals)).collect();
        let id = match forms.len() {
            0 => return,
            1 => forms[0].0,
            _ => forms[rng.fork("moat-form").weighted_index(&forms.iter().map(|f| f.1).collect::<Vec<_>>()).unwrap_or(0)].0,
        };
        self.set_form(id);
    }
    /// Dig the ditch in form `id`: its breadth follows the form's `widthScale` (`styled` sized it for the former one).
    pub(in super::super) fn set_form(&mut self, id: &str) {
        let scale = |f: &str| num(&data()["moats"][f], "widthScale", 1.0).max(0.1);
        let k = scale(id) / scale(&self.moat_form);
        self.ditch_width = [self.ditch_width[0] * k, self.ditch_width[1] * k];
        self.moat_form = id.into();
        self.moat_forms.clear();
    }
    /// The style the older inner circuit keeps: one step down, no ditch, no outworks.
    pub(in super::super) fn inner(&self, culture: &str, pop: u32) -> Style {
        let id = match self.id.as_str() {
            "bastioned" | "concentric" => "flanked",
            "flanked" if pop < 10_000 => "curtain",
            other => other,
        };
        let mut s = styled(id, culture, pop);
        s.hill = self.hill;
        s.ditch = "none".into();
        s.outworks.clear();
        s
    }
}

/// Enclosure type a style belongs to (`wall`, `palisade`, `hedge`).
pub(in super::super) fn family(style: &str) -> &'static str {
    match style {
        "palisade" | "gord" => "palisade",
        "hedge" => "hedge",
        _ => "wall",
    }
}
pub(super) fn culture_override(culture: &str) -> [&'static Value; 2] {
    [
        &data()["cultures"][culture],
        &catalogue()["cultures"][culture]["fortification"],
    ]
}
pub(super) fn group(culture: &str) -> &'static Value {
    let groups = &data()["groups"];
    groups
        .as_object()
        .and_then(|m| {
            m.values().find(|gr| {
                gr["cultures"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|c| c.as_str() == Some(culture)))
            })
        })
        .unwrap_or(&groups["default"])
}

/// A preset with the culture's tower shape and overrides, sized for `pop`.
pub(super) fn styled(id: &str, culture: &str, pop: u32) -> Style {
    let mut s = Style::preset(id).unwrap_or_else(|| Style::preset("curtain").expect("preset"));
    let c = &catalogue()["cultures"][culture];
    if !data()["styles"][id]["fixedTowers"]
        .as_bool()
        .unwrap_or(false)
        && let Some(t) = c["core"]["enclosure"]["towers"]
            .as_str()
            .or_else(|| c["render"]["towerShape"].as_str())
    {
        s.tower_shape = t.into();
        if !data()["styles"][id]["flankShape"].is_string() {
            s.flank_shape = t.into();
        }
    }
    // Group defaults (an earthwork rampart, ...), then the culture's own.
    s.apply(group(culture));
    s.timber_culture = group(culture)["timberRampart"].as_bool().unwrap_or(false);
    for o in culture_override(culture) {
        s.apply(o);
    }
    s.canals = c["render"]["canals"].is_object() && c["render"]["canals"]["share"].as_f64().is_none_or(|v| v > 0.0);
    if id == "wengcheng" {
        if pop < 10_000 {
            s.material = "rammed-earth".into();
        }
        let t = ((pop as f64 / 20_000.0).max(1.0).log10()).clamp(0.0, 1.0);
        s.curtain_width = 6.0 + 6.0 * t;
    }
    // The form sets the breadth of the ditch: a double ditch and a ceremonial moat are broad, a ringfort's is slight.
    let broad = num(&data()["moats"][s.moat_form.as_str()], "widthScale", 1.0);
    s.ditch_width = [s.ditch_width[0] * broad, s.ditch_width[1] * broad];
    let min = data()["styles"][id]["outworkMinPop"].as_u64().unwrap_or(0);
    if (pop as u64) < min {
        s.outworks.retain(|w| w != "antemural" && w != "citadel");
    }
    s
}

pub(in super::super) struct Inputs<'a> {
    pub culture: &'a str,
    pub pop: u32,
    pub period: &'a str,
    pub state: &'a str,
    pub archetype: &'a str,
    pub forced: &'a str,
    /// Length-weighted relief of the curtain (`terrain`).
    pub relief: f64,
}

/// Prosperity in [0, 1] from population and settlement condition.
fn prosperity(pop: u32, state: &str) -> f64 {
    let base = ((f64::from(pop.max(1)).log10() - 3.3) / 1.7).clamp(0.0, 1.0);
    base * match state {
        "declining" => 0.75,
        "abandoned" | "ruined" => 0.5,
        _ => 1.0,
    }
}

fn period_allows(style: &str, period: &str, culture: &str) -> bool {
    match period {
        "A" => {
            style != "bastioned"
                && (style != "concentric" || matches!(culture, "byzantine-greek" | "roman-core"))
        }
        "M" => style != "bastioned",
        _ => true,
    }
}

/// The style of a fortification of `kind`, deterministic per site (`rng` is
/// the site's `fortification` stream; only forks of it are drawn).
pub(in super::super) fn resolve(kind: &str, i: &Inputs, rng: &Rng, warnings: &mut Vec<String>) -> Style {
    let material = culture_override(i.culture)
        .iter()
        .rev()
        .find_map(|o| o["material"].as_str())
        .unwrap_or("");
    let mut id = match kind {
        "hedge" => "hedge".to_string(),
        "palisade" if material == "timber-earth" => "gord".into(),
        "palisade" => "palisade".into(),
        _ => String::new(),
    };
    let mut forced = false;
    if i.forced != "auto" && STYLES.contains(&i.forced) {
        if family(i.forced) == family_of_kind(kind) {
            id = i.forced.into();
            forced = true;
        } else {
            warnings.push(warnings::incompatible_wall_style(i.forced, kind));
        }
    }
    if id.is_empty() {
        let p = prosperity(i.pop, i.state);
        let defensive = matches!(i.archetype, "hilltop" | "spur" | "pass" | "island");
        let [own, cat] = culture_override(i.culture);
        let table = if cat["styles"].is_array() {
            &cat["styles"]
        } else if own["styles"].is_array() {
            &own["styles"]
        } else {
            &group(i.culture)["styles"]
        };
        let candidates: Vec<(&str, u32)> = table
            .as_array()
            .into_iter()
            .flatten()
            .filter(|c| {
                let s = c["style"].as_str().unwrap_or("");
                family(s) == "wall"
                    && Style::preset(s).is_some()
                    && c["minPop"].as_u64().is_none_or(|m| i.pop as u64 >= m)
                    && c["maxPop"].as_u64().is_none_or(|m| i.pop as u64 <= m)
                    && c["periods"]
                        .as_array()
                        .is_none_or(|a| a.iter().any(|x| x.as_str() == Some(i.period)))
                    && period_allows(s, i.period, i.culture)
                    && (c["needs"].as_str() != Some("strong") || p > 0.6 || defensive)
            })
            .map(|c| {
                (
                    c["style"].as_str().unwrap_or("flanked"),
                    c["weight"].as_u64().unwrap_or(1).max(1) as u32,
                )
            })
            .collect();
        id = if candidates.is_empty() {
            if i.pop >= 3000 { "flanked" } else { "curtain" }.into()
        } else {
            let weights: Vec<u32> = candidates.iter().map(|c| c.1).collect();
            let k = rng
                .fork("style")
                .weighted_index(&weights)
                .unwrap_or_default();
            candidates[k].0.into()
        };
    }
    // Terrain modifiers apply after the draw, so the draw itself stays stable.
    let hill = i.relief > 0.07 && family(&id) == "wall";
    if hill && !forced && matches!(id.as_str(), "bastioned" | "concentric") {
        warnings.push(warnings::wall_style_for_relief(&id));
        id = "flanked".into();
    }
    let mut s = styled(&id, i.culture, i.pop);
    s.hill = hill;
    s.forced = forced;
    // The ditch form is drawn with the style, so everything that reads the moat width (gate budget, harbour fronts,
    // the works) reads the width of the form the circuit digs.
    s.draw_form(rng, i.relief > moat::HILL_RELIEF);
    s
}
fn family_of_kind(kind: &str) -> &'static str {
    match kind {
        "palisade" => "palisade",
        "hedge" => "hedge",
        _ => "wall",
    }
}
