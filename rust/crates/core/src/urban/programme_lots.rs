//! Spare cadastral cells belong to an occupied property, not to nobody.
use super::*;
use super::super::geometry as g;

pub(super) fn consolidate(layout: Option<&Layout>, part: &mut Partition) {
    let Some(mut pr) = part.programme.take() else { return };
    if roles::is_isolated(&pr.context.intent) {
        part.programme = Some(pr);
        return;
    }
    let allocations: HashMap<_, _> = pr.allocations.iter().map(|a| (a.parcel_id.as_str(), a)).collect();
    let rings: Vec<_> = layout.into_iter().flat_map(|l| &l.enclosures).map(|e|Shape { outer:e.path.clone(),holes:vec![] }).collect();
    let inside = |p: &Parcel| rings.iter().any(|r|g::contains(r,g::interior_point(&p.shape)));
    let wall_land: Vec<_> = part.parcels.iter().map(|p|p.use_kind == "reserve" && p.reason == "reserve" && inside(p)).collect();
    let ids: HashMap<_, _> = part.parcels.iter().enumerate().map(|(i,p)| (p.id.as_str(), i)).collect();
    let mut neighbours = vec![vec![]; part.parcels.len()];
    for edge in &pr.adjacency {
        if let (Some(&a), Some(&b)) = (ids.get(edge.a.as_str()), ids.get(edge.b.as_str())) {
            neighbours[a].push(b);
            neighbours[b].push(a);
        }
    }
    let spare: Vec<bool> = part.parcels.iter().enumerate().map(|(i,p)| {
        let locked = part.config.as_ref().is_some_and(|c| c.overrides.parcels.contains_key(&p.id));
        let owned = p.use_kind == "garden" && p.access.as_ref().is_some_and(|a| a.kind == "attached")
            && p.parent_ids.iter().any(|id| allocations.get(id.as_str()).is_some_and(|a| !a.role.starts_with("open.")));
        !locked && !owned && (p.family != "reserve" || wall_land[i]) && !matches!(p.reason.as_str(), "camp-open" | "camp-centre" | "intentional-garden")
            && allocations.get(p.id.as_str()).map_or(
                wall_land[i] || matches!(p.use_kind.as_str(), "plot" | "compound" | "garden" | "residual"),
                |a| a.role == "open.garden")
    }).collect();
    let mut owners: Vec<Option<usize>> = part.parcels.iter().enumerate().map(|(i,p)| {
        allocations.get(p.id.as_str()).filter(|a| !a.role.starts_with("open.")
            && !matches!(a.function.as_str(), "market" | "common")).map(|_| i).or_else(|| {
                if !p.access.as_ref().is_some_and(|a|a.kind == "attached") { return None; }
                p.parent_ids.iter().find_map(|id| allocations.get(id.as_str()).filter(|a| !a.role.starts_with("open.")
                    && !matches!(a.function.as_str(),"market"|"common")).and_then(|_|ids.get(id.as_str()).copied()))
            })
    }).collect();
    // A wall remnant may extend an existing public place along a real edge.
    for i in 0..owners.len() {
        if wall_land[i] && owners[i].is_none() {
            owners[i] = neighbours[i].iter().copied().find(|&j|allocations.get(part.parcels[j].id.as_str()).is_some_and(|a|a.role != "open.garden"));
        }
    }
    let passage: Vec<_> = part.parcels.iter().map(|p| matches!(p.use_kind.as_str(), "court" | "path")).collect();
    // Shared courts connect a compound's rear land too; streets never do.
    loop {
        let next: Vec<_> = (0..spare.len()).filter(|&i| (spare[i] || passage[i]) && owners[i].is_none()).filter_map(|i| {
            neighbours[i].iter().copied().filter(|&j| (part.parcels[j].block == part.parcels[i].block || wall_land[i] || wall_land[j]) && owners[j].is_some())
                .max_by(|&a,&b| shared(&part.parcels[i].shape, &part.parcels[a].shape)
                    .total_cmp(&shared(&part.parcels[i].shape, &part.parcels[b].shape)).then_with(|| b.cmp(&a)))
                .map(|j| (i, owners[j].unwrap()))
        }).collect();
        if next.is_empty() { break; }
        for (i, owner) in next { owners[i] = Some(owner); }
    }
    let fields: BTreeSet<_> = (0..spare.len()).filter(|&i|layout.is_some() && spare[i] && owners[i].is_none() && !inside(&part.parcels[i]))
        .map(|i|part.parcels[i].id.clone()).collect();
    drop(allocations);
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..spare.len() {
        if spare[i] && let Some(owner) = owners[i] { groups.entry(owner).or_default().push(i); }
    }
    let mut removed = BTreeSet::new();
    let mut redirects = HashMap::new();
    for (owner, cells) in groups {
        let shapes: Vec<_> = std::iter::once(part.parcels[owner].shape.clone())
            .chain(cells.iter().map(|&i| part.parcels[i].shape.clone())).collect();
        // Final reconciliation attaches new yards without re-cutting the house.
        let merged = if layout.is_none() || cells.iter().any(|&i|wall_land[i]) { g::union(&shapes) } else { vec![] };
        if merged.len() == 1 {
            let ids: Vec<_> = cells.iter().map(|&i| part.parcels[i].id.clone()).collect();
            let root = &mut part.parcels[owner];
            // Keep the house's access and admission witness at their original place.
            root.shape = merged.into_iter().next().unwrap();
            root.parent_ids.extend(ids.iter().cloned());
            root.provenance.push("occupied-yard-merge".into());
            for id in ids {
                redirects.insert(id.clone(), root.id.clone());
                removed.insert(id);
            }
        } else {
            let id = part.parcels[owner].id.clone();
            for i in cells {
                let p = &mut part.parcels[i];
                p.use_kind = "garden".into();
                p.reason = "attached-rear-land".into();
                p.parent_ids = vec![id.clone()];
                p.access = Some(super::super::ParcelAccess { kind:"attached".into(), street:None, front_length:0. });
            }
        }
    }
    part.parcels.retain(|p| !removed.contains(&p.id));
    pr.allocations.retain(|a| !removed.contains(&a.parcel_id));
    for p in &mut part.parcels {
        if p.reason == "attached-rear-land" {
            p.front = None;
            p.contacts.clear();
            p.access = Some(super::super::ParcelAccess { kind:"attached".into(), street:None, front_length:0. });
            for id in &mut p.parent_ids {
                if let Some(owner) = redirects.get(id) { *id = owner.clone(); }
            }
        }
    }
    // A fringe row that the bounded programme cannot build stays whole field.
    let mut open: BTreeMap<usize,Vec<Parcel>> = BTreeMap::new();
    part.parcels.retain(|p| {
        if fields.contains(&p.id) { open.entry(p.block).or_default().push(p.clone()); false } else { true }
    });
    pr.allocations.retain(|a|!fields.contains(&a.parcel_id));
    for cells in open.values() {
        let mut shapes = g::union(&cells.iter().map(|p|p.shape.clone()).collect::<Vec<_>>());
        if shapes.is_empty() { shapes = cells.iter().map(|p|p.shape.clone()).collect(); }
        for (i,shape) in shapes.into_iter().enumerate() {
            let mut p = cells[0].clone();
            p.id = format!("{}/field/{i}",p.id);
            p.parent_ids = cells.iter().map(|p|p.id.clone()).collect();
            p.shape = shape;
            p.use_kind = "reserve".into();
            p.family = "reserve".into();
            p.reason = "fringe-field".into();
            p.front = None;
            p.contacts.clear();
            p.envelope = None;
            p.rank = 99;
            p.access = Some(super::super::ParcelAccess {kind:"reserved".into(),street:None,front_length:0.});
            p.provenance.push("unparcelled-fringe".into());
            part.parcels.push(p);
        }
    }
    // Disconnected open land is a declared garden, not an unused housing plot.
    let gardens: BTreeSet<_> = pr.allocations.iter().filter(|a| a.role == "open.garden").map(|a|a.parcel_id.as_str()).collect();
    for p in &mut part.parcels {
        if gardens.contains(p.id.as_str()) {
            p.use_kind = "garden".into();
            if p.reason != "attached-rear-land" { p.reason = "public-garden".into(); }
        }
    }
    for d in pr.demands.iter_mut().filter(|d| d.role == "open.garden") {
        d.requested = pr.allocations.iter().filter(|a| a.demand_id == d.id).map(|a| a.capacity).sum();
        d.target_area = d.requested;
        d.parcel_capacity = d.requested;
        d.deficit = d.requested;
    }
    pr.adjacency = graph(part).0;
    part.programme = Some(pr);
}
