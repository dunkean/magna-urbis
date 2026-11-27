use crate::urban::Layout;
use super::super::super::geometry::rectangle;
use super::*;
use serde_json::json;

fn lot(shape: Shape, front: [Point; 2], pressure: f64) -> Parcel {
    Parcel {
        pressure,
        envelope: None,
        id: "lot".into(),
        parent_ids: vec![],
        provenance: vec![],
        family: "frontage".into(),
        reason: String::new(),
        contacts: vec![super::super::super::ParcelContact {
            a: front[0],
            b: front[1],
            street: 0,
            rank: 1,
            length: length(sub(front[1], front[0])),
            kind: "public".into(),
        }],
        shape,
        block: 0,
        axis: Point { x: 1.0, y: 0.0 },
        use_kind: "plot".into(),
        front: Some(front),
        rank: 1,
        access: None,
    }
}

#[test]
fn smial_sampling_bounds_diagonal_slivers_and_keeps_ordinary_lattice() {
    // A 0.1 m diagonal strip has 4000 m² of land, but a 1.6e9 m²
    // frame box. The old area-based step attempted 240 million cells.
    let step = (4000.0_f64 / 600.0).sqrt();
    assert!(round_samples((0.0, 0.0, 40_000.0, 40_000.1), step).len() <= 1024);
    assert!(round_samples((0.0, 0.0, 0.0, 20.0), step).is_empty());
    assert!(round_samples((0.0, 0.0, f64::INFINITY, 20.0), step).is_empty());
    let ordinary = round_samples((2.0, 3.0, 22.0, 33.0), 1.0);
    let expected: Vec<_> = (0..30).flat_map(|j| (0..20).map(move |i|
        Point { x: 2.5 + i as f64, y: 3.5 + j as f64 })).collect();
    assert_eq!(ordinary, expected);

    let mut p = lot(Shape { outer: vec![Point { x: 0.0, y: 0.0 },
        Point { x: 40_000.0, y: 40_000.0 }, Point { x: 40_000.0, y: 40_000.1 },
        Point { x: 0.0, y: 0.1 }], holes: vec![] },
        [Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 }], 0.5);
    p.contacts.clear();
    p.front = None;
    let morph = tissue("primitive", "smial");
    assert!(preview(&p, &home(&morph, "dwelling.house", "shire-sliver")).is_empty());
}
/// Probe: `S7_DUMP=<dir with layout.json, partition.json>` counts why the
/// street range of core plots is refused (12 m deep, 3 m wing).
#[test]
#[ignore]
fn probe_front_ranges() {
    let Ok(dir) = std::env::var("S7_DUMP") else {
        return;
    };
    let read = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
    let layout: Layout = serde_json::from_str(&read("layout.json")).unwrap();
    let partition: super::super::super::Partition =
        serde_json::from_str(&read("partition.json")).unwrap();
    let mut why: std::collections::BTreeMap<&str, usize> = Default::default();
    for p in &partition.parcels {
        if p.use_kind != "plot" || layout.blocks[p.block].zone != "core" {
            continue;
        }
        let shape = super::super::super::geometry::normalized(p.shape.clone());
        let fronts: Vec<Front> = parcel_fronts(p)
            .into_iter()
            .filter(|f| length(sub(f.b, f.a)) > 0.3)
            .collect();
        let Some(run) = runs(&fronts)
            .into_iter()
            .find(|r| length(sub(r.last().unwrap().b, r[0].a)) >= 2.0)
        else {
            *why.entry("no-run").or_default() += 1;
            continue;
        };
        let f = frame_of(&run, &shape);
        let key = match front_range_why(&shape.outer, &run, f.n, 12.0, 3.0, true, &fronts) {
            Ok(_) => "ok",
            Err(e) => e,
        };
        if key == "thin" && why.get("thin").copied().unwrap_or(0) < 12 {
            let r = front_range_why(&shape.outer, &run, f.n, 12.0, 0.0, true, &fronts)
                .unwrap_or_default();
            eprintln!(
                "thin {:.2} lot {:.2} area {:.0} run {:.1} n {} {:?}",
                thickness(&r, None),
                thickness(&shape.outer, None),
                area(&shape),
                run.iter().map(|f| length(sub(f.b, f.a))).sum::<f64>(),
                r.len(),
                r.iter()
                    .map(|q| (q.x.round(), q.y.round()))
                    .collect::<Vec<_>>()
            );
        }
        *why.entry(key).or_default() += 1;
    }
    eprintln!("{why:?}");
}
/// Probe: `OCC_DUMP=<dir with layout.json, partition.json>` previews every
/// allocated core plot (party walls from `OCC_PARTY`, default on) and
/// prints the ids (suffix filter `OCC_LOTS`, comma separated) left empty.
#[test]
#[ignore]
fn probe_previews() {
    let Ok(dir) = std::env::var("OCC_DUMP") else {
        return;
    };
    let read = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
    let layout: Layout = serde_json::from_str(&read("layout.json")).unwrap();
    let partition: super::super::super::Partition =
        serde_json::from_str(&read("partition.json")).unwrap();
    let only: Vec<String> = std::env::var("OCC_LOTS")
        .map(|s| s.split(',').map(str::to_owned).collect())
        .unwrap_or_default();
    let party = std::env::var("OCC_PARTY").map_or(true, |v| v != "0");
    let programme = partition.programme.as_ref().unwrap();
    let (mut n, mut empty) = (0, 0);
    for a in &programme.allocations {
        let Some(p) = partition.parcels.iter().find(|p| p.id == a.parcel_id) else {
            continue;
        };
        if (only.is_empty() && layout.blocks[p.block].zone != "core")
            || (!only.is_empty() && !only.iter().any(|s| p.id.ends_with(s.as_str())))
        {
            continue;
        }
        let Some((zone, morph)) = super::super::super::culture::parcel_morph(
            &layout, &partition, &a.culture, p.block,
        ) else {
            continue;
        };
        let o = Occupancy {
            morph: &morph,
            zone,
            function: &a.function,
            role: &a.role,
            landmark: a.landmark,
            party_walls: party,
            wealth: 0.5,
            seed: &p.id,
            pack: &a.architecture_pack,
            court_lot: false,
            court_kept: Some(true),
        };
        if kind(&o) == Kind::Open {
            continue;
        }
        n += 1;
        let (parts, form) = preview_form(p, &o, None);
        if parts.is_empty() {
            empty += 1;
            eprintln!("empty {} {} {:?}", p.id, a.role, form);
        } else if !only.is_empty() {
            for (s, l) in &parts {
                eprintln!(
                    "{l} {:.0} m² thick {:.2} {:?}",
                    area(s),
                    thickness(&s.outer, s.holes.first().map(|h| h.as_slice())),
                    s.outer
                        .iter()
                        .map(|q| (q.x.round(), q.y.round()))
                        .collect::<Vec<_>>()
                );
            }
        }
    }
    eprintln!("core plots {n}, empty {empty}");
}
fn tissue(op: &str, typology: &str) -> Morph {
    Morph {
        value: json!({"buildingOp":op,"plotOp":"burgage","arch":{"typology":typology},
            "coverage":{"core":[0.9,0.96],"edge":[0.55,0.68]},"buildDepth":{"core":[10.0,14.0]},
            "setback":{"core":[0.0,0.3]},"sideGap":{"core":[0.0,0.0]},"roomDepth":[4.5,6.0],
            "bigCourtChance":0.1,"courtyardMin":9,"openCourtChance":0.0}),
    }
}

#[test]
fn reddit_street_alignment_keeps_loose_homes_square_to_their_frontage() {
    let mut morph = tissue("streetFrontRow", "gabled-row-house");
    morph.value["sideGap"]["edge"] = json!([1.5, 2.5]);
    let mut p = lot(Shape { outer: vec![
        Point{x:0.,y:0.},Point{x:30.,y:0.},Point{x:48.,y:45.},Point{x:18.,y:45.}
    ], holes:vec![] }, [Point{x:0.,y:0.},Point{x:30.,y:0.}], 0.2);
    let mut oblique = 0;
    let mut illustrated = false;
    let mut svg = String::from("<svg xmlns='http://www.w3.org/2000/svg' viewBox='-8 -8 130 65'><rect x='-8' y='-8' width='130' height='65' fill='#eee5cc'/>");
    for k in 0..20 {
        let seed = format!("rural-opts-{k}");
        let mut o = home(&morph, "dwelling.house", &seed); o.zone = "edge"; o.party_walls = false;
        let before = preview(&p, &o);
        assert_eq!(serde_json::to_vec(&before).unwrap(), serde_json::to_vec(&preview(&p, &o)).unwrap());
        let leaning = before.iter().any(|s| s.outer.windows(2).any(|e| {
            let d = sub(e[1],e[0]); d.x.abs() > 0.1 && d.y.abs() > 0.1
        }));
        if leaning { oblique += 1; }
        p.provenance.push("street-aligned-home".into());
        let after = preview(&p, &o); p.provenance.clear();
        assert!(!after.is_empty());
        for s in &after {
            assert!(super::super::super::geometry::difference(s,&p.shape).iter().map(area).sum::<f64>() < 0.01);
            for e in s.outer.iter().zip(s.outer.iter().cycle().skip(1)).take(s.outer.len()) {
                let d = sub(*e.1,*e.0);
                assert!(d.x.abs() < 1e-6 || d.y.abs() < 1e-6, "{seed}: {s:?}");
            }
        }
        if leaning && !illustrated {
            illustrated = true;
            for (offset, pieces) in [(0., &before),(65., &after)] {
                let d = |r:&[Point]| r.iter().enumerate().map(|(i,q)|format!("{}{},{}",if i==0{"M"}else{"L"},q.x+offset,q.y)).collect::<String>()+"Z";
                svg += &format!("<path d='{}' fill='#d8cea7' stroke='#867655'/><path d='M{},-2h30' stroke='#bba47b' stroke-width='3'/>",d(&p.shape.outer),offset);
                for s in pieces { svg += &format!("<path d='{}' fill='#8c7051' stroke='#493f30' stroke-width='.3'/>",d(&s.outer)); }
            }
        }
    }
    assert!(oblique > 0, "the witness must expose the old lot-axis choice");
    if let Ok(path) = std::env::var("RURAL_OPTS_SVG") { std::fs::write(path, svg+"</svg>").unwrap(); }
    let off: super::super::super::ParcelConfig = serde_json::from_value(json!({"streetAlignedHomes":false,"denserSmallholdings":false})).unwrap();
    assert_eq!(serde_json::to_vec(&off).unwrap(),serde_json::to_vec(&super::super::super::ParcelConfig::default()).unwrap());
}

