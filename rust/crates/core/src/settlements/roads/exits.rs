//! Requested regional gateways, dry border candidates, routing and traffic.
use crate::urban::warnings;
use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExitCounts {
    pub highway: u8,
    pub main: u8,
    pub local: u8,
    pub track: u8,
}

impl ExitCounts {
    fn counts(self) -> [u8; 4] {
        [self.highway, self.main, self.local, self.track]
    }

    pub fn total(self) -> usize {
        self.counts().into_iter().map(usize::from).sum()
    }

    fn requests(self) -> Vec<usize> {
        self.counts()
            .into_iter()
            .enumerate()
            .flat_map(|(class, count)| std::iter::repeat_n(class, usize::from(count)))
            .collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitReport {
    pub requested: String,
    pub class: Option<String>,
    pub gateway: Option<String>,
    pub point: Option<Point>,
    pub reason: Option<String>,
}

#[derive(Clone, Copy)]
struct Border {
    cell: usize,
    point: Point,
}

pub(super) struct Obtained {
    border: Border,
    gateway: usize,
    weight: u32,
}

/// One dry sample per roughly spacing/2 stretch. Scan the whole stretch so a narrow
/// dry opening between nominal sample positions is still represented.
fn borders(f: &Fields, spacing: f64) -> Vec<Border> {
    let n = f.r.n;
    let step = (0.5 * spacing / f.cell).round().max(1.0) as usize;
    let mut out = vec![];
    for side in 0..4 {
        for begin in (0..n).step_by(step) {
            let end = (begin + step).min(n);
            let middle = (begin + end - 1) / 2;
            let cell_of = |k| match side {
                0 => k * n,
                1 => k * n + n - 1,
                2 => k,
                _ => (n - 1) * n + k,
            };
            let Some(k) = (begin..end)
                .filter(|&k| f.r.water[cell_of(k)] == 0)
                .min_by_key(|&k| (k.abs_diff(middle), k))
            else {
                continue;
            };
            let cell = cell_of(k);
            let at = f.pos(cell);
            let point = match side {
                0 => Point { x: 0.0, y: at.y },
                1 => Point {
                    x: f.r.width,
                    y: at.y,
                },
                2 => Point { x: at.x, y: 0.0 },
                _ => Point {
                    x: at.x,
                    y: f.r.width,
                },
            };
            out.push(Border { cell, point });
        }
    }
    out
}

/// Population representing this class in the selected development level. Explicit
/// exit floors also support ranks absent from that level's normal traffic table.
fn traffic_weight(class: usize, level: &profile::Level) -> u32 {
    [1, 15, 150, 1000, 5000]
        .into_iter()
        .find(|&p| class_index(p, level) <= class)
        .unwrap_or(5000)
}

impl Router<'_> {
    /// Route to exactly the selected dry border cell, then pin its endpoint on the
    /// geometric map edge. Failed searches never alter the shared road network.
    fn connect_exit(
        &mut self,
        site: usize,
        border: Border,
        importance: u32,
        class: usize,
    ) -> Option<Point> {
        let f = self.f;
        if f.r.water[border.cell] != 0 {
            return None;
        }
        let center = self.sites[site].center;
        let profile = self.profile_of(site);
        let goals = [border.cell];
        let mut query = Query {
            start: f.index(center),
            goals: &goals,
            origin: center,
            target: border.point,
            profile: &PROFILES[profile],
            class,
            tight: true,
            dig: self.dig_of(site),
        };
        let mut found = self.search_route(&query);
        if found.is_none() {
            query.tight = false;
            found = self.search_route(&query);
        }
        let mut cells = found?;
        if cells.len() < 2 || cells.last().copied() != Some(border.cell) {
            return None;
        }
        cells.reverse();
        self.net.add_path(f.r.n, &cells);
        for &cell in &cells {
            if !self.marked[cell] {
                self.marked[cell] = true;
                self.add_road_cell(cell, site);
            }
        }
        self.routed.push(Routed {
            cells,
            importance,
            profile,
            class_floor: Some(class),
            start: (border.point, "exit".into()),
            end: Some((center, self.sites[site].key.clone())),
        });
        Some(border.point)
    }
}

pub(super) fn route(seed: &str, router: &mut Router<'_>, out: &mut RoadOutput) -> Vec<Obtained> {
    let f = router.f;
    let sites = router.sites;
    let spacing = 1500.0_f64.max(0.12 * f.r.width);
    let border = borders(f, spacing);
    let mut obtained: Vec<Obtained> = vec![];
    let mut uses = vec![0_usize; sites.len()];
    let mut rng = Rng::new(&format!("magna-urbis:{seed}")).fork("exits");
    let largest = (0..sites.len())
        .max_by(|&a, &b| {
            sites[a]
                .population
                .cmp(&sites[b].population)
                .then(b.cmp(&a))
        })
        .unwrap();
    let angle = |p: Point| (p.y - 0.5 * f.r.width).atan2(p.x - 0.5 * f.r.width);
    for requested in router.cfg.exits.requests() {
        let mut report = ExitReport {
            requested: CLASSES[requested].into(),
            class: None,
            gateway: None,
            point: None,
            reason: None,
        };
        let mut gateways: Vec<usize> = (0..sites.len())
            .filter(|&i| {
                requested == 3 || class_index(sites[i].population, router.level) <= requested + 1
            })
            .collect();
        let class = if gateways.is_empty() {
            gateways.push(largest);
            class_index(sites[largest].population, router.level)
        } else {
            requested
        };
        let weight = traffic_weight(class, router.level);
        // Towns and the hub (the largest place) can accept several gateways with a
        // growing penalty. Other small places get at most one.
        gateways.retain(|&i| uses[i] == 0 || sites[i].population >= 1000 || i == largest);
        // Spacing and angular spread depend on the border point only: once per exit.
        let open: Vec<(Border, f64)> = border
            .iter()
            .filter(|b| {
                !obtained
                    .iter()
                    .any(|e| e.border.point.distance(b.point) < spacing)
            })
            .map(|&b| {
                // Cosine proximity penalises concentrating exits on the same angle
                // from the map centre; distance and population still favour nearby towns.
                let spread = obtained
                    .iter()
                    .map(|e| (0.5 + 0.5 * (angle(b.point) - angle(e.border.point)).cos()).powi(4))
                    .fold(0.0, f64::max);
                (b, spread)
            })
            .collect();
        let mut candidates = vec![];
        for &gateway in &gateways {
            let town = &sites[gateway];
            let reach = (town.population.max(1) as f64 / 150.0)
                .powf(0.18)
                .clamp(1.0, 3.0);
            for &(b, spread) in &open {
                let score = town.center.distance(b.point) / reach
                    + spacing * (0.8 * spread + uses[gateway] as f64)
                    + rng.range(0.0, 0.01);
                candidates.push((score, gateway, b));
            }
        }
        candidates.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then(a.1.cmp(&b.1))
                .then(a.2.cell.cmp(&b.2.cell))
        });
        let failure = if border.is_empty() {
            "no dry border"
        } else if gateways.is_empty() {
            "no gateway available"
        } else if candidates.is_empty() {
            "border spacing"
        } else {
            "no route"
        };
        // Up to 3 attempts, never repeating a failed border cell, nor a failed gateway
        // while others exist: an isolated best gateway must not consume every retry.
        let several = gateways.len() > 1;
        let (mut failed_gateways, mut failed_cells): (Vec<usize>, Vec<usize>) = (vec![], vec![]);
        let mut attempts = 0;
        for (_, gateway, b) in candidates {
            if attempts == 3 {
                break;
            }
            if failed_cells.contains(&b.cell) || (several && failed_gateways.contains(&gateway)) {
                continue;
            }
            attempts += 1;
            report.gateway = Some(sites[gateway].key.clone());
            report.point = Some(b.point);
            if let Some(point) = router.connect_exit(gateway, b, weight, class) {
                uses[gateway] += 1;
                obtained.push(Obtained {
                    border: b,
                    gateway,
                    weight,
                });
                report.point = Some(point);
                report.class = Some(CLASSES[class].into());
                if class > requested {
                    report.reason = Some("downgraded: no town large enough".into());
                }
                break;
            }
            failed_gateways.push(gateway);
            failed_cells.push(b.cell);
        }
        if report.class.is_none() {
            report.reason = Some(failure.into());
        }
        out.exits.push(report);
    }
    warn(out);
    obtained
}

