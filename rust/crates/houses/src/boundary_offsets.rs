//! Exact evaluation of the existing finite Raw + displacement generators.
use super::*;
use num_traits::Signed;

fn same_bits(a: Point, b: Point) -> bool {
    a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits()
}
fn norm2(q: &Q) -> R {
    &q.x * &q.x + &q.y * &q.y
}

fn certify_miter(q: &Q, old: Point, edges: &[(Q, Q); 2]) -> Result<(), String> {
    let world_scale = edges
        .iter()
        .flat_map(|(a, b)| [a, b])
        .map(Q::point)
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .chain(std::iter::once(&old))
        .map(|p| p.x.abs().max(p.y.abs()))
        .fold(0.0, f64::max);
    let eps2 = rational(8.0 * ulp(world_scale)).pow(2);
    let old = Q::from(old);
    let u = edges[0].1.sub(&edges[0].0);
    let v = edges[1].1.sub(&edges[1].0);
    let u2 = norm2(&u);
    let v2 = norm2(&v);
    for (a, b) in edges {
        let direction = b.sub(a);
        let residual = cross(&direction, &old.sub(a));
        if &residual * &residual > &eps2 * norm2(&direction) {
            return Err("Résidu de miter Boundary au-delà de8ULP des opérandes.".into());
        }
    }
    let determinant = cross(&u, &v);
    if norm2(&q.sub(&old)) * &determinant * determinant > eps2 * u2 * v2 {
        return Err("Déplacement de miter Boundary hors borne inverse conditionnée.".into());
    }
    Ok(())
}

fn signed(ring: &[Q]) -> R {
    let mut sum = R::zero();
    for i in 0..ring.len() {
        sum += cross(
            &ring[i].sub(&ring[0]),
            &ring[(i + 1) % ring.len()].sub(&ring[0]),
        );
    }
    sum / rational(2.0)
}