#[test]
fn giant_house_scale_enlarges_the_body_inside_its_lot() {
    let p = lot(rectangle(0.0, 0.0, 60.0, 80.0), [Point { x: 0.0, y: 0.0 }, Point { x: 60.0, y: 0.0 }], 0.5);
    let mut morph = tissue("hall", "stone-hall");
    morph.value["id"] = json!("european-organic/village");
    let human = preview(&p, &home(&morph, "dwelling.house", "giant-body"));
    morph.value["id"] = json!("giant-hold/village");
    let giant = preview(&p, &home(&morph, "dwelling.house", "giant-body"));
    let human_area: f64 = human.iter().map(area).sum();
    let giant_area: f64 = giant.iter().map(area).sum();
    assert!((9.0..=16.0).contains(&(giant_area / human_area)), "giant {giant_area}m2, human {human_area}m2");
    assert!(giant.iter().flat_map(|s| difference(s, &p.shape)).map(|s| area(&s)).sum::<f64>() < 1e-5);
}

/// Exact A3 corner-lot witness: two individually near-axis street edges
/// converge into a 13.77-degree tip. Their direction alone is insufficient.
#[test]
fn acute_street_band_uses_a_whole_body_instead_of_the_a3_needle() {
    let data: serde_json::Value =
        serde_json::from_str(include_str!("../../../../tests/fixtures/a3-needle.json")).unwrap();
    let parcel: Parcel = serde_json::from_value(data["parcel"].clone()).unwrap();
    let old: Shape = serde_json::from_value(data["preview"].clone()).unwrap();
    let fronts: Vec<_> = parcel_fronts(&parcel)
        .into_iter()
        .filter(|f| length(sub(f.b, f.a)) > 0.3)
        .collect();
    let main = runs(&fronts)
        .into_iter()
        .find(|r| length(sub(r.last().unwrap().b, r[0].a)) >= 2.0)
        .unwrap();
    let f = frame_of(&main, &parcel.shape);
    assert!(
        !square_enough(&old.outer, &f, &fronts, 15.0),
        "A3 13.77-degree tip passed the rectangular-band gate"
    );
    let (s0, s1, t0, t1) = f.range(&old.outer);
    let mut lay = Lay {
        b: &old.outer,
        fronts: &fronts,
        f,
        wing: 3.0,
        pieces: vec![],
    };
    assert!(lay.band(t0, t1).is_none());
    assert!(
        lay.body(s0, s1, t0, t1, (s0 + s1) * 0.5) > 9.0,
        "Rejecting a needle must still try a nonempty whole body"
    );
    let result = finish(&parcel.shape, lay.pieces, 3.0);
    assert_eq!(result.len(), 1);
    let replacement = &result[0].0;
    assert_eq!(replacement.outer.len(), 4);
    assert!(thickness(&replacement.outer, None) >= 3.0 - 1e-6);
    assert!(
        difference(replacement, &parcel.shape)
            .iter()
            .map(area)
            .sum::<f64>()
            < 1e-5
    );
    for i in 0..4 {
        let a = unit(sub(replacement.outer[(i + 1) % 4], replacement.outer[i]));
        let b = unit(sub(
            replacement.outer[(i + 2) % 4],
            replacement.outer[(i + 1) % 4],
        ));
        assert!(dot(a, b).abs() < 1e-7, "Body corner is not square");
    }
}

/// Invariant (houses against the wall): a row lot backing onto the town
/// wall (`curtain-backed`) builds its rear range on the curtain, its rear
/// party wall: some building piece reaches the rear line, for every seed.
#[test]
fn curtain_backed_rows_build_against_the_wall() {
    let mut p = lot(
        rectangle(0.0, 0.0, 8.0, 34.0),
        [Point { x: 0.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }],
        0.5,
    );
    p.provenance.push("curtain-backed".into());
    let mut morph = tissue("streetFrontRow", "gabled-row-house");
    morph.value["coverage"]["core"] = json!([0.4, 0.5]);
    for seed in ["a", "b", "c", "d", "e", "f"] {
        let fp = preview(
            &p,
            &Occupancy {
                morph: &morph,
                zone: "core",
                function: "domestic",
                role: "dwelling",
                landmark: false,
                party_walls: true,
                wealth: 0.5,
                seed,
                pack: "EUR-MED",
                court_lot: false,
                court_kept: None,
            },
        );
        let rear = fp
            .iter()
            .flat_map(|s| s.outer.iter())
            .map(|q| q.y)
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(
            rear > 34.0 - 1e-6,
            "seed {seed}: rear of the buildings at {rear}"
        );
    }
}

/// A dense European block of 6 m burgage lots: street walls share the
/// cadastral party walls exactly and the block is mostly built; a courtyard
/// culture on the same lots yields a real inner court (a hole).
#[test]
fn dense_rows_share_party_walls_and_courtyard_cultures_keep_a_court() {
    let lots: Vec<Parcel> = (0..8)
        .map(|i| {
            let x = i as f64 * 6.0;
            lot(
                rectangle(x, 0.0, x + 6.0, 30.0),
                [Point { x, y: 0.0 }, Point { x: x + 6.0, y: 0.0 }],
                0.9,
            )
        })
        .collect();
    let morph = tissue("streetFrontRow", "gabled-row-house");
    let occupancy = |seed: &'static str| Occupancy {
        morph: &morph,
        zone: "core",
        function: "domestic",
        role: "dwelling",
        landmark: false,
        party_walls: true,
        wealth: 0.5,
        seed,
        pack: "MED-ANT",
        court_lot: false,
        court_kept: None,
    };
    let seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
    let mut built = 0.0;
    for (p, seed) in lots.iter().zip(seeds) {
        let fp = preview(p, &occupancy(seed));
        assert!(!fp.is_empty());
        // The street body spans the whole frontage: zero side gap.
        let (x0, x1) = fp[0]
            .outer
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
                (a.min(q.x), b.max(q.x))
            });
        let (lx0, lx1) = (p.shape.outer[0].x, p.shape.outer[1].x);
        assert!(
            (x0 - lx0).abs() < 1e-6 && (x1 - lx1).abs() < 1e-6,
            "{x0} {x1}"
        );
        for s in &fp {
            assert!(s.outer.iter().all(|q| q.x >= lx0 - 1e-6
                && q.x <= lx1 + 1e-6
                && q.y >= -1e-6
                && q.y <= 30.0 + 1e-6));
        }
        built += fp.iter().map(area).sum::<f64>();
    }
    let block = 48.0 * 30.0;
    assert!(built / block > 0.55, "coverage {}", built / block);

    let court_morph = tissue("courtyardHouse", "domus");
    let wide = lot(
        rectangle(0.0, 0.0, 32.0, 30.0),
        [Point { x: 0.0, y: 0.0 }, Point { x: 32.0, y: 0.0 }],
        0.7,
    );
    let fp = preview(
        &wide,
        &Occupancy {
            morph: &court_morph,
            ..occupancy("court")
        },
    );
    // The court house first, then at most three back buildings on the
    // ground outside its box.
    assert!(!fp.is_empty() && fp.len() <= 4, "{} pieces", fp.len());
    assert_eq!(fp[0].holes.len(), 1, "a courtyard house keeps its court");
    assert!(area(&fp[0]) < 32.0 * 30.0 - 9.0 && area(&fp[0]) > 0.3 * 32.0 * 30.0);
}
/// A parish church on its reserved lot is a nave, a choir and a west tower
/// at the street, all inside the lot; a mosque gets a minaret and a hall.
/// A3 audit witnesses: a body whose ring doubles back over itself (a
/// zero-width spike left by clipping, 01-l row/tenement lots) loses the
/// spike; a 13 degree inn range triangle is not a building piece.
#[test]
fn preview_pieces_have_no_spike_and_no_needle() {
    let pt = |x: f64, y: f64| Point { x, y };
    let lot = rectangle(0.0, 0.0, 40.0, 40.0);
    let spiked = vec![
        pt(0.0, 0.0),
        pt(10.0, 0.0),
        pt(10.0, 10.0),
        pt(5.0, 10.0),
        pt(2.0, 6.0),
        pt(5.0, 10.0004),
        pt(0.0, 10.0),
    ];
    let needle = vec![pt(20.0, 20.0), pt(32.0, 20.0), pt(20.0, 22.8)];
    let out = finish(
        &lot,
        vec![(spiked, None, "building"), (needle, None, "range")],
        3.0,
    );
    assert_eq!(out.len(), 1, "{out:?}");
    assert_eq!(out[0].0.outer.len(), 4, "{:?}", out[0].0.outer);
    assert!((area(&out[0].0) - 100.0).abs() < 0.1);
}

