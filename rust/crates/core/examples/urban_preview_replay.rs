//! Replay one preview from frozen cadastral inputs without a server or city generation.
//! Args: layout.json partition.json offset seed expected-id output.json
//! The support raster is deliberately flat: only preview/programme are exported,
//! never a placement request or terrain-dependent architectural admission.
use magna_urbis_core::urban::{Layout, Partition, Surface, building_sites::BuildingSiteIndex};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 7 {
        return Err(
            "Expected layout.json partition.json offset seed expected-id output.json".into(),
        );
    }
    let layouts: Vec<Layout> = vec![serde_json::from_slice(&std::fs::read(&args[1])?)?];
    let partitions: Vec<Partition> = vec![serde_json::from_slice(&std::fs::read(&args[2])?)?];
    let width = layouts[0]
        .blocks
        .iter()
        .flat_map(|b| &b.shape.outer)
        .fold(1.0_f64, |m, p| m.max(p.x).max(p.y))
        + 1.;
    let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0])?;
    let offset = args[3].parse::<usize>()?;
    let page = index.page(
        &args[4],
        &layouts,
        &partitions,
        Surface {
            geometry: None,
            width,
            n: 1,
            height: &[0.],
            water: &[0],
        },
        &[0.],
        None,
        offset,
        1,
        24 * 1024 * 1024,
    )?;
    let request = page
        .requests
        .first()
        .ok_or("Missing preview at this offset")?;
    if request["id"].as_str() != Some(&args[5]) {
        return Err("Offset does not match expected site ID; refusing a different witness".into());
    }
    let result = serde_json::json!({"id":request["id"],"parcel_id":request["parcel_id"],
        "preview":request["preview"],"preview_parts":request["preview_parts"],
        "programme":request["programme"],"offset":offset,"total":page.total,
        "scope":"preview only; synthetic flat support, not architectural admission"});
    std::fs::write(&args[6], serde_json::to_vec_pretty(&result)?)?;
    println!(
        "{}",
        serde_json::json!({"id":request["id"],"parts":request["preview"].as_array().map(Vec::len)})
    );
    Ok(())
}
