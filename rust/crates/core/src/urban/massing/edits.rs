//! In-place edits to procedural building massing.

use super::*;

/// Edit the procedural exterior in place, preserving every inhabited ring and
/// courtyard. A roof/storey change is not a new Houses placement problem.
pub(in crate::urban) fn is_shape_edit(patch: &Value) -> bool {
    patch.as_object().is_some_and(|p| p.keys().all(|k| k == "overrides"))
        && patch["overrides"].as_object().is_some_and(|o| !o.is_empty() && o.iter().all(|(key,value)| value.is_null() || matches!(key.as_str(),"roof"|"floors"|"roof_pitch_deg")))
}
pub(in crate::urban) fn apply_edit(massing: &mut Value, shapes: &[Shape], patch: &Value) -> Result<(), String> {
    if !is_shape_edit(patch) { return Err("This change requires an architectural model generation.".into()); }
    fn volume(v: &mut Value, ring: &[Point], holes: bool, patch: &Value) -> Result<(), String> {
        if v["minor"] == true { return Ok(()); }
        let controls = &patch["overrides"];
        if let Some(floors) = controls["floors"].as_u64() {
            if !(1..=100).contains(&floors) { return Err("Storeys must be between 1 and 100.".into()); }
            let base = v["base_m"].as_f64().unwrap_or(0.0);
            let eave = v["eave_m"].as_f64().ok_or("Missing native eave height")?;
            let old = v["floors"].as_u64().unwrap_or(1).max(1);
            v["eave_m"] = json!(round2(base + (eave-base) * floors as f64 / old as f64));
            v["floors"] = json!(floors);
        }
        let requested = controls["roof"].as_str();
        if requested.is_none() && controls["roof_pitch_deg"].is_null() { return Ok(()); }
        let kind = match requested.unwrap_or(v["roof"].as_str().unwrap_or("flat")) {
            "RF-GABLE" | "gable" => "gable", "RF-HIP" | "hip" => "hip", "RF-FLAT" | "flat" => "flat",
            "RF-DOME" | "dome" => "dome", "RF-PYRAMID" | "pyramid" => "pyramid", "RF-CONICAL" | "RF-CONE" | "cone" => "cone",
            "RF-SHED" | "shed" => "shed", "RF-BARREL" | "barrel" => "barrel",
            _ => return Err("This roof needs a new architectural model; the existing building has been retained.".into()),
        };
        if holes && kind != "flat" { return Err("This roof cannot cover the existing courtyard without changing its plan.".into()); }
        if matches!(v["form"].as_str(), Some("tree" | "mushroom")) { return Err("This organic building keeps its structural crown; choose another building style to change its form.".into()); }
        let pitch = controls["roof_pitch_deg"].as_f64().unwrap_or(35.0);
        if !pitch.is_finite() || !(0.0..=80.0).contains(&pitch) { return Err("Roof pitch must be between 0 and 80 degrees.".into()); }
        let frame = min_frame(ring).ok_or("This footprint cannot carry the requested roof")?;
        let roof = roof_of(ring,kind,pitch,frame.u,perp(frame.u));
        if roof.kind != kind { return Err("This roof does not fit the existing body; choose a flat or shed roof, or edit the footprint.".into()); }
        v["roof"] = json!(roof.kind); v["rise_m"] = json!(round2(roof.rise)); v["ridges"] = json!(roof.ridges);
        let obj = v.as_object_mut().ok_or("Invalid native massing")?;
        for key in ["pans","gables","roof_form","features","parapet_m"] { obj.remove(key); }
        Ok(())
    }
    let mut edited = massing.clone();
    let pieces = edited.as_array_mut().ok_or("Missing native procedural bodies")?;
    if pieces.len() != shapes.len() { return Err("Native procedural pieces do not match their footprints".into()); }
    for (piece,shape) in pieces.iter_mut().zip(shapes) {
        if let Some(volumes) = piece["volumes"].as_array_mut() {
            for v in volumes.iter_mut() {
                let ring: Vec<Point> = v["ring"].as_array().ok_or("Missing native volume ring")?.iter().map(|p| {
                    Ok(Point { x:p[0].as_f64().ok_or("Invalid native ring x")?, y:p[1].as_f64().ok_or("Invalid native ring y")? })
                }).collect::<Result<_,String>>()?;
                volume(v,&ring,false,patch)?;
            }
            let tallest = volumes.iter().filter(|v| v["minor"] != true).max_by(|a,b| a["eave_m"].as_f64().unwrap_or(0.0).total_cmp(&b["eave_m"].as_f64().unwrap_or(0.0))).cloned();
            if let Some(v) = tallest { for key in ["floors","eave_m","rise_m","roof","ridges"] { piece[key] = v[key].clone(); } }
        } else { volume(piece,&shape.outer,!shape.holes.is_empty(),patch)?; }
    }
    *massing = edited;
    Ok(())
}