pub(super) fn without_sites(counts: ExitCounts, out: &mut RoadOutput) {
    for requested in counts.requests() {
        out.exits.push(ExitReport {
            requested: CLASSES[requested].into(),
            class: None,
            gateway: None,
            point: None,
            reason: Some("no settlements".into()),
        });
    }
    warn(out);
}

fn warn(out: &mut RoadOutput) {
    let mut failures = BTreeMap::new();
    for r in out.exits.iter().filter(|r| r.class.is_none()) {
        *failures
            .entry((
                r.requested.as_str(),
                r.reason.as_deref().unwrap_or("no route"),
            ))
            .or_insert(0) += 1;
    }
    if failures.is_empty() {
        return;
    }
    let obtained = out.exits.iter().filter(|r| r.class.is_some()).count();
    let detail = failures
        .into_iter()
        .map(|((class, reason), count)| format!("{count} {class}: {reason}"))
        .collect::<Vec<_>>()
        .join("; ");
    out.warnings.push(warnings::map_exits(obtained, out.exits.len(), &detail));
}

pub(super) fn add_trips(
    exits: &[Obtained],
    sites: &[RoadSite],
    graph: &Graph,
    site_vertex: &[Option<usize>],
    trips: &mut Vec<(usize, usize, u32)>,
) {
    for exit in exits {
        let Some(source) = graph.vertex_of(exit.border.cell) else {
            continue;
        };
        for (i, site) in sites.iter().enumerate() {
            if let Some(target) = site_vertex[i] {
                // The direct exit path has a class floor. Beyond its gateway, a
                // destination can attract no more traffic than its own population.
                let weight = if i == exit.gateway {
                    exit.weight
                } else {
                    exit.weight.min(site.population)
                };
                trips.push((source, target, weight));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlements::Raster;

    const N: usize = 60;
    const WIDTH: f64 = 6000.0;

    fn fields(water: Vec<u8>) -> Fields {
        let height = vec![20.0_f32; N * N];
        let rivers = vec![0.0_f32; N * N];
        let ids = vec![-1_i32; N * N];
        Fields::new(Raster {
            width: WIDTH,
            n: N,
            height: &height,
            water: &water,
            water_level: &height,
            river_width: &rivers,
            river_ids: &ids,
        })
    }

    fn site(key: &str, population: u32, x: f64, y: f64) -> RoadSite {
        RoadSite {
            key: key.into(),
            population,
            culture: "european-organic".into(),
            center: Point { x, y },
            ..Default::default()
        }
    }

    fn config(exits: ExitCounts) -> RoadConfig {
        RoadConfig {
            exits,
            density: 0.0,
            wobble: 0.0,
            network_nodes: false,
            ..Default::default()
        }
    }

    fn on_border(p: Point) -> bool {
        p.x == 0.0 || p.y == 0.0 || p.x == WIDTH || p.y == WIDTH
    }

    fn assert_obtained(out: &RoadOutput, f: &Fields) {
        for report in out.exits.iter().filter(|r| r.class.is_some()) {
            let p = report.point.expect("an obtained exit has a point");
            assert!(on_border(p), "exit {report:?} is on the map edge");
            assert_eq!(f.r.water[f.index(p)], 0, "exit is on a dry border cell");
            let junction = out
                .junctions
                .iter()
                .position(|j| j.point == p)
                .expect("the reported point is in the finished network");
            assert_eq!(out.junctions[junction].site.as_deref(), Some("exit"));
            let rank = CLASSES
                .iter()
                .position(|&c| Some(c) == report.class.as_deref())
                .unwrap();
            let incident: Vec<_> = out
                .segments
                .iter()
                .filter(|s| s.a == junction || s.b == junction)
                .collect();
            assert!(!incident.is_empty(), "the exit has a road");
            assert!(
                incident.iter().all(|s| CLASSES
                    .iter()
                    .position(|&c| c == s.class.as_str())
                    .unwrap()
                    <= rank)
            );
            assert!(
                incident
                    .iter()
                    .any(|s| s.path.first() == Some(&p) || s.path.last() == Some(&p))
            );
            let gateway = out
                .junctions
                .iter()
                .position(|j| j.site.as_deref() == report.gateway.as_deref())
                .expect("the gateway is in the finished network");
            let mut reach = Union::new(out.junctions.len());
            for s in &out.segments {
                if CLASSES.iter().position(|&c| c == s.class.as_str()).unwrap() <= rank {
                    reach.join(s.a, s.b);
                }
            }
            assert_eq!(
                reach.find(junction),
                reach.find(gateway),
                "the entire exit path keeps its class floor"
            );
        }
        let points: Vec<_> = out
            .exits
            .iter()
            .filter(|r| r.class.is_some())
            .map(|r| r.point.unwrap())
            .collect();
        for (i, p) in points.iter().enumerate() {
            assert!(points[i + 1..].iter().all(|q| p.distance(*q) >= 1500.0));
        }
    }

    #[test]
    fn three_requested_exits_on_a_dry_region_reach_the_border() {
        let f = fields(vec![0; N * N]);
        let sites = [
            site("hub", 8000, 3000.0, 3000.0),
            site("west", 400, 1000.0, 2200.0),
            site("east", 350, 5000.0, 2400.0),
            site("south", 250, 3400.0, 5000.0),
        ];
        let cfg = config(ExitCounts {
            main: 2,
            local: 1,
            ..Default::default()
        });
        let out = super::super::route("regional-exits", &f, &sites, &cfg).unwrap();
        assert_eq!(out.exits.len(), 3);
        assert!(
            out.exits.iter().all(|r| r.class.is_some()),
            "{:?}",
            out.exits
        );
        assert_eq!(
            out.exits
                .iter()
                .map(|r| r.requested.as_str())
                .collect::<Vec<_>>(),
            ["main", "main", "local"]
        );
        assert_obtained(&out, &f);
        let again = super::super::route("regional-exits", &f, &sites, &cfg).unwrap();
        assert_eq!(
            serde_json::to_value(&out.exits).unwrap(),
            serde_json::to_value(&again.exits).unwrap()
        );
    }

    #[test]
    fn three_sea_sides_use_only_the_dry_land_side_and_report_shortfall() {
        let water = (0..N * N)
            .map(|i| {
                let (x, y) = (i % N, i / N);
                u8::from(x >= N - 10 || y < 10 || y >= N - 10)
            })
            .collect();
        let f = fields(water);
        let sites = [site("hub", 8000, 2800.0, 3000.0)];
        let cfg = config(ExitCounts {
            main: 6,
            ..Default::default()
        });
        let out = super::super::route("coastal-exits", &f, &sites, &cfg).unwrap();
        assert_eq!(out.exits.len(), 6);
        assert!(
            out.exits.iter().any(|r| r.class.is_some()),
            "{:?}",
            out.exits
        );
        for r in out.exits.iter().filter(|r| r.class.is_some()) {
            assert_eq!(r.point.unwrap().x, 0.0);
        }
        assert!(
            out.exits
                .iter()
                .any(|r| r.class.is_none() && r.reason.is_some()),
            "4 km of coast cannot fit six spaced exits"
        );
        assert_eq!(
            out.warnings
                .iter()
                .filter(|w| w.starts_with("Map exits:"))
                .count(),
            1
        );
        assert_obtained(&out, &f);
    }

    #[test]
    fn hamlets_downgrade_a_highway_request_and_explain_it() {
        let f = fields(vec![0; N * N]);
        let sites = [
            site("hamlet", 80, 2000.0, 3000.0),
            site("tiny", 30, 4200.0, 3100.0),
        ];
        let out = super::super::route(
            "hamlet-exit",
            &f,
            &sites,
            &config(ExitCounts {
                highway: 1,
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(out.exits.len(), 1);
        let report = &out.exits[0];
        assert_eq!(report.requested, "highway");
        assert_eq!(report.class.as_deref(), Some("track"));
        assert_eq!(report.gateway.as_deref(), Some("hamlet"));
        assert_eq!(
            report.reason.as_deref(),
            Some("downgraded: no town large enough")
        );
        assert_obtained(&out, &f);
    }

    #[test]
    fn a_peripheral_village_beats_a_distant_central_hub() {
        let f = fields(vec![0; N * N]);
        let sites = [
            site("hub", 12000, 3000.0, 3000.0),
            site("west", 300, 250.0, 3000.0),
        ];
        let out = super::super::route(
            "village-gateway",
            &f,
            &sites,
            &config(ExitCounts {
                local: 1,
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(out.exits.len(), 1);
        assert_eq!(out.exits[0].gateway.as_deref(), Some("west"));
        assert_eq!(out.exits[0].class.as_deref(), Some("local"));
        assert_eq!(out.exits[0].point.unwrap().x, 0.0);
        assert_obtained(&out, &f);
    }

    #[test]
    fn failures_and_zero_requests_have_an_explicit_contract() {
        let f = fields(
            (0..N * N)
                .map(|i| u8::from(i % N == 0 || i % N == N - 1 || i / N == 0 || i / N == N - 1))
                .collect(),
        );
        let sites = [site("hub", 8000, 3000.0, 3000.0)];
        let cfg = config(ExitCounts {
            main: 1,
            ..Default::default()
        });
        let out = super::super::route("wet-border", &f, &sites, &cfg).unwrap();
        assert_eq!(out.exits.len(), 1);
        assert!(out.exits[0].class.is_none());
        assert_eq!(out.exits[0].reason.as_deref(), Some("no dry border"));
        assert_eq!(
            out.warnings,
            ["Map exits: 0/1 — site constraints"]
        );
        let empty = super::super::route("empty-region", &f, &[], &cfg).unwrap();
        assert_eq!(empty.exits[0].reason.as_deref(), Some("no settlements"));
        let zero =
            super::super::route("no-exits", &f, &sites, &config(ExitCounts::default())).unwrap();
        assert!(zero.exits.is_empty());
        assert!(
            !zero
                .junctions
                .iter()
                .any(|j| j.site.as_deref() == Some("exit"))
        );
    }

    #[test]
    fn a_highway_gateway_continues_to_the_city_without_promoting_a_hamlet_spur() {
        let f = fields(vec![0; N * N]);
        let sites = [
            site("gateway", 2000, 250.0, 3000.0),
            site("city", 12000, 3500.0, 3000.0),
            site("hamlet", 50, 3500.0, 4800.0),
        ];
        let out = super::super::route(
            "highway-traffic",
            &f,
            &sites,
            &config(ExitCounts {
                highway: 1,
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(out.exits[0].gateway.as_deref(), Some("gateway"));
        assert_eq!(out.exits[0].class.as_deref(), Some("highway"));
        assert_obtained(&out, &f);
        let junction = |key: &str| {
            out.junctions
                .iter()
                .position(|j| j.site.as_deref() == Some(key))
                .unwrap()
        };
        let (gateway, city, hamlet) = (junction("gateway"), junction("city"), junction("hamlet"));
        let mut main = Union::new(out.junctions.len());
        for s in &out.segments {
            if s.class == "highway" || s.class == "main" {
                main.join(s.a, s.b);
            }
            if s.a == hamlet || s.b == hamlet {
                assert!(
                    s.class == "track" || s.class == "trail",
                    "a hamlet-only spur was inflated: {}",
                    s.class
                );
            }
        }
        assert_eq!(
            main.find(gateway),
            main.find(city),
            "exit traffic continues towards the city"
        );
        assert_ne!(main.find(gateway), main.find(hamlet));
    }

    #[test]
    fn a_failed_route_is_reported_even_with_dry_border_candidates() {
        // A sea ring separates the settlement from the dry outer strip.
        let f = fields(
            (0..N * N)
                .map(|i| {
                    let (x, y) = (i % N, i / N);
                    u8::from(
                        x >= 4
                            && x < N - 4
                            && y >= 4
                            && y < N - 4
                            && (x < 10 || x >= N - 10 || y < 10 || y >= N - 10),
                    )
                })
                .collect(),
        );
        let out = super::super::route(
            "island-exit",
            &f,
            &[site("island", 8000, 3000.0, 3000.0)],
            &config(ExitCounts {
                main: 1,
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(out.exits.len(), 1);
        assert!(out.exits[0].class.is_none());
        assert_eq!(out.exits[0].reason.as_deref(), Some("no route"));
        assert!(
            out.warnings
                .iter()
                .any(|w| w == "Map exits: 0/1 — site constraints")
        );
    }

    #[test]
    fn exit_json_is_per_class_and_counts_do_not_overflow() {
        let cfg: RoadConfig = serde_json::from_str(r#"{"exits":{"main":2,"local":1}}"#).unwrap();
        assert_eq!(
            cfg.exits,
            ExitCounts {
                main: 2,
                local: 1,
                ..Default::default()
            }
        );
        assert_eq!(
            RoadConfig::default().exits,
            ExitCounts {
                main: 1,
                local: 1,
                ..Default::default()
            }
        );
        assert!(serde_json::from_str::<RoadConfig>(r#"{"exits":2}"#).is_err());
        let excessive = config(ExitCounts {
            highway: 255,
            main: 255,
            local: 255,
            track: 255,
        });
        assert_eq!(excessive.exits.total(), 1020);
        assert!(validate(&[], &excessive, WIDTH).is_err());
    }
}