#[test]
fn shape_review_preview_undoes_unsound_splits_and_keeps_the_mill_wheel() {
    let lot = rectangle(0.0, 0.0, 40.0, 40.0);
    let short_needle = poly(&[
        (26.0, 8.0), (35.0, 8.0), (35.0, 16.0), (30.0, 16.0),
        (29.98, 16.4), (29.9, 16.0), (26.0, 16.0),
    ]);
    let out = finish(
        &lot,
        vec![
            (rectangle(0.0, 0.0, 10.0, 7.0).outer, None, "shop-body"),
            (rectangle(0.0, 7.0, 10.0, 9.0).outer, None, "lean-rear"),
            (rectangle(12.0, 0.0, 13.5, 8.0).outer, None, "wheel"),
            (rectangle(15.0, 0.0, 17.2, 8.0).outer, None, "nave"),
            (short_needle.outer, None, "building"),
        ],
        3.0,
    );
    assert_eq!(out.iter().map(|(_, label)| *label).collect::<Vec<_>>(), ["shop-body", "wheel"]);
    assert!((area(&out[0].0) - 90.0).abs() < 1e-6, "the lean-to joins the body");
    assert!((area(&out[1].0) - 12.0).abs() < 1e-6, "the designed wheel survives");
}

/// Invariant (« mitoyenneté continue »): on a bent street with party walls
/// leaning 25 degrees (beyond the 15-degree square band), every attached
/// row lot still builds its street range along its whole frontage, from
/// party wall to party wall, so neighbours leave no gap on the street.
#[test]
fn attached_rows_keep_a_continuous_street_wall_on_bent_streets_and_leaning_walls() {
    let pt = |x: f64, y: f64| Point { x, y };
    // Street bending by 12 degrees at x = 8; party walls lean 25 degrees.
    let front = |x: f64| {
        if x <= 8.0 {
            pt(x, 0.0)
        } else {
            pt(x, (x - 8.0) * 0.21)
        }
    };
    let lean = 30.0 * 25f64.to_radians().tan();
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for (i, (x0, x1)) in [(0.0, 8.0), (8.0, 15.0), (2.0, 13.0)]
        .into_iter()
        .enumerate()
    {
        let (a, b) = (front(x0), front(x1));
        let mut outer = vec![a];
        if x0 < 8.0 && x1 > 8.0 {
            outer.push(front(8.0));
        }
        outer.extend([b, pt(b.x - lean, b.y + 30.0), pt(a.x - lean, a.y + 30.0)]);
        let mut p = lot(
            Shape {
                outer,
                holes: vec![],
            },
            [a, b],
            0.9,
        );
        if x0 < 8.0 && x1 > 8.0 {
            let m = front(8.0);
            p.contacts[0].b = m;
            p.contacts[0].length = length(sub(m, a));
            let mut c = p.contacts[0].clone();
            (c.a, c.b, c.length) = (m, b, length(sub(b, m)));
            p.contacts.push(c);
        }
        for k in 0..6 {
            let seed = format!("wall-{i}-{k}");
            let o = Occupancy {
                morph: &morph,
                zone: "core",
                function: "domestic",
                role: "dwelling.row",
                landmark: false,
                party_walls: true,
                wealth: 0.5,
                seed: &seed,
                pack: "EUR-MED",
                court_lot: false,
                court_kept: None,
            };
            let fp = preview(&p, &o);
            let body = fp.first().expect("street body");
            let on = |q: Point| {
                super::super::super::geometry::contains(body, q)
                    || (0..body.outer.len()).any(|j| {
                        // Within the culture's street setback (core: 0 to 0.3 m).
                        distance(q, body.outer[j], body.outer[(j + 1) % body.outer.len()])
                            < 0.31
                    })
            };
            for c in &p.contacts {
                for t in 0..=10 {
                    let q = add(c.a, scale(sub(c.b, c.a), t as f64 / 10.0));
                    assert!(on(q), "{seed}: street front at {q:?} not built");
                }
            }
        }
    }
}

/// Invariant (preview = asked composition, A3 « 162 mansions »): a home's
/// court is previewed only where the lot holds a native court source of
/// its pack serving its houses role; elsewhere the preview is the row
/// `building_sites` then asks (its feasible composition keeps simple
/// wishes), with a row's closed back court where the wings fit.
#[test]
fn a_home_court_is_previewed_only_where_a_native_court_source_fits() {
    let morph = tissue("courtyardHouse", "domus");
    let pt = |x: f64, y: f64| Point { x, y };
    let small = lot(
        rectangle(0.0, 0.0, 22.0, 26.0),
        [pt(0.0, 0.0), pt(22.0, 0.0)],
        0.7,
    );
    let large = lot(
        rectangle(0.0, 0.0, 34.0, 32.0),
        [pt(0.0, 0.0), pt(34.0, 0.0)],
        0.7,
    );
    // MED-ANT's atrium house (a `dwelling` court source) needs 28.1 x 28.3 m.
    let kept = |l: &Parcel| {
        super::super::courts::court_kept(l, "MED-ANT", "dwelling.mansion", "domestic")
    };
    assert!(!kept(&small) && kept(&large));
    // EUR-MED's only court source is an ensemble: a house keeps no court.
    assert!(!super::super::courts::court_kept(
        &large,
        "EUR-MED",
        "dwelling.mansion",
        "domestic"
    ));
    let mut courts = 0;
    for k in 0..12 {
        let seed = format!("mansion-{k}");
        let o = Occupancy {
            morph: &morph,
            zone: "core",
            function: "domestic",
            role: "dwelling.mansion",
            landmark: false,
            party_walls: true,
            wealth: 0.8,
            seed: &seed,
            pack: "MED-ANT",
            court_lot: false,
            court_kept: None,
        };
        // The small lot is a row (at most with a row's back court).
        let (_, form) = preview_parts(&small, &o);
        assert_eq!(form, Some(Kind::Row), "{seed}");
        let (parts, form) = preview_parts(&large, &o);
        if form == Some(Kind::Court) {
            courts += 1;
            assert!(parts.iter().any(|(s, _)| !s.holes.is_empty()), "{seed}");
        }
    }
    assert!(courts >= 6, "large lots keep their court: {courts}/12");
}

/// Typology diversity: wide dense-core row lots also build closed back
/// courts (street range, side wings, rear range) where every wing keeps
/// the culture's width; narrow lots stay plain rows.
#[test]
fn wide_dense_row_lots_also_build_closed_back_courts() {
    let morph = tissue("streetFrontRow", "gabled-row-house");
    let seeds: Vec<String> = (0..24).map(|i| format!("hof-{i}")).collect();
    fn occupancy<'a>(morph: &'a Morph, seed: &'a str) -> Occupancy<'a> {
        Occupancy {
            morph,
            zone: "core",
            function: "domestic",
            role: "dwelling",
            landmark: false,
            party_walls: true,
            wealth: 0.5,
            seed,
            pack: "EUR-MED",
            court_lot: false,
            court_kept: None,
        }
    }
    let courts = |w: f64| {
        let p = lot(
            rectangle(0.0, 0.0, w, 42.0),
            [Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }],
            0.9,
        );
        let mut n = 0;
        for seed in &seeds {
            for s in preview(&p, &occupancy(&morph, seed)) {
                if let Some(h) = s.holes.first() {
                    n += 1;
                    assert!(thickness(&s.outer, Some(h)) >= 3.0 - 1e-6);
                    assert!(ring_area(h).abs() >= 12.0 - 1e-6);
                    assert!(s.outer.iter().all(|q| q.x >= -1e-6 && q.x <= w + 1e-6));
                }
            }
        }
        n
    };
    let wide = courts(16.0);
    assert!(
        wide >= 4 && wide < seeds.len(),
        "{wide} courts on 16 m lots"
    );
    assert_eq!(
        courts(8.0),
        0,
        "an 8 m lot has no room for two wings and a court"
    );
    assert!(courts(10.0) > 0, "a 10 m lot keeps a 4 m light court");
}

