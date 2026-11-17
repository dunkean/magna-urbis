//! A stable mix of planned occupants. Household counts still drive allocation;
//! occupants are separate demographic data, not certified building capacity.
use super::{roles, UrbanProgramme};

fn hash(id: &str) -> u64 {
    id.bytes().fold(14695981039346656037u64, |h, b| (h ^ u64::from(b)).wrapping_mul(1099511628211))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn village() -> UrbanProgramme {
        let mut allocations: Vec<_> = (0..100).map(|i| json!({
            "parcelId":format!("home-{i}"),"demandId":"housing","function":"domestic",
            "culture":"european-organic","architecturePack":"EUR-MED","capacity":1.,
            "unit":"domesticUnits","score":0.,"reasons":[],"households":1.
        })).collect();
        allocations.push(json!({"parcelId":"hall","demandId":"hall","function":"collective",
            "culture":"european-organic","architecturePack":"EUR-MED","capacity":300.,
            "unit":"usefulAreaM2","score":0.,"reasons":[],"households":0.}));
        serde_json::from_value(json!({"version":1,"population":315,"context":{},"cultures":[],
            "demands":[{"id":"housing","function":"domestic","unit":"domesticUnits","requested":100.,
                "targetArea":0.,"targetFrontage":0.,"provenance":["profile:3.15 persons/domesticUnit"],
                "requires":[],"parcelCapacity":100.,"builtCapacity":0.,"deficit":100.,"reasons":[]}],
            "reservations":[],"allocations":allocations,"adjacency":[],"environment":[],
            "reconciliationPasses":0,"warnings":[]})).unwrap()
    }

    #[test]
    fn small_places_have_more_households_but_city_profiles_stay_unchanged() {
        // 3.15 persons per household, 0.85 home per household in a village.
        let rural = roles::settlement_occupancy("european-organic", 1200);
        assert!((rural.household_size - 3.15 / 0.85).abs() < 1e-10);
        assert_eq!(roles::settlement_occupancy("european-organic", 20000).household_size, roles::occupancy("european-organic").household_size);
        // Extended-family cultures (Norse family, 8) keep larger rural households.
        assert!((roles::settlement_occupancy("celtic-oppidum", 1200).household_size - 5. / 0.85).abs() < 1e-10);
        // A family's tent keeps the cultural household.
        assert_eq!(roles::settlement_occupancy("native-plains", 1200).household_size, roles::occupancy("native-plains").household_size);
        assert_eq!(roles::settlement_occupancy("native-iroquoian", 1200).household_size, roles::occupancy("native-iroquoian").household_size);
        assert_eq!(roles::settlement_occupancy("european-organic", 5000).household_size, roles::occupancy("european-organic").household_size);
    }

    /// Villages build 15 % fewer homes than households; farmsteads, camps and
    /// towns from 4,500 keep one home per household, and the curve is continuous.
    /// Homes per inhabitant never rise with population.
    #[test]
    fn villages_build_fewer_homes_and_the_curve_never_rises() {
        assert_eq!(roles::homes_per_household(10), 1.);
        assert_eq!(roles::homes_per_household(150), 0.85);
        assert_eq!(roles::homes_per_household(2500), 0.85);
        assert_eq!(roles::homes_per_household(4500), 1.);
        assert_eq!(roles::homes_per_household(20000), 1.);
        assert_eq!(roles::settlement_occupancy("native-plains", 300).household_size, roles::occupancy("native-plains").household_size);
        let mut last = f64::MAX;
        for p in (15..6000).step_by(5) {
            let jump = (roles::homes_per_household(p + 1) - roles::homes_per_household(p)).abs();
            assert!(jump < 0.01, "{p}: jump {jump}");
            let homes = 1. / roles::settlement_occupancy("european-organic", p).household_size;
            assert!(homes <= last + 1e-12, "{p}: {homes} homes per inhabitant rise above {last}");
            last = homes;
        }
    }

    #[test]
    fn single_people_and_couples_preserve_population_and_exclude_the_hall() {
        let mut pr = village(); assign(&mut pr);
        assert_eq!(pr.allocations.iter().map(|a| a.residents.unwrap()).sum::<f64>(), 315.);
        assert!(pr.allocations.iter().any(|a| a.households == 1. && a.residents == Some(1.)));
        assert!(pr.allocations.iter().any(|a| a.households == 1. && a.residents == Some(2.)));
        assert_eq!(pr.allocations.last().unwrap().residents, Some(0.));
        let before: std::collections::BTreeMap<_, _> = pr.allocations.iter().map(|a| (a.parcel_id.clone(), a.residents)).collect();
        pr.allocations.reverse(); assign(&mut pr);
        assert_eq!(pr.allocations.iter().map(|a| (a.parcel_id.clone(), a.residents)).collect::<std::collections::BTreeMap<_, _>>(), before);
    }

    #[test]
    fn missing_housing_is_not_credited_with_the_full_population() {
        let mut pr = village(); pr.allocations.truncate(50); assign(&mut pr);
        assert_eq!(pr.allocations.iter().map(|a| a.residents.unwrap()).sum::<f64>(), 158.);
        let mut city = village(); city.population = 20000; assign(&mut city);
        assert!(city.allocations.iter().all(|a| a.residents.is_none()));
    }
}