fn offset(r: &NativeOffsetRing, expected: &[Point]) -> Result<Ring, String> {
    let n = r.raw.len();
    if r.choices.is_empty() {
        let mut raw = r.raw.clone();
        if r.reverse {
            raw.reverse();
        }
        if raw.len() != expected.len() || raw.iter().zip(expected).any(|(&a, &b)| !same_bits(a, b))
        {
            return Err("Provenance littérale Boundary différente du domaine Source.".into());
        }
        return Ok(ring(&raw));
    }
    if n < 3 || r.delta.len() != n || r.distances.len() != n || r.choices.len() != n {
        return Err("Recette de débord Boundary incomplète.".into());
    }
    let mut edges = vec![];
    for i in 0..n {
        let a = r.raw[i];
        let b = r.raw[(i + 1) % n];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let length = libm::sqrt(dx * dx + dy * dy);
        let distance = r.distances[i];
        let delta = Point {
            x: dy / length * distance,
            y: -(dx / length * distance),
        };
        if !same_bits(delta, r.delta[i]) || !distance.is_finite() || distance < 0.0 {
            return Err("Opérandes de débord Boundary différents du générateur Source.".into());
        }
        let displacement = Q::from(delta);
        let qa = Q::from(a).add(&displacement);
        let qb = Q::from(b).add(&displacement);
        for (exact, raw) in [(&qa, a), (&qb, b)] {
            if !same_bits(
                exact.point()?,
                Point {
                    x: raw.x + delta.x,
                    y: raw.y + delta.y,
                },
            ) {
                return Err(
                    "Arrondi de l'extrémité générée Boundary différent des bits Source.".into(),
                );
            }
        }
        edges.push((qa, qb));
    }
    let mut q = vec![];
    let mut historical = vec![];
    for i in 0..n {
        let previous = &edges[(i + n - 1) % n];
        let next = &edges[i];
        match r.choices[i] {
            NativeCorner::Bevel => {
                q.extend([previous.1.clone(), next.0.clone()]);
                historical.extend([previous.1.point()?, next.0.point()?]);
            }
            NativeCorner::Parallel(old) => {
                let one = P::edge(&previous.0, &previous.1);
                let two = P::edge(&next.0, &next.1);
                let oldq = Q::from(old);
                if !cross(&previous.1.sub(&previous.0), &next.1.sub(&next.0)).is_zero()
                    || !one.value(&next.0).is_zero()
                    || !two.value(&oldq).is_zero()
                {
                    return Err("Quasi-parallèle Boundary sans support Raw commun certifié.".into());
                }
                q.push(oldq);
                historical.push(old);
            }
            NativeCorner::Miter(old) => {
                let a = P::edge(&previous.0, &previous.1);
                let b = P::edge(&next.0, &next.1);
                let determinant = &a.a * &b.b - &a.b * &b.a;
                if determinant.is_zero() {
                    return Err("Miter Boundary exactement parallèle.".into());
                }
                let vertex = Q {
                    x: (&a.b * &b.c - &a.c * &b.b) / &determinant,
                    y: (&a.c * &b.a - &a.a * &b.c) / determinant,
                };
                certify_miter(&vertex, old, &[previous.clone(), next.clone()])?;
                q.push(vertex);
                historical.push(old);
            }
        }
    }
    let mut kept = vec![];
    let mut old = vec![];
    for (vertex, prior) in q.into_iter().zip(historical) {
        if old.last() == Some(&prior) {
            if kept.last() != Some(&vertex) {
                return Err("Déduplication Source confond deux nœuds Boundary exacts.".into());
            }
        } else {
            kept.push(vertex);
            old.push(prior);
        }
    }
    if r.reverse {
        kept.reverse();
        old.reverse();
    }
    if old.len() != expected.len() || old.iter().zip(expected).any(|(&a, &b)| !same_bits(a, b)) {
        return Err("Choix de débord Boundary différents des bits du domaine Source.".into());
    }
    let prior: Vec<_> = old.iter().copied().map(Q::from).collect();
    let displacement = kept
        .iter()
        .zip(&prior)
        .flat_map(|(a, b)| [(&a.x - &b.x).abs(), (&a.y - &b.y).abs()])
        .max()
        .unwrap_or_default();
    let perimeter: R = prior
        .iter()
        .zip(prior.iter().cycle().skip(1))
        .take(prior.len())
        .map(|(a, b)| (&a.x - &b.x).abs() + (&a.y - &b.y).abs())
        .sum();
    let bound =
        perimeter * &displacement + rational(prior.len() as f64) * &displacement * &displacement;
    if (signed(&kept) - signed(&prior)).abs() > bound {
        return Err("Aire de débord Boundary hors certificat de ses déplacements.".into());
    }
    let raw = kept.iter().map(Q::point).collect::<Result<Vec<_>, _>>()?;
    Ok(Ring { raw, q: kept })
}

pub(super) fn surface(s: &Surface, recipe: Option<&NativeOffsetSurface>) -> Result<S, String> {
    let Some(recipe) = recipe else {
        return Ok(super::surface(s));
    };
    if recipe.len() != s.len() {
        return Err("Polygones de débord Boundary sans provenance.".into());
    }
    s.iter()
        .zip(recipe)
        .map(|(p, r)| {
            if p.holes.len() != r.holes.len() {
                return Err("Trous de débord Boundary sans provenance.".into());
            }
            Ok(Poly {
                outer: offset(&r.outer, &p.outer)?,
                holes: p
                    .holes
                    .iter()
                    .zip(&r.holes)
                    .map(|(p, r)| offset(r, p))
                    .collect::<Result<_, _>>()?,
            })
        })
        .collect()
}