#[test]
fn landmark_previews_follow_their_programme() {
    let site = lot(
        rectangle(0.0, 0.0, 36.0, 60.0),
        [Point { x: 0.0, y: 0.0 }, Point { x: 36.0, y: 0.0 }],
        0.5,
    );
    let morph = tissue("streetFrontRow", "gabled-row-house");
    let o = |role: &'static str, pack: &'static str| Occupancy {
        morph: &morph,
        zone: "core",
        function: "collective",
        role,
        landmark: true,
        party_walls: true,
        wealth: 0.5,
        seed: "landmark",
        pack,
        court_lot: false,
        court_kept: None,
    };
    let church = preview_parts(&site, &o("worship.parish", "EUR-MED")).0;
    let labels: Vec<_> = church.iter().map(|p| p.1).collect();
    for part in ["tower", "nave", "choir", "apse"] {
        assert!(labels.contains(&part), "{labels:?}");
    }
    let tower = church.iter().find(|p| p.1 == "tower").unwrap();
    let nave = church.iter().find(|p| p.1 == "nave").unwrap();
    let y = |s: &Shape| s.outer.iter().map(|q| q.y).fold(f64::INFINITY, f64::min);
    assert!(
        y(&tower.0) < y(&nave.0),
        "the tower stands at the street front"
    );
    for (s, _) in &church {
        assert!(
            s.outer.iter().all(|q| q.x >= -1e-6
                && q.x <= 36.0 + 1e-6
                && q.y >= -1e-6
                && q.y <= 60.0 + 1e-6)
        );
    }
    let mosque = preview_parts(&site, &o("worship.mosque.friday", "AF-MAG")).0;
    let labels: Vec<_> = mosque.iter().map(|p| p.1).collect();
    assert!(
        labels.contains(&"minaret") && labels.iter().any(|l| prayer_space(l)),
        "{labels:?}"
    );
}

/// A court never leaves a wing thinner than the culture's minimum, on a
/// square lot, an oblique lot and Codex's thin-court lot of 01-l
/// (`parcel-ba8e5a7e8a355e53`, a 0.0000002 m wing before); every piece is a
/// valid simple polygon at least one wing thick.
#[test]
fn courts_keep_whole_wings_and_pieces_stay_valid() {
    let p = |x: f64, y: f64| Point { x, y };
    let codex = Shape {
        outer: vec![
            p(5.785, 38.490),
            p(5.785, 26.941),
            p(10.278, 26.516),
            p(13.278, 26.382),
            p(17.953, 26.368),
            p(32.825, 27.584),
            p(32.827, 27.555),
            p(32.955, 27.589),
            p(33.032, 27.569),
            p(33.033, 27.588),
            p(33.884, 27.546),
            p(41.444, 27.176),
            p(43.023, 27.137),
            p(43.022, 27.118),
            p(43.191, 27.073),
            p(43.198, 27.119),
            p(44.615, 26.984),
            p(47.297, 26.810),
            p(47.310, 26.813),
            p(47.330, 26.807),
            p(47.621, 26.789),
            p(49.207, 26.686),
            p(47.683, 30.631),
            p(35.847, 35.821),
            p(35.832, 38.650),
        ],
        holes: vec![],
    };
    let lots = [
        // Lots holding MED-ANT's native atrium house (28.1 x 28.3 m).
        lot(
            rectangle(0.0, 0.0, 32.0, 30.0),
            [p(0.0, 0.0), p(32.0, 0.0)],
            0.7,
        ),
        lot(
            Shape {
                outer: vec![p(0.0, 0.0), p(34.0, 0.0), p(46.0, 30.0), p(4.0, 30.0)],
                holes: vec![],
            },
            [p(0.0, 0.0), p(34.0, 0.0)],
            0.7,
        ),
        lot(codex, [p(5.785, 38.490), p(5.785, 26.941)], 0.3),
    ];
    // Closed and open (U, L) courts alike keep whole wings.
    let mut morph = tissue("courtyardHouse", "domus");
    morph.value["openCourtChance"] = json!(0.5);
    let ring_gap = |a: &[Point], b: &[Point]| {
        let mut d = f64::INFINITY;
        for (x, y) in [(a, b), (b, a)] {
            for q in x {
                for i in 0..y.len() {
                    d = d.min(distance(*q, y[i], y[(i + 1) % y.len()]));
                }
            }
        }
        d
    };
    let mut courts = 0;
    for (li, l) in lots.iter().enumerate() {
        for role in ["dwelling", "dwelling.mansion"] {
            for k in 0..24 {
                let seed = format!("court-{li}-{role}-{k}");
                let o = Occupancy {
                    morph: &morph,
                    zone: "core",
                    function: "domestic",
                    role,
                    landmark: false,
                    party_walls: true,
                    wealth: 0.9,
                    seed: &seed,
                    pack: "MED-ANT",
                    court_lot: false,
                    court_kept: None,
                };
                for (s, label) in preview_parts(l, &o).0 {
                    assert!(
                        simple(&s.outer) && s.holes.iter().all(|h| h.len() >= 3 && simple(h)),
                        "{seed}: invalid piece"
                    );
                    assert!(
                        thickness(&s.outer, s.holes.first().map(|h| h.as_slice()))
                            >= 3.0 - 1e-6,
                        "{seed}: {label} thinner than a wing"
                    );
                    for h in &s.holes {
                        courts += 1;
                        assert!(
                            ring_gap(&s.outer, h) >= 3.5 - 1e-6,
                            "{seed}: court wing {:.3}",
                            ring_gap(&s.outer, h)
                        );
                    }
                }
            }
        }
    }
    assert!(courts > 10, "courts are still composed: {courts}");
}

/// A farm is a house and a barn around a yard; a ruin keeps only broken
/// wall stretches (no roofed body); an abandoned house keeps its masses.
#[test]
fn farms_have_a_barn_and_ruins_only_walls() {
    let p = |x: f64, y: f64| Point { x, y };
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for (k, shape) in [
        rectangle(0.0, 0.0, 30.0, 40.0),
        rectangle(0.0, 0.0, 34.0, 16.0),
    ]
    .into_iter()
    .enumerate()
    {
        let w = shape.outer[1].x;
        let site = lot(shape, [p(0.0, 0.0), p(w, 0.0)], 0.3);
        let o = |role: &'static str, seed: &'static str| Occupancy {
            morph: &morph,
            zone: "edge",
            function: "domestic",
            role,
            landmark: false,
            party_walls: false,
            wealth: 0.5,
            seed,
            pack: "EUR-MED",
            court_lot: false,
            court_kept: None,
        };
        for seed in ["a", "b", "c", "d"] {
            let farm = preview_parts(&site, &o("dwelling.farm", seed)).0;
            assert!(
                farm.len() >= 2,
                "lot {k} seed {seed}: house and barn, got {}",
                farm.len()
            );
            let ruin = preview_parts(&site, &o("dwelling.farm.ruin", seed)).0;
            assert!(
                !ruin.is_empty()
                    && ruin
                        .iter()
                        .all(|(s, l)| *l == "rubble" || super::super::ruins::is_ruin(l) && thickness(&s.outer, None) <= 1.51)
            );
            let built: f64 = farm.iter().map(|(s, _)| area(s)).sum();
            let walls: f64 = ruin.iter().map(|(s, _)| area(s)).sum();
            assert!(walls < 0.5 * built, "a ruin is walls, not roofed masses");
            // An empty farm decays by its own seed (ruins.rs): never more roofed.
            let empty = preview_parts(&site, &o("dwelling.farm.abandoned", seed)).0;
            let roofed: f64 = empty
                .iter()
                .filter(|(_, l)| !super::super::ruins::is_ruin(l))
                .map(|(s, _)| area(s))
                .sum();
            assert!(!empty.is_empty() && roofed <= built + 1e-6);
        }
    }
}

fn home<'a>(morph: &'a Morph, role: &'a str, seed: &'a str) -> Occupancy<'a> {
    Occupancy {
        morph,
        zone: "core",
        function: "domestic",
        role,
        landmark: false,
        party_walls: true,
        wealth: 0.5,
        seed,
        pack: "EUR-MED",
        court_lot: false,
        court_kept: None,
    }
}
fn poly(pts: &[(f64, f64)]) -> Shape {
    Shape {
        outer: pts.iter().map(|&(x, y)| Point { x, y }).collect(),
        holes: vec![],
    }
}
fn parallel(a: Point, b: Point, c: Point, d: Point, degrees: f64) -> bool {
    let (e, f) = (unit(sub(b, a)), unit(sub(d, c)));
    (e.x * f.y - e.y * f.x).abs() <= degrees.to_radians().sin()
}

