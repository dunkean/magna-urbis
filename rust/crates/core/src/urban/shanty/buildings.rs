//! Parcel allocation and building requests for shanty huts.

use super::*;

/// Append fixed small footprints after service allocation/consolidation. Their
/// households were capped by the remaining formal population budget at siting.
pub(in super::super) fn allocate(layout: &Layout, partition: &mut Partition) {
    let Some(e) = extension(layout) else { return };
    let Some(pr) = partition.programme.as_mut() else {
        return;
    };
    // Reallocation or a parcel override can leave less room than the default
    // cadastre used for siting. Those fixed footprints become open patches.
    let mut remaining = remaining_households(pr);
    if !pr.cultures.iter().any(|c| c.culture == layout.culture) {
        let Some(c) = culture::mapping_for(&layout.culture, &pr.context.period) else {
            return;
        };
        pr.cultures.push(c);
    }
    let pack = pr
        .cultures
        .iter()
        .find(|c| c.culture == layout.culture)
        .unwrap()
        .architecture_pack
        .clone();
    let demand_id = format!("{}/informal-housing", layout.key);
    if !pr.demands.iter().any(|d| d.id == demand_id) {
        let households = e
            .pockets
            .iter()
            .map(|p| p.huts.len())
            .sum::<usize>()
            .min(remaining) as f64;
        pr.demands.push(programme::Demand {
            id: demand_id.clone(),
            function: "domestic".into(),
            unit: "households".into(),
            requested: households,
            target_area: e
                .pockets
                .iter()
                .flat_map(|p| &p.huts)
                .map(|h| g::area(&h.shape))
                .sum(),
            target_frontage: 0.,
            provenance: vec!["informal-growth".into()],
            requires: vec![],
            parcel_capacity: households,
            built_capacity: 0.,
            open_capacity: 0.,
            deficit: households,
            reasons: vec!["Informal housing within the town population budget".into()],
            role: "dwelling.shanty".into(),
            sites: households as usize,
            site: "periphery".into(),
            landmark: false,
            district: "shanty".into(),
            placement: "parcel".into(),
            explicit: false,
        });
    }
    for p in &e.pockets {
        for hut in &p.huts {
            if partition.parcels.iter().any(|p| p.id == hut.id) {
                continue;
            }
            let housed = remaining > 0;
            remaining = remaining.saturating_sub(1);
            partition.parcels.push(Parcel {
                id: hut.id.clone(),
                shape: hut.shape.clone(),
                block: p.block,
                pressure: 0.8,
                envelope: housed.then(|| hut.shape.clone()),
                parent_ids: vec![],
                provenance: vec!["informal-growth".into()],
                family: if housed { "shanty" } else { "public" }.into(),
                reason: if housed {
                    p.flavour.clone()
                } else {
                    "population-budget-open-patch".into()
                },
                contacts: vec![],
                use_kind: if housed { "plot" } else { "place" }.into(),
                front: Some(hut.front),
                axis: hut.axis,
                rank: 4,
                access: Some(ParcelAccess {
                    kind: "public".into(),
                    street: Some(hut.street),
                    front_length: distance(hut.front[0], hut.front[1]),
                }),
            });
            if !housed {
                continue;
            }
            pr.allocations.push(programme::Allocation {
                parcel_id: hut.id.clone(),
                demand_id: demand_id.clone(),
                function: "domestic".into(),
                culture: layout.culture.clone(),
                architecture_pack: pack.clone(),
                capacity: 1.,
                unit: "households".into(),
                score: 1.,
                reasons: vec!["Informal housing within the town population budget".into()],
                role: "dwelling.shanty".into(),
                label: "Habitation informelle".into(),
                landmark: false,
                households: 1.,
                residents: None,
                housing_floor_need: None,
                district_role: "shanty".into(),
                wealth: 0.08,
            });
        }
        for (i, shape) in p.clearings.iter().enumerate() {
            let id = format!("{}/shanty/{}/court/{i}", layout.key, p.quarter);
            if partition.parcels.iter().any(|p| p.id == id) {
                continue;
            }
            partition.parcels.push(Parcel {
                id,
                shape: shape.clone(),
                block: p.block,
                pressure: 0.,
                envelope: None,
                parent_ids: vec![],
                provenance: vec!["informal-growth".into()],
                family: "public".into(),
                reason: "well-and-market-court".into(),
                contacts: vec![],
                use_kind: "place".into(),
                front: None,
                axis: Point { x: 1., y: 0. },
                rank: 4,
                access: None,
            });
        }
    }
}