pub(super) fn plane(
    plane: Plane,
    anchor: Option<&NativeAnchor>,
    box_: [f64; 4],
) -> Result<P, String> {
    let mut p = P::from(plane);
    let Some(anchor) = anchor else {
        return Ok(p);
    };
    let [a, b] = anchor.edge;
    if !((plane.a != 0.0 && plane.b == 0.0 && a.x == b.x)
        || (plane.a == 0.0 && plane.b != 0.0 && a.y == b.y))
    {
        return Err("Ancre Boundary oblique sans autorité compatible revue.".into());
    }
    p.c = rational(anchor.z) - &p.a * rational(a.x) - &p.b * rational(a.y);
    let scale = [
        Point {
            x: box_[0],
            y: box_[1],
        },
        Point {
            x: box_[2],
            y: box_[1],
        },
        Point {
            x: box_[2],
            y: box_[3],
        },
        Point {
            x: box_[0],
            y: box_[3],
        },
    ]
    .iter()
    .map(|&q| plane.height(q).abs())
    .fold(0.0, f64::max);
    if (&p.c - rational(plane.c)).abs() > rational(4.0 * ulp(scale)) {
        return Err("Ancre de plan Boundary hors borne4ULP sur son domaine.".into());
    }
    if p.value(&Q::from(a)) != rational(anchor.z) || p.value(&Q::from(b)) != rational(anchor.z) {
        return Err("Ancre de plan Boundary sans cote Source exacte.".into());
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn recipe(raw: Vec<Point>, distance: f64) -> (NativeOffsetRing, Vec<Point>) {
        let n = raw.len();
        let mut delta = vec![];
        let mut shifted = vec![];
        for i in 0..n {
            let a = raw[i];
            let b = raw[(i + 1) % n];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let len = libm::sqrt(dx * dx + dy * dy);
            let d = Point {
                x: dy / len * distance,
                y: -(dx / len * distance),
            };
            delta.push(d);
            shifted.push((
                Point {
                    x: a.x + d.x,
                    y: a.y + d.y,
                },
                Point {
                    x: b.x + d.x,
                    y: b.y + d.y,
                },
            ));
        }
        let mut choices = vec![];
        let mut expected = vec![];
        for i in 0..n {
            let (a, b) = shifted[(i + n - 1) % n];
            let (c, d) = shifted[i];
            let ux = b.x - a.x;
            let uy = b.y - a.y;
            let vx = d.x - c.x;
            let vy = d.y - c.y;
            let det = ux * vy - uy * vx;
            let old = if det.abs() > EPS {
                let t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / det;
                Point {
                    x: a.x + t * ux,
                    y: a.y + t * uy,
                }
            } else {
                Point {
                    x: (b.x + c.x) * 0.5,
                    y: (b.y + c.y) * 0.5,
                }
            };
            let dist = libm::sqrt((old.x - raw[i].x).powi(2) + (old.y - raw[i].y).powi(2));
            if dist > 4.0 * distance.max(0.001) {
                choices.push(NativeCorner::Bevel);
                expected.extend([b, c]);
            } else {
                choices.push(if det.abs() > EPS {
                    NativeCorner::Miter(old)
                } else {
                    NativeCorner::Parallel(old)
                });
                expected.push(old);
            }
        }
        expected.dedup();
        (
            NativeOffsetRing {
                raw,
                delta,
                distances: vec![distance; n],
                choices,
                reverse: false,
            },
            expected,
        )
    }
    #[test]
    fn raw_addition_preserves_the_inward_diagonal_identity() {
        let (r, old) = recipe(
            vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 20.0, y: 0.0 },
                Point { x: 20.0, y: 20.0 },
                Point { x: 0.0, y: 20.0 },
            ],
            0.425,
        );
        let generated = offset(&r, &old).unwrap();
        let q = &generated.q[3];
        assert_eq!(&q.x + &q.y, rational(20.0));
        assert_ne!(
            rational(generated.raw[3].x) + rational(generated.raw[3].y),
            rational(20.0)
        );
        let anchored = plane(
            Plane {
                a: -0.5773502691896257,
                b: 0.0,
                c: 5.6 + 0.5773502691896257 * 5.0,
            },
            Some(&NativeAnchor {
                edge: [Point { x: 5.0, y: 5.0 }, Point { x: 5.0, y: 15.0 }],
                z: 5.6,
            }),
            [-0.5, -0.5, 20.5, 20.5],
        )
        .unwrap();
        assert_eq!(
            anchored.value(&Q::from(Point { x: 5.0, y: 12.0 })),
            rational(5.6)
        );
    }
    #[test]
    fn raw_shared_edge_uses_one_support_despite_different_neighbor_miters() {
        let a = Point { x: 0.0, y: 23.919 };
        let b = Point {
            x: 0.007,
            y: 23.404,
        };
        let (first, old1) = recipe(
            vec![
                Point {
                    x: 0.006,
                    y: 24.434,
                },
                a,
                b,
                Point {
                    x: 0.026,
                    y: 22.889,
                },
            ],
            0.425,
        );
        let (second, old2) = recipe(
            vec![Point { x: 8.0, y: 24.2 }, a, b, Point { x: 7.905, y: 23.6 }],
            0.425,
        );
        let _ = offset(&first, &old1).unwrap();
        let _ = offset(&second, &old2).unwrap();
        let one = P::edge(
            &Q::from(a).add(&Q::from(first.delta[1])),
            &Q::from(b).add(&Q::from(first.delta[1])),
        );
        let two = P::edge(
            &Q::from(a).add(&Q::from(second.delta[1])),
            &Q::from(b).add(&Q::from(second.delta[1])),
        );
        assert!(one == two);
        let different = Point {
            x: b.x + 4.8e-9,
            y: b.y,
        };
        assert!(
            !one.value(&Q::from(different).add(&Q::from(first.delta[1])))
                .is_zero()
        );
    }
    #[test]
    fn a_conditioned_miter_can_exceed_eight_direct_ulps_without_relaxing_residuals() {
        let (r, old) = recipe(
            vec![
                Point {
                    x: 28.768,
                    y: 47.522,
                },
                Point {
                    x: 28.262,
                    y: 47.618,
                },
                Point {
                    x: 27.754,
                    y: 47.705,
                },
            ],
            0.425,
        );
        let generated = offset(&r, &old).unwrap();
        let prior = Q::from(old[1]);
        let largest = generated
            .q
            .iter()
            .zip(&old)
            .map(|(q, p)| {
                (&q.x - rational(p.x))
                    .abs()
                    .max((&q.y - rational(p.y)).abs())
            })
            .max()
            .unwrap();
        assert!(largest > rational(8.0 * ulp(48.0)));
        assert!(generated.q.iter().any(|q| q != &prior));
    }
    #[test]
    fn malformed_anchor_and_quasi_parallel_are_rejected() {
        let incorrect = NativeAnchor {
            edge: [Point { x: 0.0, y: 0.0 }, Point { x: 0.0, y: 1.0 }],
            z: 100.0,
        };
        assert!(
            plane(
                Plane {
                    a: 0.5,
                    b: 0.0,
                    c: 3.0
                },
                Some(&incorrect),
                [0.0, 0.0, 1.0, 1.0]
            )
            .is_err()
        );
        let (mut r, old) = recipe(
            vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 20.0, y: 0.0 },
                Point { x: 20.0, y: 20.0 },
                Point { x: 0.0, y: 20.0 },
            ],
            0.425,
        );
        r.choices[0] = NativeCorner::Parallel(old[0]);
        assert!(offset(&r, &old).err().unwrap().contains("Quasi-parallèle"));
    }
    #[test]
    fn bevels_keep_both_generators_and_literal_zero_offset_keeps_source_bits() {
        let (r, old) = recipe(
            vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 10.0, y: 0.0 },
                Point { x: 0.01, y: 0.01 },
            ],
            0.425,
        );
        assert!(r.choices.iter().any(|q| matches!(q, NativeCorner::Bevel)));
        let generated = offset(&r, &old).unwrap();
        assert_eq!(generated.raw.len(), old.len());
        let literal = literal_recipe(&r.raw);
        let preserved = offset(&literal, &r.raw).unwrap();
        assert!(
            preserved
                .raw
                .iter()
                .zip(&r.raw)
                .all(|(&a, &b)| same_bits(a, b))
        );
    }
}