/// Invariant (review P01 107-109, P03 11): on lots whose party walls lean
/// off the street normal, every piece behind the street range (wing, back
/// house, back building) stands against one of its own lot's side walls,
/// along it: an edge lies on that wall and runs parallel to it, so the
/// wings of neighbours meet on their shared wall at the lot's angle.
#[test]
fn rear_pieces_stand_along_their_own_party_wall_on_leaning_lots() {
    let lean = 18f64.to_radians().tan();
    let shape = poly(&[
        (0.0, 0.0),
        (7.0, 0.0),
        (7.0 - 36.0 * lean, 36.0),
        (-36.0 * lean, 36.0),
    ]);
    let sides = [
        (shape.outer[1], shape.outer[2]),
        (shape.outer[3], shape.outer[0]),
    ];
    let p = lot(
        shape,
        [Point { x: 0.0, y: 0.0 }, Point { x: 7.0, y: 0.0 }],
        0.8,
    );
    let morph = tissue("streetFrontRow", "gabled-row-house");
    let mut rear = 0;
    for k in 0..12 {
        let seed = format!("lean/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
        assert!(!fp.is_empty(), "{seed}: nothing built");
        for s in fp.iter().filter(|s| s.outer.iter().all(|q| q.y > 0.5)) {
            rear += 1;
            let r = &s.outer;
            let against = (0..r.len()).any(|i| {
                let (a, b) = (r[i], r[(i + 1) % r.len()]);
                length(sub(b, a)) >= 2.0
                    && sides.iter().any(|&(c, d)| {
                        distance(a, c, d) < 0.05
                            && distance(b, c, d) < 0.05
                            && parallel(a, b, c, d, 0.5)
                    })
            });
            assert!(against, "{seed}: rear piece {r:?} off its party walls");
        }
    }
    assert!(
        rear >= 6,
        "too few rear pieces ({rear}) to test the invariant"
    );
}

/// Invariant (review P11 6-9, P12 12-15): a court has its house's
/// orientation: every wall of the court runs parallel to a wall of the
/// mass around it (the mass inset), on a lot within 15 degrees of square
/// (insula on the lot itself) and on an oblique row lot (back court).
#[test]
fn courts_are_parallel_to_their_house() {
    let insula = lot(
        poly(&[(0.0, 0.0), (20.0, 0.0), (22.0, 28.0), (-4.0, 28.0)]),
        [Point { x: 0.0, y: 0.0 }, Point { x: 20.0, y: 0.0 }],
        0.8,
    );
    let lean = 20f64.to_radians().tan();
    let oblique = lot(
        poly(&[
            (0.0, 0.0),
            (16.0, 0.0),
            (16.0 + 34.0 * lean, 34.0),
            (34.0 * lean, 34.0),
        ]),
        [Point { x: 0.0, y: 0.0 }, Point { x: 16.0, y: 0.0 }],
        0.9,
    );
    let domus = tissue("courtyardHouse", "domus");
    let rows = tissue("streetFrontRow", "gabled-row-house");
    let mut courts = 0;
    for k in 0..16 {
        let seed = format!("court/parcel-{k}");
        for fp in [
            preview(&insula, &home(&domus, "dwelling.tenement", &seed)),
            preview(&oblique, &home(&rows, "dwelling.row", &seed)),
        ] {
            for s in &fp {
                let o = &s.outer;
                for h in &s.holes {
                    courts += 1;
                    for i in 0..h.len() {
                        let (a, b) = (h[i], h[(i + 1) % h.len()]);
                        if length(sub(b, a)) < 1.0 {
                            continue;
                        }
                        assert!(
                            (0..o.len()).any(|j| parallel(
                                a,
                                b,
                                o[j],
                                o[(j + 1) % o.len()],
                                0.5
                            )),
                            "{seed}: court wall {a:?}-{b:?} parallel to no house wall"
                        );
                    }
                }
            }
        }
    }
    assert!(
        courts >= 8,
        "too few courts ({courts}) to test the invariant"
    );
}

/// Invariant (review P13, « même dégénérées »): an allocated lot that holds
/// a body builds one. Real 01-l core lots left empty before (odd shapes,
/// zero-area cadastral holes, a concave lot cut by its frame planes) each
/// get a footprint inside the lot, every piece at least a wing thick and
/// without a needle corner.
#[test]
fn allocated_irregular_lots_get_a_practicable_footprint() {
    let data: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/irregular-lots-01l.json")).unwrap();
    let parcels: Vec<Parcel> = serde_json::from_value(data["parcels"].clone()).unwrap();
    let morph = tissue("streetFrontRow", "gabled-row-house");
    assert_eq!(parcels.len(), 7);
    for p in &parcels {
        for role in ["dwelling.row", "dwelling.shop"] {
            let fp = preview(p, &home(&morph, role, &p.id));
            assert!(!fp.is_empty(), "{}: allocated lot left empty", p.id);
            let lot = super::super::super::geometry::normalized(Shape {
                outer: p.shape.outer.clone(),
                holes: vec![],
            });
            for s in &fp {
                assert!(
                    thickness(&s.outer, s.holes.first().map(|h| h.as_slice())) >= 3.0 - 1e-6
                );
                assert!(difference(s, &lot).iter().map(area).sum::<f64>() < 1e-2);
            }
        }
    }
}

/// Invariant (review P08, « jamais identiques »): same-size neighbour lots
/// of a regular row get different footprints, drawn from each lot's seed
/// within the culture's rooms, while their street ranges keep one depth.
#[test]
fn same_size_neighbour_lots_get_different_footprints() {
    let morph = tissue("giebelhaus", "giebelhaus");
    let mut patterns = vec![];
    let mut fronts = vec![];
    for k in 0..8 {
        let x = 6.0 * k as f64;
        let p = lot(
            rectangle(x, 0.0, x + 6.0, 38.0),
            [Point { x, y: 0.0 }, Point { x: x + 6.0, y: 0.0 }],
            0.8,
        );
        let seed = format!("hanse-block/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
        // Structure of the footprint: each piece's share of the lot width
        // (quarters) and its extent in depth (3 m steps).
        let mut sig: Vec<(i64, i64)> = fp
            .iter()
            .map(|s| {
                let (x0, x1) = s
                    .outer
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
                        (a.min(q.x), b.max(q.x))
                    });
                let (y0, y1) = s
                    .outer
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
                        (a.min(q.y), b.max(q.y))
                    });
                (
                    ((x1 - x0) / 6.0 * 4.0).round() as i64,
                    ((y1 - y0) / 3.0).round() as i64,
                )
            })
            .collect();
        sig.sort();
        fronts.push(
            fp.iter()
                .filter(|s| s.outer.iter().any(|q| q.y < 0.5))
                .flat_map(|s| s.outer.iter().map(|q| q.y))
                .fold(0.0, f64::max),
        );
        patterns.push((fp.len(), sig));
    }
    let mut distinct = patterns.clone();
    distinct.sort();
    distinct.dedup();
    assert!(distinct.len() >= 6, "repeated footprints: {patterns:?}");
    assert!(
        patterns.windows(2).all(|w| w[0] != w[1]),
        "identical neighbours: {patterns:?}"
    );
    let (lo, hi) = fronts
        .iter()
        .fold((f64::INFINITY, 0.0f64), |(a, b), &y| (a.min(y), b.max(y)));
    assert!(hi - lo < 2.0, "street ranges zigzag: {fronts:?}");
}

/// Invariant (review P04 5-6, « coupé pour rien »): a monument stands whole
/// in its precinct, the largest rectangle of its lot facing a street: on a
/// wedge lot every part of a bathhouse is a whole rectangle, none cut by
/// the lot's oblique side.
#[test]
fn landmark_parts_stay_whole_in_their_precinct() {
    let wedge = lot(
        poly(&[(0.0, 0.0), (30.0, 0.0), (40.0, 16.0), (-2.0, 27.25)]),
        [Point { x: 0.0, y: 0.0 }, Point { x: 30.0, y: 0.0 }],
        0.6,
    );
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for seed in ["bath-a", "bath-b", "bath-c"] {
        let mut o = home(&morph, "civic.bathhouse", seed);
        o.function = "collective";
        o.landmark = true;
        let fp = preview(&wedge, &o);
        assert!(!fp.is_empty(), "{seed}: no bathhouse");
        for s in &fp {
            let r = &s.outer;
            assert_eq!(r.len(), 4, "{seed}: part cut by the lot {r:?}");
            for i in 0..4 {
                let (a, b, c) = (r[i], r[(i + 1) % 4], r[(i + 2) % 4]);
                assert!(
                    dot(unit(sub(b, a)), unit(sub(c, b))).abs() < 1e-6,
                    "{seed}: {r:?}"
                );
            }
        }
    }
}

/// Invariant (review P08 73-74, « losanges »): party walls leaning more than
/// 25 degrees do not make a diamond house: the street body is built square
/// to its street where a straight one fits.
#[test]
fn steeply_leaning_party_walls_build_a_straight_street_body() {
    let lean = 36f64.to_radians().tan();
    let p = lot(
        poly(&[
            (0.0, 0.0),
            (18.0, 0.0),
            (18.0 + 30.0 * lean, 30.0),
            (30.0 * lean, 30.0),
        ]),
        [Point { x: 0.0, y: 0.0 }, Point { x: 18.0, y: 0.0 }],
        0.8,
    );
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for k in 0..6 {
        let seed = format!("steep/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.tenement", &seed));
        let body = fp
            .iter()
            .find(|s| s.outer.iter().any(|q| q.y < 0.5))
            .expect("street body");
        let r = &body.outer;
        for i in 0..r.len() {
            let (a, v, c) = (r[(i + r.len() - 1) % r.len()], r[i], r[(i + 1) % r.len()]);
            let (e, f) = (unit(sub(v, a)), unit(sub(c, v)));
            // Square corners (or a straight run), never a 54-126° rhombus.
            assert!(
                dot(e, f).abs() < 0.3 || dot(e, f) > 0.999,
                "{seed}: diamond corner in {r:?}"
            );
        }
    }
}