pub(super) fn assign(pr: &mut UrbanProgramme) {
    if pr.population >= 5000 || roles::is_isolated(&pr.context.intent) || pr.context.intent == "activity" { return; }
    let wanted: f64 = pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d| d.requested).sum();
    // Probes request unbounded households to measure parcel yield only.
    if wanted <= 0. || wanted > pr.population as f64 { return; }
    let mut homes: Vec<usize> = pr.allocations.iter().enumerate()
        .filter(|(_, a)| a.unit == "domesticUnits" && a.households > 0.)
        .map(|(i, _)| i).collect();
    homes.sort_by(|&i, &j| hash(&pr.allocations[i].parcel_id).cmp(&hash(&pr.allocations[j].parcel_id))
        .then_with(|| pr.allocations[i].parcel_id.cmp(&pr.allocations[j].parcel_id)));
    let households: f64 = homes.iter().map(|&i| pr.allocations[i].households).sum();
    let minimum_people: f64 = homes.iter().map(|&i| pr.allocations[i].households.ceil().max(1.)).sum();
    let mean = pr.demands.iter().flat_map(|d| &d.provenance)
        .find_map(|text| text.split("profile:").nth(1)?.split_whitespace().next()?.parse::<f64>().ok())
        .unwrap_or_else(|| roles::settlement_occupancy(pr.allocations.first().map_or("european-organic", |a| a.culture.as_str()), pr.population).household_size);
    let target = (households * mean).min(pr.population as f64).round().max(minimum_people);
    // Mean 3.2, with single people and couples where households are small
    // (about 3 people): the whole mix scales with the culture's household
    // size, so an extended-family compound or a longhouse household of 7-8
    // is never drawn as one person. Multi-household plots keep their count.
    const MIX: [f64; 10] = [1., 2., 2., 3., 3., 3., 4., 4., 5., 5.];
    for a in &mut pr.allocations { a.residents = Some(0.); }
    // One profile lookup per culture, not per home.
    let mut means: Vec<(String, f64)> = vec![];
    let mut total = 0.;
    for &i in &homes {
        let a = &mut pr.allocations[i];
        let mean = match means.iter().find(|(c, _)| *c == a.culture) {
            Some(&(_, m)) => m,
            None => {
                let m = roles::settlement_occupancy(&a.culture, pr.population).household_size;
                means.push((a.culture.clone(), m));
                m
            }
        };
        let bucket = (hash(&a.parcel_id) % 10) as usize;
        let size = (MIX[bucket] * mean / 3.2).round().max(1.);
        let people = (a.households * size).round().max(1.);
        a.residents = Some(people); total += people;
    }
    // Preserve the target when the land covers it; a shortage stays a shortage.
    while (total - target).abs() >= 0.5 {
        let mut changed = false;
        for &i in &homes {
            let minimum = pr.allocations[i].households.ceil().max(1.);
            let people = pr.allocations[i].residents.as_mut().unwrap();
            if total < target { *people += 1.; total += 1.; changed = true; }
            else if *people > minimum { *people -= 1.; total -= 1.; changed = true; }
            if (total - target).abs() < 0.5 { break; }
        }
        if !changed { break; }
    }
    for &i in &homes {
        let a = &mut pr.allocations[i];
        if let Some(need) = &mut a.housing_floor_need {
            need.model.persons_per_household = a.residents.unwrap() / a.households;
        }
    }
}
