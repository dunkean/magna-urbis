//! Explicit, bounded descriptor export; never enumerate/generate the catalogue.
//! cargo run -p magna-urbis-houses --example admission_witnesses -- --style AS-ISL-B14::default --style EUR-MED-B07::flat_stone --out witnesses.json
use magna_urbis_houses::admission_witness::{
    ADMISSION_WITNESS_VERSION, AdmissionWitness, AdmissionWitnessEntrance,
    AdmissionWitnessGeometry, AdmissionWitnessIdentity, admission_witness_source_sha256,
    cached_admission_witness,
};
use magna_urbis_houses::geometry::area;
use magna_urbis_houses::model::Surface;
use magna_urbis_houses::style_index::style_index;
use serde::Serialize;
use std::io::Write;

const EXPORT_VERSION: &str = "native-admission-witness-descriptors-1";

#[derive(Serialize)]
struct BodyMetrics<'a> {
    body_id: &'a str,
    footprint_area_m2: f64,
    structural_floor_area_m2: f64,
    actual_level_count: usize,
}

/// Borrow only lightweight retained geometry: never serialize the witness itself.
#[derive(Serialize)]
struct Descriptor<'a> {
    identity: &'a AdmissionWitnessIdentity,
    geometry: &'a AdmissionWitnessGeometry,
    body_footprint: &'a Surface,
    roof_footprint: &'a Surface,
    bearing_domain: &'a Surface,
    entry_wall_solids: &'a Surface,
    entrance: &'a AdmissionWitnessEntrance,
    site_entry: &'a AdmissionWitnessEntrance,
    local_bounds_m: [f64; 4],
    site_bounds_m: [f64; 4],
    envelope_m: [f64; 2],
    site_envelope_m: [f64; 2],
    access_width_m: f64,
    nominal_dimensions_m: [f64; 2],
    actual_primary_floors: Option<u32>,
    actual_body_footprint_area_m2: f64,
    actual_structural_floor_area_m2: f64,
    body_metrics: Vec<BodyMetrics<'a>>,
    capacity: Option<u32>,
    placement_certified: bool,
}

impl<'a> From<&'a AdmissionWitness> for Descriptor<'a> {
    fn from(w: &'a AdmissionWitness) -> Self {
        let body_metrics: Vec<_> = w
            .geometry
            .bodies
            .iter()
            .map(|body| BodyMetrics {
                body_id: &body.body_id,
                footprint_area_m2: area(&body.footprint),
                structural_floor_area_m2: body
                    .levels
                    .iter()
                    .map(|level| area(&level.footprint))
                    .sum(),
                actual_level_count: body.levels.len(),
            })
            .collect();
        Self {
            identity: &w.identity,
            geometry: &w.geometry,
            body_footprint: &w.body_footprint,
            roof_footprint: &w.roof_footprint,
            bearing_domain: &w.bearing_domain,
            entry_wall_solids: &w.entry_wall_solids,
            entrance: &w.entrance,
            site_entry: &w.site_entry,
            local_bounds_m: w.local_bounds_m,
            site_bounds_m: w.site_bounds_m,
            envelope_m: w.envelope_m,
            site_envelope_m: [
                w.site_bounds_m[2] - w.site_bounds_m[0],
                w.site_bounds_m[3] - w.site_bounds_m[1],
            ],
            access_width_m: w.access_width_m,
            nominal_dimensions_m: w.nominal_dimensions_m,
            actual_primary_floors: w.primary_floors,
            actual_body_footprint_area_m2: area(&w.body_footprint),
            actual_structural_floor_area_m2: body_metrics
                .iter()
                .map(|b| b.structural_floor_area_m2)
                .sum(),
            body_metrics,
            capacity: None,
            placement_certified: false,
        }
    }
}

#[derive(Serialize)]
struct Refusal {
    style_id: String,
    reason: String,
}

#[derive(Serialize)]
struct Export<'a> {
    version: &'static str,
    witness_version: &'static str,
    source_sha256: &'static str,
    coordinate_frame: &'static str,
    units: &'static str,
    requested_styles: &'a [String],
    witnesses: Vec<Descriptor<'a>>,
    refusals: Vec<Refusal>,
    placement_certified: bool,
    scope: &'static str,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut styles = Vec::new();
    let mut output = None;
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--style" => {
                let style = args.next().filter(|v| !v.starts_with("--")).ok_or("--style requires a complete recipe::variant identity")?;
                if styles.contains(&style) { return Err(format!("Duplicate --style {style}").into()); }
                styles.push(style);
            }
            "--out" => {
                if output.is_some() { return Err("Duplicate --out".into()); }
                output = Some(args.next().filter(|v| !v.starts_with("--")).ok_or("--out requires a path")?);
            }
            _ => return Err(format!("Unknown argument {flag}; use repeated --style recipe::variant and optional --out path").into()),
        }
    }
    if styles.is_empty() || styles.len() > 16 {
        return Err("Provide 1..16 explicit --style values. This example never exports the complete catalogue implicitly.".into());
    }
    let index = style_index()?;
    // Reject malformed/unknown identifiers before constructing any geometry.
    for id in &styles {
        if index.get(id).is_none() {
            return Err(format!("Unknown declared style: {id}").into());
        }
    }
    // Keep the requested Arcs alive while borrowing their lightweight fields;
    // cache eviction must not invalidate a descriptor during serialization.
    let mut retained = Vec::new();
    let mut refusals = Vec::new();
    for id in &styles {
        match cached_admission_witness(id) {
            Ok(witness) => retained.push(witness),
            Err(reason) => refusals.push(Refusal {
                style_id: id.clone(),
                reason,
            }),
        }
    }
    let witnesses = retained
        .iter()
        .map(|w| Descriptor::from(w.as_ref()))
        .collect();
    let export = Export {
        version: EXPORT_VERSION,
        witness_version: ADMISSION_WITNESS_VERSION,
        source_sha256: admission_witness_source_sha256(),
        coordinate_frame: "unshifted_native_local_xy_z",
        units: "metres",
        requested_styles: &styles,
        witnesses,
        refusals,
        placement_certified: false,
        scope: "One frozen native minimum per requested style at size=1. Coordinates are retained without simplification or quantization. Body footprints and structural floor areas are actual geometric areas, not useful area or occupancy. Source ranges are not actual storeys. Validate full identity and every supplied rigid pose, access contact, terrain, neighbour, roof and cadastral constraint before accepting placement.",
    };
    if let Some(path) = &output {
        let mut writer = std::io::BufWriter::new(std::fs::File::create(path)?);
        serde_json::to_writer_pretty(&mut writer, &export)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
        eprintln!(
            "{} witnesses, {} refusals, {} bytes -> {path}",
            export.witnesses.len(),
            export.refusals.len(),
            std::fs::metadata(path)?.len()
        );
    } else {
        let mut writer = std::io::BufWriter::new(std::io::stdout().lock());
        serde_json::to_writer_pretty(&mut writer, &export)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    if !export.refusals.is_empty() {
        return Err(
            "One or more explicit styles refused native construction; see exported refusals."
                .into(),
        );
    }
    Ok(())
}