/// Invariant (review series 2, P01 1 and 9, P22 12/16/46, P09 40-42): on a
/// lot whose party walls lean off its street, the street house fills the
/// lot from wall to wall (an edge on each side wall), its back wall
/// square to those walls (« la perpendiculaire à la parcelle »), and
/// every piece behind it is aligned on that wall: each of its walls runs
/// along or square to the lot's sides, or lies on the lot's own edge.
#[test]
fn oblique_lots_build_wall_to_wall_and_align_the_back_on_the_lot() {
    let lean = 15f64.to_radians().tan();
    let shape = poly(&[
        (0.0, 0.0),
        (9.0, 0.0),
        (9.0 + 34.0 * lean, 34.0),
        (34.0 * lean, 34.0),
    ]);
    let ring = shape.outer.clone();
    let walls = [(ring[3], ring[0]), (ring[1], ring[2])];
    let side = unit(sub(ring[2], ring[1]));
    let on_lot = |a: Point, b: Point| {
        (0..4).any(|i| {
            let (c, d) = (ring[i], ring[(i + 1) % 4]);
            distance(a, c, d) < 0.05 && distance(b, c, d) < 0.05
        })
    };
    let p = lot(
        shape.clone(),
        [Point { x: 0.0, y: 0.0 }, Point { x: 9.0, y: 0.0 }],
        0.8,
    );
    let morph = tissue("streetFrontRow", "gabled-row-house");
    let mut rear = 0;
    for k in 0..8 {
        let seed = format!("oblique/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
        for s in &fp {
            assert!(difference(s, &shape).iter().map(area).sum::<f64>() < 1e-2);
        }
        let body = fp
            .iter()
            .find(|s| s.outer.iter().any(|q| q.y < 0.5))
            .expect("street house");
        let b = &body.outer;
        let edges: Vec<(Point, Point)> =
            (0..b.len()).map(|i| (b[i], b[(i + 1) % b.len()])).collect();
        for (c, d) in walls {
            assert!(
                edges.iter().any(|&(a, e)| {
                    length(sub(e, a)) > 2.0
                        && distance(a, c, d) < 0.05
                        && distance(e, c, d) < 0.05
                }),
                "{seed}: the street house leaves a party wall {b:?}"
            );
        }
        let back = edges
            .iter()
            .filter(|&&(a, e)| {
                length(sub(e, a)) > 2.0 && a.y > 0.5 && e.y > 0.5 && !on_lot(a, e)
            })
            .max_by(|x, y| (x.0.y + x.1.y).total_cmp(&(y.0.y + y.1.y)))
            .expect("back wall");
        assert!(
            dot(unit(sub(back.1, back.0)), side).abs() < 2f64.to_radians().sin(),
            "{seed}: back wall {back:?} not square to the lot's sides"
        );
        for s in fp.iter().filter(|s| s.outer.iter().all(|q| q.y > 0.5)) {
            rear += 1;
            let q = &s.outer;
            for i in 0..q.len() {
                let (a, e) = (q[i], q[(i + 1) % q.len()]);
                let len = length(sub(e, a));
                let c = dot(sub(e, a), side).abs() / len.max(1e-9);
                assert!(
                    len < 1.0 || on_lot(a, e) || c > 0.999 || c < 2f64.to_radians().sin(),
                    "{seed}: rear piece wall askew {q:?}"
                );
            }
        }
    }
    assert!(rear >= 4, "too few rear pieces ({rear})");
}

/// Invariant (review series 2, P14/P15 37, P05 119, P02 12): a small
/// house is a practicable rectangle in the orientation that holds the
/// largest one; a sliver whose rectangle would be too small joins the
/// house it touches (« intégré à la maison ») instead of standing apart.
#[test]
fn small_pieces_are_rectangles_or_join_their_house() {
    let pt = |x: f64, y: f64| Point { x, y };
    let body = vec![pt(0.0, 0.0), pt(10.0, 0.0), pt(10.0, 10.0), pt(0.0, 10.0)];
    let pentagon = vec![
        pt(20.0, 0.0),
        pt(27.0, 0.0),
        pt(27.5, 4.0),
        pt(24.0, 6.5),
        pt(20.0, 5.0),
    ];
    let sliver = vec![pt(10.0, 0.0), pt(14.0, 0.0), pt(10.0, 8.0)];
    let b = vec![
        pt(-5.0, -5.0),
        pt(40.0, -5.0),
        pt(40.0, 30.0),
        pt(-5.0, 30.0),
    ];
    let out = legible_pieces(
        vec![
            (body, None, "building"),
            (pentagon.clone(), None, "building"),
            (sliver, None, "building"),
        ],
        &b,
        &[frame_along(pt(1.0, 0.0))],
        3.0,
        false,
        false,
        &[],
    );
    assert_eq!(out.len(), 2, "{out:?}");
    let small = out
        .iter()
        .find(|p| p.0.iter().all(|q| q.x >= 19.9))
        .unwrap();
    assert!(rectangular(&small.0), "{:?}", small.0);
    assert!(ring_area(&small.0).abs() >= 0.6 * ring_area(&pentagon).abs());
    let house = out.iter().find(|p| p.0.iter().any(|q| q.x < 1.0)).unwrap();
    assert!(
        (ring_area(&house.0).abs() - 116.0).abs() < 0.1,
        "{:?}",
        house.0
    );
}

/// Invariant (« remplir le côté », review series 2 P01 9/102): an unbuilt
/// strip under 2.5 m between a wall and the lot's edge is built with its
/// house; a 3.5 m yard between two houses stays a yard.
#[test]
fn thin_strips_along_the_lot_edge_are_built_and_yards_kept() {
    let pt = |x: f64, y: f64| Point { x, y };
    let b = vec![pt(0.0, 0.0), pt(10.0, 0.0), pt(10.0, 24.0), pt(0.0, 24.0)];
    let front = vec![pt(0.0, 0.0), pt(8.5, 0.0), pt(8.5, 12.0), pt(0.0, 12.0)];
    let back = vec![pt(0.0, 15.5), pt(10.0, 15.5), pt(10.0, 24.0), pt(0.0, 24.0)];
    let out = legible_pieces(
        vec![(front, None, "building"), (back, None, "building")],
        &b,
        &[frame_along(pt(1.0, 0.0))],
        3.0,
        true,
        true,
        &[],
    );
    assert_eq!(out.len(), 2);
    let front = out.iter().find(|p| p.0.iter().any(|q| q.y < 0.5)).unwrap();
    assert!(
        (ring_area(&front.0).abs() - 120.0).abs() < 0.1,
        "{:?}",
        front.0
    );
    assert!(
        front.0.iter().all(|q| q.y <= 12.0 + 1e-6),
        "the yard is kept"
    );
}

/// Invariant (review series 2, P28 8): a through-lot whose yard between
/// the street house and the back-street house would be under 4 m builds
/// one pseudo-L instead: the street house's return wing runs along a
/// party wall to the back street, the yard opening beside it.
#[test]
fn a_narrow_through_lot_yard_makes_one_pseudo_l() {
    let mut p = lot(
        poly(&[(0.0, 0.0), (12.0, 0.0), (12.0, 24.0), (0.0, 24.0)]),
        [Point { x: 0.0, y: 0.0 }, Point { x: 12.0, y: 0.0 }],
        0.9,
    );
    let mut c = p.contacts[0].clone();
    (c.a, c.b, c.street, c.length) = (
        Point { x: 12.0, y: 24.0 },
        Point { x: 0.0, y: 24.0 },
        1,
        12.0,
    );
    p.contacts.push(c);
    let morph = tissue("streetFrontRow", "gabled-row-house");
    let mut ls = 0;
    for k in 0..8 {
        let seed = format!("through/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
        // No yard strip under 2.5 m between two separate houses.
        for (i, a) in fp.iter().enumerate() {
            for q in &fp[..i] {
                let gap = a
                    .outer
                    .iter()
                    .map(|v| {
                        q.outer
                            .iter()
                            .map(|w| length(sub(*v, *w)))
                            .fold(f64::INFINITY, f64::min)
                    })
                    .fold(f64::INFINITY, f64::min);
                assert!(gap < 0.05 || gap >= 2.5, "{seed}: strip of a yard {gap:.2}");
            }
        }
        ls += fp
            .iter()
            .filter(|s| {
                s.outer.iter().any(|q| q.y < 0.5)
                    && s.outer.iter().any(|q| q.y > 23.5)
                    && area(s) < 0.9 * 288.0
            })
            .count();
    }
    assert!(ls >= 1, "no pseudo-L built on a narrow through-lot");
}

/// Invariant (« pas d'impasse en angle aigu », review series 2 P27 27):
/// the wedge of yard two houses of a lot leave between them, a street
/// range's back wall square to the lot's sides and the corner range's
/// wall square to the street, is built: no open remainder of the lot
/// keeps a corner under 45 degrees, whether the side strips are filled
/// or not (party-wall tissues).
#[test]
fn acute_wedges_between_walls_are_built() {
    let pts = |v: &[(f64, f64)]| -> Vec<Point> {
        v.iter()
            .map(|&(x, y)| Point {
                x: x - 2050.0,
                y: y - 2030.0,
            })
            .collect()
    };
    let b = pts(&[
        (2051.63, 2040.98),
        (2051.62, 2038.72),
        (2060.27, 2038.57),
        (2065.29, 2038.49),
        (2078.42, 2038.26),
        (2081.67, 2053.03),
        (2085.31, 2069.58),
        (2067.95, 2073.41),
        (2054.23, 2076.43),
        (2052.67, 2064.16),
        (2051.78, 2052.49),
    ]);
    let range = pts(&[
        (2051.62, 2038.72),
        (2060.27, 2038.57),
        (2067.95, 2073.41),
        (2054.23, 2076.43),
        (2052.67, 2064.16),
        (2051.78, 2052.49),
    ]);
    let corner = pts(&[
        (2067.95, 2073.41),
        (2065.29, 2038.49),
        (2078.42, 2038.26),
        (2081.67, 2053.03),
        (2085.31, 2069.58),
    ]);
    let f = frame_along(Point { x: -0.08, y: -1.0 });
    for absorb in [true, false] {
        let out = legible_pieces(
            vec![
                (range.clone(), None, "building"),
                (corner.clone(), None, "building"),
            ],
            &b,
            &[f],
            3.0,
            absorb,
            true,
            &[],
        );
        // The ground joins the house it squares: no piece is left more
        // skewed than the two were.
        let before = skew(&range) + skew(&corner);
        let after: f64 = out.iter().map(|(r, _, _)| skew(r)).sum();
        assert!(
            after <= before + 1.0,
            "absorb {absorb}: skew {before:.1} -> {after:.1}"
        );
        let mut rest = vec![Shape {
            outer: b.clone(),
            holes: vec![],
        }];
        for (r, _, _) in &out {
            let cut = Shape {
                outer: r.clone(),
                holes: vec![],
            };
            rest = rest.iter().flat_map(|s| difference(s, &cut)).collect();
        }
        for g in rest.iter().filter(|g| area(g) > 1.0) {
            let mut r = smoothed(&dedup(g.outer.clone()), 0.12);
            if ring_area(&r) < 0.0 {
                r.reverse();
            }
            let n = r.len();
            for i in 0..n {
                let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
                let (e, f) = (sub(a, v), sub(c, v));
                let convex = (v.x - a.x) * (c.y - v.y) - (v.y - a.y) * (c.x - v.x) > 0.0;
                let cos = dot(e, f) / (length(e) * length(f));
                assert!(
                    !convex || cos < 45f64.to_radians().cos(),
                    "absorb {absorb}: acute open corner at {v:?} in {:?}",
                    g.outer
                );
            }
        }
    }
}

/// Invariant (« le grand côté, pas le petit », review series 2 P10 42,
/// P19 24): a corner lot whose short end lies on the better street
/// still fronts its long side: one street body runs along the long
/// frontage instead of a short range on the end and a side range.
#[test]
fn a_corner_lot_fronts_its_long_side() {
    let mut p = lot(
        poly(&[(0.0, 0.0), (30.0, 0.0), (30.0, 12.0), (0.0, 12.0)]),
        [Point { x: 0.0, y: 12.0 }, Point { x: 0.0, y: 0.0 }],
        0.8,
    );
    p.contacts[0].rank = 0;
    let mut c = p.contacts[0].clone();
    (c.a, c.b, c.street, c.rank, c.length) = (
        Point { x: 0.0, y: 0.0 },
        Point { x: 30.0, y: 0.0 },
        1,
        2,
        30.0,
    );
    p.contacts.push(c);
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for k in 0..6 {
        let seed = format!("corner/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
        let wall = fp
            .iter()
            .flat_map(|s| {
                let r = &s.outer;
                (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()]))
            })
            .filter(|(a, b)| a.y < 0.5 && b.y < 0.5)
            .map(|(a, b)| (a.x - b.x).abs())
            .fold(0.0, f64::max);
        assert!(
            wall >= 20.0,
            "{seed}: long frontage built in pieces ({wall:.1} m) {fp:?}"
        );
    }
}

/// Invariant (review series 2 P21 101, series 3 P04): a free-standing
/// house stands square to its lot's sides only where it keeps four
/// fifths of the house it holds square to its street; on a wedge lot
/// whose side leans 25 degrees it fronts its street as a rectangle,
/// never the lot's triangle.
#[test]
fn a_wedge_lot_keeps_a_rectangular_house_on_its_street() {
    let p = lot(
        poly(&[
            (6.68, 4.12),
            (0.0, 0.0),
            (7.74, 1.24),
            (11.65, -23.16),
            (20.23, -17.88),
        ]),
        [
            Point { x: 7.74, y: 1.24 },
            Point {
                x: 11.65,
                y: -23.16,
            },
        ],
        0.3,
    );
    let morph = Morph {
        value: json!({"buildingOp":"farmstead","plotOp":"croft","arch":{"typology":"farmhouse"},
            "coverage":{"core":[0.2,0.3]},"buildDepth":{"core":[8.0,10.0]},
            "setback":{"core":[1.0,2.0]},"sideGap":{"core":[1.0,2.0]},"roomDepth":[4.5,6.0]}),
    };
    for k in 0..6 {
        let seed = format!("wedge/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.farm", &seed));
        let house = fp
            .iter()
            .max_by(|a, b| area(a).total_cmp(&area(b)))
            .expect("a house");
        assert!(
            rectangular(&house.outer) && area(house) >= 24.0,
            "{seed}: {house:?}"
        );
    }
}