/// Reuse the common preview/massing contract, with small cultural salvage roofs.
/// Separate roof pieces give visible patches in every existing 2D/3D painter.
pub(in super::super) fn request(
    layout: &Layout,
    parcel: &Parcel,
    surface: Surface<'_>,
    seed: &str,
) -> Result<Value, String> {
    let e = extension(layout).ok_or("Missing informal quarter")?;
    let pocket = e
        .pockets
        .iter()
        .find(|p| p.block == parcel.block)
        .ok_or("Missing informal pocket")?;
    let hut = pocket
        .huts
        .iter()
        .find(|h| h.id == parcel.id)
        .ok_or("Missing informal hut")?;
    let data = &catalogue()["shanty"][&pocket.flavour];
    let mut rng = Rng::new(seed);
    let covers = data["covers"]
        .as_array()
        .ok_or("Missing informal roof materials")?;
    let walls = data["walls"]
        .as_array()
        .ok_or("Missing informal wall materials")?;
    let wall = walls[rng.int(0, walls.len() as u32 - 1) as usize]
        .as_str()
        .unwrap_or("wood");
    let c = g::centroid(&hut.shape);
    let mut shapes = vec![hut.shape.clone()];
    if rng.chance(0.6) {
        let a = &hut.shape.outer;
        let t = rng.range(0.38, 0.72);
        let p = add(
            a[0],
            Point {
                x: a[1].x - a[0].x,
                y: a[1].y - a[0].y,
            },
            t,
        );
        let q = add(
            a[3],
            Point {
                x: a[2].x - a[3].x,
                y: a[2].y - a[3].y,
            },
            t,
        );
        shapes = vec![
            Shape {
                outer: vec![a[0], p, q, a[3]],
                holes: vec![],
            },
            Shape {
                outer: vec![p, a[1], a[2], q],
                holes: vec![],
            },
        ];
    }
    let parts = shapes
        .iter()
        .cloned()
        .map(|s| (s, "building"))
        .collect::<Vec<_>>();
    let arch =
        json!({"roof":if rng.chance(0.6){"shed"}else{"gable"},"material":"wood","storeys":[1,1]});
    let mut masses = massing::massing(&massing::Input {
        parts: &parts,
        arch: &arch,
        culture: &layout.culture,
        zone: "shanty",
        role: "dwelling.shanty",
        function: "domestic",
        landmark: false,
        wealth: 0.08,
        pressure: 0.8,
        small_home: true,
        population: layout.programme.as_ref().map_or(0, |p| p.population),
        fronts: &[hut.front],
        low_rural: true,
        distance: 1.3,
        seed,
        archetype: "",
        complex: false, user_core: false,
    });
    let eave = rng.range(2.0, 2.7);
    if let Some(masses) = masses.as_array_mut() {
        for mass in masses {
            let cover = covers[rng.int(0, covers.len() as u32 - 1) as usize]
                .as_str()
                .unwrap_or("thatch");
            let tone = rng.range(0.18, 0.85);
            let patch = |m: &mut Value| {
                m["cover"] = json!(cover);
                m["wall"] = json!(wall);
                m["tone"] = json!(tone);
                m["floors"] = json!(1);
                m["eave_m"] = json!(eave);
                m["overhang_m"] = json!(0.12);
            };
            patch(mass);
            if let Some(volumes) = mass["volumes"].as_array_mut() {
                for volume in volumes {
                    patch(volume);
                }
            }
        }
    }
    Ok(
        json!({"id":format!("{}/building",hut.id),"parcel_id":hut.id,"seed":seed,
        "cadastral":[hut.shape],"buildable":[hut.shape],"roof_domain":[hut.shape],"reserves":[],
        "preview":shapes,"preview_parts":parts.iter().map(|(_,l)|l).collect::<Vec<_>>(),"placement_hint":[hut.shape],
        "accesses":[{"id":format!("{}/path",hut.id),"segment":hut.front,"kind":"public","width_m":1.1}],
        "party_boundaries":[],"neighbors":[],"function":"domestic",
        "culture":{"culture":layout.culture,"pack":culture::architecture_pack(&layout.culture).unwrap_or(""),"mode":"historical_inspired","borrowing":null},
        "terrain":{"origin":c,"ground_z_m":surface.height_at(c),"gradient":[gradient(surface,c).x,gradient(surface,c).y],"water_z_m":null,"max_foundation_step_m":0.75},
        "programme":{"role":"dwelling.shanty","district_role":"shanty","label":"Habitation informelle","landmark":false,
            "composition":"detached","households":1,"wealth":0.08,"floors":[1,1],"shanty_flavour":pocket.flavour,
            "built_area_m2":g::area(&hut.shape),"party_walls":false,"massing":masses}}),
    )
}
