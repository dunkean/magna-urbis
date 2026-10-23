//! Native residential sources per architecture pack, as houses' automatic
//! residential query sees them (supported witnesses of the admission export's
//! `feasibility.profiles`: residential roles, no late-only source; the pack's
//! culture and period filters are left out, so this is a superset of what a
//! culture of the pack draws). City-side choices about courts follow the
//! composition `building_sites` finally asks (feasibility.rs): a court wish is
//! kept only where the lot holds a court source, and among them one serving
//! the programme's own houses role (a house → `dwelling`, a tenement →
//! `communal_dwelling`, a shop → `mixed_residential`) when the lot holds any
//! source of that role. Same envelope test (`parcel_envelope`, 0.6 m clearance).
use super::{Parcel, parcel_envelope};
use std::sync::OnceLock;

struct Source {
    pack: String,
    court: bool,
    role: String,
    /// Margined envelope (width along the front, depth), metres.
    envelope: [f64; 2],
    access: f64,
}

/// Same clearance as `feasibility::CLEARANCE`.
const CLEARANCE: f64 = 0.6;

fn sources() -> &'static [Source] {
    #[derive(serde::Deserialize)]
    struct Minimum {
        status: String,
        #[serde(default)]
        envelope_m: Option<[f64; 2]>,
        #[serde(default)]
        access_width_m: Option<f64>,
    }
    #[derive(serde::Deserialize, Default)]
    struct Temporal {
        #[serde(default)]
        late_only: bool,
    }
    #[derive(serde::Deserialize)]
    struct Row {
        pack: String,
        #[serde(default)]
        morphology: String,
        #[serde(default)]
        role: String,
        minimum_native: Minimum,
        #[serde(default)]
        temporal: Temporal,
    }
    #[derive(serde::Deserialize)]
    struct Feasibility {
        profiles: Vec<Row>,
    }
    #[derive(serde::Deserialize)]
    struct Export {
        feasibility: Feasibility,
    }
    static ALL: OnceLock<Vec<Source>> = OnceLock::new();
    ALL.get_or_init(|| {
        let export: Export =
            serde_json::from_str(include_str!("../../../../houses/data/urban-admission.json"))
                .expect("versioned houses admission catalogue");
        let mut all: Vec<Source> = export
            .feasibility
            .profiles
            .into_iter()
            .filter(|w| {
                !w.temporal.late_only
                    && w.minimum_native.status == "supported"
                    && matches!(
                        w.role.as_str(),
                        "dwelling"
                            | "residential_ensemble"
                            | "communal_dwelling"
                            | "mixed_residential"
                    )
            })
            .filter_map(|w| {
                let e = w.minimum_native.envelope_m?;
                Some(Source {
                    pack: w.pack,
                    court: w.morphology == "courtyard",
                    role: w.role,
                    envelope: [e[0] + CLEARANCE, e[1] + CLEARANCE],
                    access: w.minimum_native.access_width_m.unwrap_or(0.0).max(0.8),
                })
            })
            .collect();
        all.sort_by(|a, b| {
            (a.envelope[0] * a.envelope[1]).total_cmp(&(b.envelope[0] * b.envelope[1]))
        });
        all
    })
}

/// Houses source role a residential programme stands for (as
/// `feasibility::programme_source_role`).
pub(in super::super) fn source_role(role: &str, function: &str) -> &'static str {
    let is = |r: &str| role == r || role.starts_with(&format!("{r}."));
    if is("dwelling.tenement") {
        "communal_dwelling"
    } else if function == "mixed" || is("dwelling.shop") {
        "mixed_residential"
    } else {
        "dwelling"
    }
}

/// The pack's sources (filtered by `keep`) whose envelope the lot holds,
/// each distinct envelope tested once, smallest first.
fn fitting<'a>(
    p: &Parcel,
    pack: &'a str,
    keep: impl Fn(&Source) -> bool + 'a,
) -> impl Iterator<Item = &'static Source> + 'a {
    let lot = super::area(&p.shape);
    let mut tried: Vec<([u64; 3], bool)> = Vec::new();
    let p = p.clone();
    sources()
        .iter()
        .filter(move |s| s.pack == pack && keep(s))
        .take_while(move |s| s.envelope[0] * s.envelope[1] <= lot)
        .filter(move |s| {
            let key = [
                s.envelope[0].to_bits(),
                s.envelope[1].to_bits(),
                s.access.to_bits(),
            ];
            if let Some(&(_, fits)) = tried.iter().find(|(k, _)| *k == key) {
                return fits;
            }
            let fits = parcel_envelope(&p, s.envelope[0], s.envelope[1], s.access).is_some();
            tried.push((key, fits));
            fits
        })
}

/// The lot holds a native court source of the pack (of this houses role).
pub(in super::super) fn holds_court(p: &Parcel, pack: &str, role: Option<&str>) -> bool {
    fitting(p, pack, move |s| {
        s.court && role.is_none_or(|r| s.role == r)
    })
    .next()
    .is_some()
}

/// A home's court wish survives `building_sites`: the lot holds a court
/// source, and one of the programme's houses role whenever it holds any
/// source of that role.
pub(in super::super) fn court_kept(p: &Parcel, pack: &str, role: &str, function: &str) -> bool {
    let wanted = source_role(role, function);
    holds_court(p, pack, None)
        && (holds_court(p, pack, Some(wanted))
            || fitting(p, pack, move |s| s.role == wanted).next().is_none())
}