/// Invariant (review series 3 P18): a lot whose side meets its street
/// under 45 degrees keeps its street range along the street, its tip
/// cut square, rather than a rectangle fitted away from the street.
#[test]
fn a_lot_tip_on_the_street_keeps_the_street_range() {
    let p = lot(
        poly(&[(0.0, 0.0), (30.0, 0.0), (30.0, 12.0), (17.0, 12.0)]),
        [Point { x: 0.0, y: 0.0 }, Point { x: 30.0, y: 0.0 }],
        0.8,
    );
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for k in 0..6 {
        let seed = format!("tip/parcel-{k}");
        let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
        let wall = fp
            .iter()
            .flat_map(|s| {
                let r = &s.outer;
                (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()]))
            })
            .filter(|(a, b)| a.y < 0.5 && b.y < 0.5)
            .map(|(a, b)| (a.x - b.x).abs())
            .fold(0.0, f64::max);
        assert!(wall >= 22.0, "{seed}: street wall {wall:.1} m {fp:?}");
    }
}

/// Invariant (« pas de maison triangulaire sans contrainte », review
/// series 2 P18/P19, series 1 P04): ground joins a house only as a right
/// trapezoid of it; a strip under a bent lot edge stays yard rather than
/// turning the house into a pentagon following the bend.
#[test]
fn joined_ground_never_adds_a_corner_to_the_house() {
    let pt = |x: f64, y: f64| Point { x, y };
    let b = vec![
        pt(0.0, 0.0),
        pt(20.0, 0.0),
        pt(20.0, 8.0),
        pt(10.0, 9.2),
        pt(0.0, 8.0),
    ];
    let house = vec![pt(0.0, 0.0), pt(20.0, 0.0), pt(20.0, 7.0), pt(0.0, 7.0)];
    let out = legible_pieces(
        vec![(house.clone(), None, "building")],
        &b,
        &[frame_along(pt(1.0, 0.0))],
        3.0,
        true,
        true,
        &[],
    );
    assert_eq!(out.len(), 1);
    assert!(corners(&out[0].0) <= 4, "{:?}", out[0].0);
    // A strip along a straight edge is still built (« remplir le côté »).
    let b = vec![pt(0.0, 0.0), pt(20.0, 0.0), pt(20.0, 8.0), pt(0.0, 8.0)];
    let out = legible_pieces(
        vec![(house, None, "building")],
        &b,
        &[frame_along(pt(1.0, 0.0))],
        3.0,
        true,
        true,
        &[],
    );
    assert!(
        (ring_area(&out[0].0).abs() - 160.0).abs() < 0.5,
        "{:?}",
        out[0].0
    );
}

/// Invariant (review series 2 P18): a street range cut at its lot's tip
/// keeps its full depth along a stretch of the street, else it is the
/// lot's triangle, and no range is built (a rectangle fits instead).
#[test]
fn a_tip_cut_range_keeps_a_full_depth_stretch() {
    let pt = |x: f64, y: f64| Point { x, y };
    let run = [Front {
        a: pt(0.0, 0.0),
        b: pt(24.0, 0.0),
        rank: 0,
        street: 0,
        shared: false,
        gate: false,
    }];
    // A triangle-like lot shallower than the range all along its run.
    let wedge = vec![pt(0.0, 0.0), pt(24.0, 0.0), pt(24.0, 10.0)];
    assert_eq!(
        front_range_why(&wedge, &run, pt(0.0, 1.0), 8.0, 3.0, true, &run),
        Err("tip")
    );
    // A trapezoid lot whose side meets the street at 35 degrees.
    let lot = vec![pt(0.0, 0.0), pt(24.0, 0.0), pt(24.0, 10.0), pt(14.3, 10.0)];
    assert!(front_range_why(&lot, &run, pt(0.0, 1.0), 8.0, 3.0, true, &run).is_ok());
}

/// Invariant (one lot, separate bodies, review series 2 P21): the
/// pieces of a lot never stand on one another.
#[test]
fn pieces_of_a_lot_never_overlap() {
    let p = |x: f64, y: f64| Point { x, y };
    let morph = tissue("streetFrontRow", "gabled-row-house");
    for shape in [
        rectangle(0.0, 0.0, 30.0, 40.0),
        rectangle(0.0, 0.0, 34.0, 16.0),
        rectangle(0.0, 0.0, 18.0, 30.0),
    ] {
        let w = shape.outer[1].x;
        let site = lot(shape, [p(0.0, 0.0), p(w, 0.0)], 0.3);
        for role in ["dwelling.farm", "dwelling.house"] {
            for k in 0..8 {
                let seed = format!("overlap/parcel-{k}");
                let fp = preview(&site, &home(&morph, role, &seed));
                for i in 0..fp.len() {
                    for j in i + 1..fp.len() {
                        let o: f64 = intersection(&fp[i], &fp[j]).iter().map(area).sum();
                        assert!(
                            o < 0.5,
                            "{role} {seed}: pieces {i} and {j} overlap by {o:.1} m2"
                        );
                    }
                }
            }
        }
    }
}

