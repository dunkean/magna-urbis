//! Cultural, access and envelope checks, with an admission table and shared memo.

#[cfg(test)]
use crate::urban::Shape;
use crate::urban::{Layout, Parcel, culture::CultureMapping, geometry::area, roles};
use std::collections::{BTreeMap, HashMap};

use super::{Demand, Reservation, UrbanProgramme, camps, dist,
    environment::{block_culture, function_class, parcel_culture}};

#[cfg(test)]
fn block_witness(layout: &Layout, shape: &Shape, width: f64, depth: f64) -> bool {
    crate::urban::parcels::contact_envelope(
        shape,
        &crate::urban::parcels::block_contacts(shape, layout),
        width,
        depth,
        0.8,
    )
    .is_some()
}

/// Witness rectangle, checked against all holes and edges. Several deterministic
/// stations prevent a concave centre from being mistaken for buildable width.
pub fn has_envelope(p: &Parcel, width: f64, depth: f64) -> bool {
    crate::urban::parcels::parcel_envelope(p, width, depth, 0.8).is_some()
}
#[cfg(test)]
pub(super) fn public_open_access(p: &Parcel, minimum: f64) -> bool {
    let contacts = p
        .contacts
        .iter()
        .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
        .cloned()
        .collect::<Vec<_>>();
    open_access_with(p, minimum, crate::urban::parcels::continuous_frontage(&contacts))
}
fn open_access_with(p: &Parcel, minimum: f64, public_frontage: f64) -> bool {
    if p.access
        .as_ref()
        .is_some_and(|a| matches!(a.kind.as_str(), "attached" | "unserved" | "private"))
    {
        return false;
    }
    public_frontage >= minimum
        || (p.contacts.is_empty()
            && p.access.as_ref().is_some_and(|a| {
                matches!(a.kind.as_str(), "public" | "collective") && a.front_length >= minimum
            }))
}
/// Fast deterministic hasher (Fx) for the allocation memo: every entry is a
/// pure function of its key and the maps are never iterated for a result, so
/// the hash choice cannot reach the output.
#[derive(Default, Clone, Copy)]
struct FxHasher(u64);
impl FxHasher {
    #[inline]
    fn add(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
}
impl std::hash::Hasher for FxHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for chunk in &mut chunks {
            let mut word = [0u8; 8];
            word.copy_from_slice(chunk);
            self.add(u64::from_le_bytes(word));
        }
        for &byte in chunks.remainder() {
            self.add(u64::from(byte));
        }
    }
    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.add(u64::from(i));
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.add(i);
    }
    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.add(i as u64);
    }
}
type FastMap<K, V> = HashMap<K, V, std::hash::BuildHasherDefault<FxHasher>>;
/// A candidate parcel ordered by (cost, index), costs compared with `total_cmp`.
pub(super) struct ReservedFor {
    pub(super) by_block: Vec<Option<String>>,
}
impl ReservedFor {
    pub(super) fn new(pr: &UrbanProgramme) -> Self {
        let len = pr.reservations.iter().map(|r| r.block + 1).max().unwrap_or(0);
        let mut by_block = vec![None; len];
        for r in &pr.reservations {
            by_block[r.block] = Some(r.demand_id.clone());
        }
        Self { by_block }
    }
    pub(super) fn get(&self, block: &usize) -> Option<&String> {
        self.by_block.get(*block).and_then(Option::as_ref)
    }
    pub(super) fn contains_key(&self, block: &usize) -> bool {
        self.get(block).is_some()
    }
}