/// A complex tissue lays the plan its kit composes around the body
/// (forms/plan.rs): whole labelled parts inside the lot, none standing
/// on another, each at least its label's minimum side; a plain tissue
/// lays no such part.
#[test]
fn complex_tissues_lay_the_parts_of_a_house_plan() {
    use super::super::super::forms::plan;
    let site = lot(
        rectangle(0.0, 0.0, 30.0, 40.0),
        [Point { x: 0.0, y: 0.0 }, Point { x: 30.0, y: 0.0 }],
        0.5,
    );
    let plain = tissue("streetFrontRow", "gabled-row-house");
    let mut complex = tissue("streetFrontRow", "gabled-row-house");
    complex.value["_complexHouses"] = json!(true);
    let extra = |l: &str| plan::is_house_part(l) && l != "building";
    let mut grown = 0;
    for k in 0..16 {
        let seed = format!("plan/parcel-{k}");
        let mut o = home(&plain, "dwelling.house", &seed);
        (o.zone, o.wealth) = ("village", 0.8);
        assert!(preview_parts(&site, &o).0.iter().all(|(_, l)| !extra(l)), "{seed}");
        o.morph = &complex;
        let parts = preview_parts(&site, &o).0;
        assert!(
            parts.first().is_some_and(|(_, l)| *l == "building"),
            "{seed}: the body comes first"
        );
        for (i, (s, l)) in parts.iter().enumerate() {
            assert!(
                difference(s, &site.shape).iter().map(area).sum::<f64>() < 0.01,
                "{seed}: {l} leaves the lot"
            );
            if extra(l) {
                assert!(
                    thickness(&s.outer, None) >= plan::min_side(l) - 1e-6,
                    "{seed}: thin {l}"
                );
            }
            for (q, _) in &parts[..i] {
                assert!(
                    intersection(s, q).iter().map(area).sum::<f64>() < 0.5,
                    "{seed}: {l} stands on another piece"
                );
            }
        }
        grown += usize::from(parts.iter().any(|(_, l)| extra(l)));
    }
    assert!(grown > 0, "no plan grew past its body");
}

/// The shape guard squares an accidental convex blob and leaves the
/// bodies composed on purpose: an L, a body a rectangle would halve, the
/// lot band between leaning party walls, a labelled part.
#[test]
fn accidental_blobs_are_squared_and_composed_shapes_kept() {
    let ring = |v: &[(f64, f64)]| poly(v).outer;
    let f = frame_along(Point { x: 1.0, y: 0.0 });
    let run = |r: Vec<Point>, attached: bool| {
        squared_bodies(vec![(r, None, "building")], &[f], 3.0, attached)
            .remove(0)
            .0
    };
    // A 10 x 8 m body with its four corners cut: eight corners.
    let blob = ring(&[
        (1.5, 0.0),
        (8.5, 0.0),
        (10.0, 1.5),
        (10.0, 6.5),
        (8.5, 8.0),
        (1.5, 8.0),
        (0.0, 6.5),
        (0.0, 1.5),
    ]);
    for attached in [true, false] {
        let out = run(blob.clone(), attached);
        assert!(rectangular(&out), "{out:?}");
        assert!(ring_area(&out).abs() >= 0.55 * ring_area(&blob).abs());
    }
    let ell = ring(&[(0.0, 0.0), (12.0, 0.0), (12.0, 5.0), (5.0, 5.0), (5.0, 12.0), (0.0, 12.0)]);
    let wedge = ring(&[(0.0, 0.0), (12.0, 0.0), (0.0, 9.0)]);
    let lean = 10.0 * 25f64.to_radians().tan();
    let band = ring(&[(0.0, 0.0), (11.0, 0.0), (11.0 - lean, 10.0), (-lean, 10.0)]);
    assert_eq!(run(ell.clone(), false), ell);
    assert_eq!(run(wedge.clone(), false), wedge);
    assert_eq!(run(band.clone(), true), band);
    let part = squared_bodies(vec![(blob.clone(), None, "wing")], &[f], 3.0, false);
    assert_eq!(part[0].0, blob);
}

/// A 14 x 40 m lot with side passages, where a detached house and its
/// shed cover a third at most (192 m² of 560).
fn deep_lot() -> (Parcel, Morph) {
    let p = lot(
        rectangle(0.0, 0.0, 14.0, 40.0),
        [Point { x: 0.0, y: 0.0 }, Point { x: 14.0, y: 0.0 }],
        0.9,
    );
    let mut morph = tissue("streetFrontRow", "gabled-row-house");
    morph.value["sideGap"]["core"] = json!([1.5, 2.5]);
    (p, morph)
}
/// Pieces larger than a garden shed (5 x 5 m at most): the house and any
/// back building.
fn bodies(fp: &[Shape]) -> usize {
    fp.iter().filter(|s| area(s) >= 30.0).count()
}

/// Invariant (no illogical bare ground in town): a deep core lot whose
/// house leaves it under half of the tissue's coverage builds its back:
/// besides the house, a whole back building inside the lot, a wing
/// thick, standing on no other piece.
#[test]
fn a_deep_core_lot_gets_a_back_building() {
    let (p, morph) = deep_lot();
    for k in 0..8 {
        let seed = format!("fill/parcel-{k}");
        let o = home(&morph, "dwelling.house", &seed);
        let fp = preview(&p, &o);
        assert!(bodies(&fp) >= 2, "{seed}: bare back {fp:?}");
        for (i, s) in fp.iter().enumerate() {
            assert!(thickness(&s.outer, None) >= 3.0 - 1e-6, "{seed}: thin piece");
            assert!(difference(s, &p.shape).iter().map(area).sum::<f64>() < 1e-2);
            for q in &fp[..i] {
                assert!(
                    intersection(s, q).iter().map(area).sum::<f64>() < 0.5,
                    "{seed}: piece {i} stands on another"
                );
            }
        }
        assert_eq!(
            serde_json::to_vec(&fp).unwrap(),
            serde_json::to_vec(&preview(&p, &o)).unwrap(),
            "{seed}: the filling is drawn from the lot's seed"
        );
    }
}

/// `backBuildings` is the share of under-built town lots that are filled:
/// none at 0, about half at 0.5, all at 1, a lot filled at one share
/// staying filled above it. A back body off the street is a dependency
/// (`annex`), never a second house.
#[test]
fn back_buildings_share_fills_part_of_the_lots() {
    let (p, base) = deep_lot();
    let filled = |share: f64| -> Vec<bool> {
        let mut morph = base.clone();
        morph.value["_backBuildings"] = json!(share);
        (0..40)
            .map(|k| {
                let seed = format!("fill/parcel-{k}");
                let o = home(&morph, "dwelling.house", &seed);
                let (parts, _) = preview_parts(&p, &o);
                let large: Vec<_> = parts.iter().filter(|(s, _)| area(s) >= 30.0).collect();
                let houses = large.iter().filter(|(_, l)| *l == "building").count();
                assert!(houses <= 1, "{seed}: a house off the street {parts:?}");
                large.len() >= 2
            })
            .collect()
    };
    let (none, half, all) = (filled(0.0), filled(0.5), filled(1.0));
    assert!(none.iter().all(|f| !f), "share 0 leaves the lots as laid");
    assert!(all.iter().all(|f| *f), "share 1 fills every lot");
    let n = half.iter().filter(|f| **f).count();
    assert!((10..=30).contains(&n), "{n} of 40 lots filled at 0.5");
}

/// The same lot in a village keeps its garden: no back building.
#[test]
fn a_village_lot_keeps_its_garden() {
    let (p, morph) = deep_lot();
    for k in 0..8 {
        let seed = format!("fill/parcel-{k}");
        let mut o = home(&morph, "dwelling.house", &seed);
        o.zone = "village";
        let fp = preview(&p, &o);
        assert!(!fp.is_empty(), "{seed}: no house");
        assert!(bodies(&fp) <= 1, "{seed}: built garden {fp:?}");
    }
}

/// A body its lot narrows under three fifths of its width is shortened
/// with it: never a bar one wing wide and the whole lot long.
#[test]
fn a_narrowed_body_is_shortened_instead_of_a_long_bar() {
    // A neck 4 m wide and 30 m deep, a 12 m wide body asked along it.
    let neck = poly(&[(0.0, 0.0), (4.0, 0.0), (4.0, 30.0), (0.0, 30.0)]).outer;
    let f = Frame {
        u: Point { x: 1.0, y: 0.0 },
        n: Point { x: 0.0, y: 1.0 },
        t0: 0.0,
    };
    let lay = Lay {
        b: &neck,
        fronts: &[],
        f,
        wing: 3.0,
        pieces: vec![],
    };
    let r = lay.place(-4.0, 8.0, 0.0, 30.0, 2.0).expect("a body fits the neck");
    assert!(
        r[1] - r[0] >= 3.0 && r[3] - r[2] <= 3.5 * (r[1] - r[0]) + 1e-9,
        "{r:?}"
    );
    // A body that keeps its width keeps its length.
    let r = lay.place(0.5, 4.0, 0.0, 30.0, 2.0).expect("a body fits the neck");
    assert!((r[3] - r[2] - 30.0).abs() < 1e-9, "{r:?}");
}