/// Allocation memo: contextual mappings per (block, plot family, function class)
/// and envelope witnesses per (parcel, width, depth), reused across demands.
#[derive(Default)]
pub(super) struct Memo {
    camp_sources: FastMap<(usize, String, String), bool>,
    /// Court and compound lots without a parcel index (tests): per lot.
    mappings: FastMap<(usize, String, &'static str), Option<CultureMapping>>,
    /// Court and compound lots choose their profile per lot (full court house
    /// or the pack's compact house), so they are memoised per lot.
    lots: FastMap<(usize, &'static str), Option<CultureMapping>>,
    /// Other families: per (block, function class), the mapping of each family.
    by_family: FastMap<(usize, &'static str), Vec<(String, Option<CultureMapping>)>>,
    envelopes: FastMap<(usize, u64, u64), bool>,
    /// Continuous frontage per parcel: (all contacts, public contacts only).
    frontages: FastMap<usize, (f64, f64)>,
    /// Reserved-block witnesses per (parcel, width, depth), on one street index.
    witnesses: FastMap<(usize, u64, u64), bool>,
    index: Option<crate::urban::parcels::FrontageIndex>,
    /// Per-parcel fronts shared by every envelope size tested on it.
    fronts: FastMap<usize, Vec<crate::urban::parcels::Front>>,
    /// Per-parcel witnesses shared across allocation passes (`probe_cache`).
    shared_envelopes: FastMap<usize, Option<std::sync::Arc<crate::urban::parcels::EnvelopeMemo>>>,
    /// Whether the town is a camp (a pure function of the layout), read once.
    camp: Option<bool>,
    /// First reservation of each block (`u32::MAX`: none), built once.
    reservations: Option<std::sync::Arc<Vec<u32>>>,
}
impl Memo {
    /// Takes the entries of a memo filled on other parcels and blocks. Every
    /// entry is a pure function of its key, so a key both hold has one value.
    fn absorb(&mut self, other: Memo) {
        fn merge<K: std::hash::Hash + Eq, V>(into: &mut FastMap<K, V>, from: FastMap<K, V>) {
            for (k, v) in from {
                into.entry(k).or_insert(v);
            }
        }
        merge(&mut self.camp_sources, other.camp_sources);
        merge(&mut self.mappings, other.mappings);
        merge(&mut self.lots, other.lots);
        for (key, families) in other.by_family {
            let slot = self.by_family.entry(key).or_default();
            for entry in families {
                if !slot.iter().any(|known| known.0 == entry.0) {
                    slot.push(entry);
                }
            }
        }
        merge(&mut self.envelopes, other.envelopes);
        merge(&mut self.frontages, other.frontages);
        merge(&mut self.witnesses, other.witnesses);
        merge(&mut self.fronts, other.fronts);
        merge(&mut self.shared_envelopes, other.shared_envelopes);
        if self.index.is_none() {
            self.index = other.index;
        }
    }
    /// Reads the town-wide facts once, so that the memos started for the
    /// parallel scan (`Memo::seeded`) share them instead of rebuilding them
    /// per block.
    fn prepare(&mut self, layout: &Layout, pr: &UrbanProgramme) {
        self.camp(layout, pr);
        let _ = self.reservation(pr, 0);
    }
    /// An empty memo that already holds the town-wide facts of `prepare`.
    fn seeded(camp: Option<bool>, reservations: Option<std::sync::Arc<Vec<u32>>>) -> Memo {
        Memo {
            camp,
            reservations,
            ..Memo::default()
        }
    }
    fn camp(&mut self, layout: &Layout, pr: &UrbanProgramme) -> bool {
        *self
            .camp
            .get_or_insert_with(|| camps::camp(layout, pr.population))
    }
    /// The first reservation of a block, as `reservations.iter().find` gives it.
    fn reservation<'a>(&mut self, pr: &'a UrbanProgramme, block: usize) -> Option<&'a Reservation> {
        let index = self.reservations.get_or_insert_with(|| {
            let len = pr.reservations.iter().map(|r| r.block + 1).max().unwrap_or(0);
            let mut first = vec![u32::MAX; len];
            for (i, r) in pr.reservations.iter().enumerate().rev() {
                first[r.block] = i as u32;
            }
            std::sync::Arc::new(first)
        });
        match index.get(block) {
            Some(&i) if i != u32::MAX => pr.reservations.get(i as usize),
            _ => None,
        }
    }
    fn block_witness(&mut self, layout: &Layout, pi: usize, p: &Parcel, w: f64, d: f64) -> bool {
        #[cfg(test)]
        if pi == usize::MAX {
            return block_witness(layout, &p.shape, w, d);
        }
        if let Some(&hit) = self.witnesses.get(&(pi, w.to_bits(), d.to_bits())) {
            return hit;
        }
        let index = self
            .index
            .get_or_insert_with(|| crate::urban::parcels::FrontageIndex::new(layout));
        let contacts = crate::urban::parcels::block_contacts_indexed(&p.shape, layout, index);
        let ok = crate::urban::parcels::contact_envelope(&p.shape, &contacts, w, d, 0.8).is_some();
        self.witnesses.insert((pi, w.to_bits(), d.to_bits()), ok);
        ok
    }
    fn frontage(&mut self, pi: usize, p: &Parcel) -> (f64, f64) {
        let compute = || {
            let public = p
                .contacts
                .iter()
                .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
                .cloned()
                .collect::<Vec<_>>();
            (
                crate::urban::parcels::continuous_frontage(&p.contacts),
                crate::urban::parcels::continuous_frontage(&public),
            )
        };
        if pi == usize::MAX {
            return compute();
        }
        *self.frontages.entry(pi).or_insert_with(compute)
    }
    pub(super) fn mapping(&mut self, layout: &Layout, pi: usize, p: &Parcel, function: &str) -> Option<&CultureMapping> {
        let class = function_class(function);
        if matches!(p.family.as_str(), "courtyard" | "compound") {
            if pi != usize::MAX {
                return self
                    .lots
                    .entry((pi, class))
                    .or_insert_with(|| {
                        crate::urban::culture::parcel_mapping(layout, p, parcel_culture(layout, p), function)
                    })
                    .as_ref();
            }
            return self
                .mappings
                .entry((p.block, format!("{}\u{1}{}", p.family, p.id), class))
                .or_insert_with(|| {
                    crate::urban::culture::parcel_mapping(layout, p, parcel_culture(layout, p), function)
                })
                .as_ref();
        }
        let families = self.by_family.entry((p.block, class)).or_default();
        let at = match families.iter().position(|known| known.0 == p.family) {
            Some(at) => at,
            None => {
                families.push((
                    p.family.clone(),
                    crate::urban::culture::parcel_mapping(layout, p, parcel_culture(layout, p), function),
                ));
                families.len() - 1
            }
        };
        families[at].1.as_ref()
    }
    fn envelope(&mut self, pi: usize, p: &Parcel, width: f64, depth: f64) -> bool {
        let key = (pi, width.to_bits(), depth.to_bits());
        if let Some(&hit) = self.envelopes.get(&key) {
            return hit;
        }
        let ok = stored_witness(p, width, depth) || {
            if pi == usize::MAX {
                has_envelope(p, width, depth)
            } else {
                let fronts = self
                    .fronts
                    .entry(pi)
                    .or_insert_with(|| crate::urban::parcels::envelope_fronts(p));
                let shared = self
                    .shared_envelopes
                    .entry(pi)
                    .or_insert_with(|| crate::urban::parcels::envelope_memo(p, fronts));
                match shared {
                    Some(m) => m.has(p, fronts, width, depth, 0.8),
                    None => crate::urban::parcels::parcel_envelope_with(p, fronts, width, depth, 0.8).is_some(),
                }
            }
        };
        self.envelopes.insert(key, ok);
        ok
    }
}
/// The cadastral witness is a frontage-anchored rectangle inside the plot, first
/// edge along the front. When it is at least `width` x `depth`, a smaller
/// rectangle at the same corner is a valid witness too; no geometry rerun.
fn stored_witness(p: &Parcel, width: f64, depth: f64) -> bool {
    let (Some(e), Some([fa, fb])) = (&p.envelope, p.front) else {
        return false;
    };
    let [a, b, c, ..] = e.outer[..] else {
        return false;
    };
    let (u, f) = ((b.x - a.x, b.y - a.y), (fb.x - fa.x, fb.y - fa.y));
    let (lu, lf) = (u.0.hypot(u.1), f.0.hypot(f.1));
    lu + 1e-6 >= width
        && dist(b, c) + 1e-6 >= depth
        && lf > 1e-6
        && (u.0 * f.1 - u.1 * f.0).abs() <= 0.02 * lu * lf
}
/// Copyable admission summary, so eligibility never clones a mapping.
#[derive(Clone, Copy)]
struct Admit {
    min_frontage: f64,
    min_depth: f64,
    min_access_width: f64,
    min_area: f64,
    max_slope: f64,
    borrowed: bool,
}
impl Admit {
    fn of(c: &CultureMapping) -> Self {
        let a = &c.admissibility;
        Self {
            min_frontage: a.min_frontage,
            min_depth: a.min_depth,
            min_access_width: a.min_access_width,
            min_area: a.min_area,
            max_slope: a.max_slope,
            borrowed: !c.borrowing.is_empty(),
        }
    }
}
#[cfg(test)]
pub(super) fn eligible(layout: &Layout, p: &Parcel, d: &Demand, pr: &UrbanProgramme) -> bool {
    eligible_memo(layout, usize::MAX, p, d, pr, &mut Memo::default())
}
pub(super) fn eligible_memo(
    layout: &Layout,
    pi: usize,
    p: &Parcel,
    d: &Demand,
    pr: &UrbanProgramme,
    memo: &mut Memo,
) -> bool {
    // `camps::supported` holds for any town that is not a camp (or isolated).
    if matches!(d.function.as_str(), "collective" | "warehouse" | "workshop")
        && memo.camp(layout, pr)
        && !*memo.camp_sources.entry((p.block, d.role.clone(), d.function.clone()))
            .or_insert_with(|| camps::supported(layout, pr.population, p.block, d, &pr.context)) { return false; }
    let Some(c) = memo.mapping(layout, pi, p, &d.function).map(Admit::of) else {
        return false;
    };
    if pr.context.mode == "strict" && c.borrowed {
        return false;
    }
    // A lone farm or structure is admitted on its own reserved block whatever its slope,
    // frontage or envelope: that plot is the place (kinds.rs `homestead`), its bodies
    // stand on stepped plinths. Never an isolated place left without its building.
    if roles::is_isolated(&pr.context.intent)
        && pr.context.intent != "activity"
        && memo.reservation(pr, p.block).is_some_and(|r| r.demand_id == d.id)
        && pr.environment.get(p.block).is_none_or(|e| !e.wet)
    {
        return true;
    }
    if pr
        .environment
        .get(p.block)
        .is_some_and(|e| e.wet || (pr.context.intent != "activity" && e.slope > crate::urban::profiles::house_slope(block_culture(layout, p.block), c.max_slope, pr.context.slope_relax)))
    {
        return false;
    }
    if d.requires.iter().any(|r| r == "navigableAccess")
        && (!pr.navigable_frontage
            || !pr.environment.get(p.block).is_some_and(|e| e.waterfront))
    {
        return false;
    }
    if d.requires.iter().any(|r| r == "waterfront")
        && !pr.environment.get(p.block).is_some_and(|e| e.waterfront)
    {
        return false;
    }
    let envelope = |memo: &mut Memo| {
        if pi == usize::MAX {
            has_envelope(p, c.min_frontage, c.min_depth)
        } else {
            memo.envelope(pi, p, c.min_frontage, c.min_depth)
        }
    };
    if let Some(res) = memo.reservation(pr, p.block) {
        if res.demand_id != d.id {
            return false;
        }
        if matches!(d.function.as_str(), "market" | "common") {
            return open_access_with(p, c.min_access_width, memo.frontage(pi, p).1);
        }
        if pr.context.intent == "activity" && d.role == "craft.activity" {
            // The reserved domain already holds the actual yard. Keep that
            // proof only while the whole domain survives cadastral edits.
            return crate::urban::geometry::difference(&res.shape, &p.shape).iter().map(area).sum::<f64>() <= 0.01;
        }
        if d.landmark && has_envelope(p, 4.0, 4.0) { return true; }
        return envelope(memo) || memo.block_witness(layout, pi, p, c.min_frontage, c.min_depth);
    }
    if roles::is_isolated(&pr.context.intent) {
        return false;
    }
    if matches!(d.function.as_str(), "market" | "common") {
        let accessible = open_access_with(p, c.min_access_width, memo.frontage(pi, p).1);
        let open_kind = matches!(p.use_kind.as_str(), "place" | "market" | "common")
            || (p.use_kind == "reserve"
                && matches!(p.reason.as_str(), "reserve:market" | "reserve:common"));
        if open_kind || d.function == "common" {
            return accessible && (open_kind || p.use_kind == "garden"
                || d.sites > 0 && matches!(p.use_kind.as_str(), "plot" | "compound"));
        }
    }
    if matches!(p.use_kind.as_str(), "reserve" | "place" | "market") {
        return false;
    }
    if !matches!(p.use_kind.as_str(), "plot" | "compound") {
        return false;
    }
    let Some(access) = &p.access else {
        return false;
    };
    let gate = matches!(access.kind.as_str(), "private" | "collective");
    let minimum = if gate {
        c.min_access_width
    } else {
        c.min_frontage.max(d.target_frontage)
    };
    let frontage = if p.contacts.is_empty() {
        access.front_length
    } else {
        memo.frontage(pi, p).0
    };
    if matches!(access.kind.as_str(), "unserved" | "attached") || frontage < minimum {
        return false;
    }
    area(&p.shape) >= c.min_area && envelope(memo)
}

pub(super) fn admission_rows(
    layout: &Layout,
    parcels: &[Parcel],
    pr: &UrbanProgramme,
    reserved_for: &ReservedFor,
    reserved_parcels: &impl Fn(&str) -> Vec<usize>,
) -> (Vec<Vec<bool>>, Memo) {
    let mut memo = Memo::default();
    // Eligibility is shared by demands of one class outside reserved blocks.
    let mut classes: HashMap<(String, String, u64), Vec<bool>> = HashMap::new();
    let class_key = |d: &Demand| {
        (
            d.function.clone(),
            if camps::camp(layout, pr.population) { format!("{}|{}", d.requires.join("|"), d.role) } else { d.requires.join("|") },
            d.target_frontage.to_bits(),
        )
    };
    // The class rows (each from the first demand of its class, as the scan
    // below would) are evaluated block by block in parallel. Within a block the
    // parcels are tested in the scan's order (class, then parcel), and the memo
    // keys are per parcel or per block, so every memoised witness is the one the
    // serial scan would keep; the block memos are then merged for later bands.
    {
        let mut pending: Vec<((String, String, u64), usize)> = vec![];
        for (di, d) in pr.demands.iter().enumerate() {
            if d.function == "mixed" && d.unit == "domesticUnits" || d.sites > 0 {
                continue;
            }
            let key = class_key(d);
            if !pending.iter().any(|(k, _)| *k == key) {
                pending.push((key, di));
            }
        }
        let mut by_block: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (pi, p) in parcels.iter().enumerate() {
            if !reserved_for.contains_key(&p.block) {
                by_block.entry(p.block).or_default().push(pi);
            }
        }
        let groups: Vec<Vec<usize>> = by_block.into_values().collect();
        let mut rows = vec![vec![false; parcels.len()]; pending.len()];
        if !pending.is_empty() {
            memo.prepare(layout, pr);
            let (seed_camp, seed_reservations) = (memo.camp, memo.reservations.clone());
            let pr_ref = pr;
            let done = crate::urban::par::map(&groups, |_, group| {
                let mut local = Memo::seeded(seed_camp, seed_reservations.clone());
                let part: Vec<Vec<bool>> = pending
                    .iter()
                    .map(|&(_, di)| {
                        group
                            .iter()
                            .map(|&pi| eligible_memo(layout, pi, &parcels[pi], &pr_ref.demands[di], pr_ref, &mut local))
                            .collect()
                    })
                    .collect();
                (part, local)
            });
            for (group, (part, local)) in groups.iter().zip(done) {
                for (row, values) in rows.iter_mut().zip(part) {
                    for (&pi, ok) in group.iter().zip(values) {
                        row[pi] = ok;
                    }
                }
                memo.absorb(local);
            }
        }
        for ((key, _), row) in pending.into_iter().zip(rows) {
            classes.insert(key, row);
        }
    }
    let admission = pr
        .demands
        .iter()
        .map(|d| {
            // Sited roles only need their own reserved plots up front; any
            // other plot is tested lazily, best sites first (band 2).
            // Shops are a small share: their plots are tested lazily from the
            // best commercial frontages down (band 3).
            if d.function == "mixed" && d.unit == "domesticUnits" {
                return vec![false; parcels.len()];
            }
            if d.sites > 0 {
                let mut row = vec![false; parcels.len()];
                for pi in reserved_parcels(&d.id) {
                    row[pi] = eligible_memo(layout, pi, &parcels[pi], d, pr, &mut memo);
                }
                return row;
            }
            let key = class_key(d);
            if !classes.contains_key(&key) {
                let base = parcels
                    .iter()
                    .enumerate()
                    .map(|(pi, p)| {
                        !reserved_for.contains_key(&p.block)
                            && eligible_memo(layout, pi, p, d, pr, &mut memo)
                    })
                    .collect::<Vec<_>>();
                classes.insert(key.clone(), base);
            }
            let mut row = classes[&key].clone();
            for pi in reserved_parcels(&d.id) {
                row[pi] = eligible_memo(layout, pi, &parcels[pi], d, pr, &mut memo);
            }
            row
        })
        .collect::<Vec<_>>();
    (admission, memo)
}
