//! Priority-flood drainage of the vector water chain, the kernel of
//! `web/src/ui/simpleHydrology.ts` `computeHydrology`, bit for bit: same flood
//! order (height, then insertion), same D8 ties, same float32 accumulation
//! rounded from float64 sums, as the TypeScript version computes.
//!
//! Heights are presorted, so the priority queue is one ascending sweep. It pops
//! what a queue would: cells enter it strictly above the level being drained, so
//! when the sweep reaches a height, every queued cell of that height is known and
//! only equal heights need their insertion order. Serial speed comes first: the
//! browser's default WASM has no threads.

const DX: [isize; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY: [isize; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];
/// Outlets are marked with this receiver until the flood ends.
const OUTLET: i32 = -2;
/// Slots of the incision's rate table (a power of two).
const RATES: usize = 2048;

/// Grids of one flood.
#[derive(Default)]
pub struct FloodGrids {
    pub filled: Vec<f32>,
    pub receiver: Vec<i32>,
    pub order: Vec<i32>,
    pub accumulation: Vec<f32>,
    pub basin: Vec<i32>,
    pub sea: Vec<u8>,
    pub outlets: u32,
}

/// Scratch reused by the successive floods of one erosion.
#[derive(Default)]
struct Scratch {
    keys: Vec<(u32, u32)>,
    spare: Vec<(u32, u32)>,
    /// Insertion rank of the queued cells, 0 for any other cell.
    queued: Vec<u32>,
    pit: Vec<u32>,
    ties: Vec<(u32, u32)>,
    stack: Vec<usize>,
}

/// Priority-flood from the sea, the map edge and the `outlet` cells, then D8 on
/// the filled surface, upstream areas and basins. Heights must be finite.
pub fn flood_grids(
    height: &[f32],
    n: usize,
    cell_area: f64,
    weight: Option<&[f32]>,
    outlet: Option<&[u8]>,
    loss: Option<&[f32]>,
) -> FloodGrids {
    let mut grids = FloodGrids::default();
    flood(height, n, cell_area, weight, outlet, loss, true, &mut grids, &mut Scratch::default());
    let total = n * n;
    let mut basin = vec![0_i32; total];
    let mut ids = 0_i32;
    for &cell in &grids.order {
        let c = cell as usize;
        let r = grids.receiver[c];
        basin[c] = if r < 0 {
            ids += 1;
            ids - 1
        } else {
            basin[r as usize]
        };
    }
    let mut drains = vec![0_u8; ids as usize];
    let mut outlets = 0;
    for c in 0..total {
        let b = basin[c] as usize;
        if grids.sea[c] == 0 && drains[b] == 0 {
            drains[b] = 1;
            outlets += 1;
        }
    }
    grids.basin = basin;
    grids.outlets = outlets;
    grids
}

/// The pre-hydrology stream-power erosion of `web/src/ui/reliefConditioning.ts` (`erode`), bit for
/// bit: `steps` floods, each followed by implicit incision in flood order towards the receiver's
/// water surface, depressions rising `deposit` of their depth. Same float64 arithmetic stored as
/// float32 as the TypeScript loop.
pub fn erode_grid(height: &mut [f32], n: usize, cell_area: f64, steps: u32, deposit: f64) {
    let mut grids = FloodGrids::default();
    let mut scratch = Scratch::default();
    let (wide, narrow) = (n + 1, n - 1);
    // Most cells share a few small drainage areas: their square roots and
    // divisions are looked up, the same values as computing them.
    let mut rates = vec![(u32::MAX, 0.0_f64, 0.0_f64); RATES];
    for _ in 0..steps {
        flood(height, n, cell_area, None, None, None, false, &mut grids, &mut scratch);
        let FloodGrids { filled, receiver, order, accumulation, .. } = &grids;
        for &c in &order[..scratch.keys.len()] {
            let c = c as usize;
            // SAFETY: the flood's cells and receivers lie on the n² grid of all these slices.
            unsafe {
                let r = *receiver.get_unchecked(c);
                // Sea cells are outlets: they have no receiver either.
                if r < 0 {
                    continue;
                }
                let r = r as usize;
                let here = *height.get_unchecked(c) as f64;
                let depth = *filled.get_unchecked(c) as f64 - here;
                if depth > 0.01 {
                    *height.get_unchecked_mut(c) = (here + deposit * depth) as f32;
                    continue;
                }
                let base = (*height.get_unchecked(r) as f64).max(*filled.get_unchecked(r) as f64);
                if here > base {
                    let area = *accumulation.get_unchecked(c);
                    let bits = area.to_bits();
                    let slot = rates.get_unchecked_mut((bits ^ bits >> 12) as usize & (RATES - 1));
                    if slot.0 != bits {
                        let rate = 0.03 * (area as f64 / 1e6).sqrt();
                        *slot = (bits, rate, rate / std::f64::consts::SQRT_2);
                    }
                    let step = c.abs_diff(r);
                    let f = if step == wide || step == narrow { slot.2 } else { slot.1 };
                    *height.get_unchecked_mut(c) = ((here + f * base) / (1.0 + f)) as f32;
                }
            }
        }
    }
}

/// Sortable bits of a finite height; both zeros share one key.
#[inline(always)]
fn height_key(height: f32) -> u32 {
    let bits = if height == 0.0 { 0.0_f32 } else { height }.to_bits();
    if bits & 0x8000_0000 != 0 {
        !bits
    } else {
        bits | 0x8000_0000
    }
}

/// The height of cell `c` from its key; a zero's sign only lives in the grid.
#[inline(always)]
fn key_height(key: u32, height: &[f32], c: usize) -> f32 {
    if key == 0x8000_0000 {
        return height[c];
    }
    f32::from_bits(if key & 0x8000_0000 != 0 { key & 0x7FFF_FFFF } else { !key })
}

/// The flood's moving state.
struct Sweep<'a> {
    n: usize,
    height: &'a [f32],
    filled: &'a mut [f32],
    receiver: &'a mut [i32],
    order: &'a mut [i32],
    queued: &'a mut [u32],
    pit: &'a mut [u32],
    offsets: [isize; 8],
    popped: usize,
    inserted: u32,
    /// Outlets hold the first insertion ranks.
    outlets: u32,
}

impl Sweep<'_> {
    /// `c` reaches its neighbour `nb`, at the water level `level`.
    #[inline(always)]
    fn reach(&mut self, c: usize, nb: usize, level: f32, tail: &mut usize) {
        // SAFETY: `nb` is a cell of the grid; a cell is reached once, so the
        // pit queue, as long as the grid, never overflows.
        unsafe {
            let receiver = self.receiver.get_unchecked_mut(nb);
            if *receiver != -1 {
                return;
            }
            *receiver = c as i32;
            if *self.height.get_unchecked(nb) <= level {
                *self.filled.get_unchecked_mut(nb) = level;
                *self.pit.get_unchecked_mut(*tail) = nb as u32;
                *tail += 1;
            } else {
                self.inserted += 1;
                *self.queued.get_unchecked_mut(nb) = self.inserted;
            }
        }
    }

    #[inline(always)]
    fn visit(&mut self, c: usize) {
        // SAFETY: each cell is visited once, and `order` has one slot per cell.
        unsafe { *self.order.get_unchecked_mut(self.popped) = c as i32 };
        self.popped += 1;
    }

    /// A cell away from the map edge: every edge cell is an outlet.
    #[inline(always)]
    fn expand(&mut self, c: usize, level: f32, tail: &mut usize) {
        self.visit(c);
        for k in 0..8 {
            self.reach(c, c.wrapping_add_signed(self.offsets[k]), level, tail);
        }
    }

    #[inline(never)]
    fn expand_outlet(&mut self, c: usize, level: f32, tail: &mut usize) {
        self.visit(c);
        let n = self.n as isize;
        let (x, y) = ((c % self.n) as isize, (c / self.n) as isize);
        for k in 0..8 {
            let (xx, yy) = (x + DX[k], y + DY[k]);
            if xx >= 0 && yy >= 0 && xx < n && yy < n {
                self.reach(c, (yy * n + xx) as usize, level, tail);
            }
        }
    }

    /// Pops the queued cell `c` of insertion rank `rank`, then its pit: cells at or
    /// below its level drain by breadth-first fronts from the spill, all at that
    /// level, before the queue resumes.
    #[inline(always)]
    fn pop(&mut self, c: usize, rank: u32, level: f32) {
        let (mut head, mut tail) = (0, 0);
        if rank <= self.outlets {
            self.expand_outlet(c, level, &mut tail);
        } else {
            self.expand(c, level, &mut tail);
        }
        while head < tail {
            // SAFETY: `head` is below `tail`, within the pit queue.
            let at = unsafe { *self.pit.get_unchecked(head) } as usize;
            head += 1;
            self.expand(at, level, &mut tail);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn flood(
    height: &[f32],
    n: usize,
    cell_area: f64,
    weight: Option<&[f32]>,
    outlet: Option<&[u8]>,
    loss: Option<&[f32]>,
    every_cell: bool,
    grids: &mut FloodGrids,
    scratch: &mut Scratch,
) {
    let total = n * n;
    let last = n - 1;
    grids.filled.clear();
    grids.filled.extend_from_slice(height);
    refill(&mut grids.receiver, total, -1);
    refill(&mut grids.sea, total, 0);
    refill(&mut scratch.queued, total, 0);
    grids.order.resize(total, 0);
    scratch.pit.resize(total, 0);
    let (sea, receiver, queued) = (&mut grids.sea, &mut grids.receiver, &mut scratch.queued);

    // Sea: cells at or below zero connected to the map edge.
    let stack = &mut scratch.stack;
    for i in 0..n {
        for c in [i, last * n + i, i * n, i * n + last] {
            if height[c] <= 0.0 && sea[c] == 0 {
                sea[c] = 1;
                stack.push(c);
            }
        }
    }
    let any_sea = !stack.is_empty();
    while let Some(c) = stack.pop() {
        let (x, y) = ((c % n) as isize, (c / n) as isize);
        for k in 0..8 {
            let (xx, yy) = (x + DX[k], y + DY[k]);
            if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                continue;
            }
            let nb = yy as usize * n + xx as usize;
            if sea[nb] == 0 && height[nb] <= 0.0 {
                sea[nb] = 1;
                stack.push(nb);
            }
        }
    }

    // Outlets: the sea, the extra outlets and the map edge, queued in raster order.
    let mut inserted = 0;
    let mut queue = |c: usize| {
        inserted += 1;
        queued[c] = inserted;
        receiver[c] = OUTLET;
    };
    if any_sea || outlet.is_some() {
        for y in 0..n {
            for x in 0..n {
                let c = y * n + x;
                if sea[c] != 0
                    || outlet.is_some_and(|o| o[c] != 0)
                    || x == 0
                    || y == 0
                    || x == last
                    || y == last
                {
                    queue(c);
                }
            }
        }
    } else {
        (0..n).for_each(&mut queue);
        for y in 1..last {
            queue(y * n);
            queue(y * n + last);
        }
        (last * n..total).for_each(&mut queue);
    }

    let keys = &mut scratch.keys;
    if any_sea && !every_cell {
        // An outlet among outlets reaches nothing: without `order` in the output,
        // the open sea stays out of the flood.
        keys.clear();
        let near_land = |x: usize, y: usize| {
            (y.saturating_sub(1)..(y + 2).min(n))
                .any(|yy| (x.saturating_sub(1)..(x + 2).min(n)).any(|xx| sea[yy * n + xx] == 0))
        };
        for y in 0..n {
            for x in 0..n {
                let c = y * n + x;
                if sea[c] == 0 || near_land(x, y) {
                    keys.push((height_key(height[c]), c as u32));
                }
            }
        }
    } else {
        keys.resize(total, (0, 0));
        crate::terrain_par::cells(keys, |i, entry| *entry = (height_key(height[i]), i as u32));
    }
    crate::terrain_par::radix_sort(keys, &mut scratch.spare);
    let count = keys.len();

    let mut sweep = Sweep {
        n,
        height,
        filled: &mut grids.filled,
        receiver,
        order: &mut grids.order,
        queued,
        pit: &mut scratch.pit,
        offsets: std::array::from_fn(|k| DY[k] * n as isize + DX[k]),
        popped: 0,
        inserted,
        outlets: inserted,
    };
    let ties = &mut scratch.ties;
    let mut k = 0;
    while k < count {
        let (key, c) = keys[k];
        if k + 1 == count || keys[k + 1].0 != key {
            k += 1;
            let rank = sweep.queued[c as usize];
            if rank != 0 {
                // A queued cell's level is its height: no need to read it back.
                sweep.pop(c as usize, rank, key_height(key, height, c as usize));
            }
            continue;
        }
        // Equal heights pop first-in, first-out.
        ties.clear();
        while k < count && keys[k].0 == key {
            let cell = keys[k].1;
            let rank = sweep.queued[cell as usize];
            if rank != 0 {
                ties.push((rank, cell));
            }
            k += 1;
        }
        ties.sort_unstable();
        for &(rank, cell) in ties.iter() {
            sweep.pop(cell as usize, rank, key_height(key, height, cell as usize));
        }
    }
    debug_assert_eq!(sweep.popped, count);

    // Steepest D8 descent on the filled surface; flats keep their flood parent.
    // Sea, outlet and edge cells have no receiver: every other cell is inner.
    let offsets = sweep.offsets;
    let filled: &[f32] = &grids.filled;
    crate::terrain_par::rows(&mut grids.receiver, n, |y, row| {
        for (x, receiver) in row.iter_mut().enumerate() {
            if *receiver < 0 {
                *receiver = -1;
                continue;
            }
            let c = y * n + x;
            let z = filled[c] as f64;
            let (mut best, mut slope) = (-1_i32, 0.0_f64);
            for k in 0..8 {
                let nb = c.wrapping_add_signed(offsets[k]);
                // SAFETY: `c` is inner, so `nb` is on the grid.
                let drop = z - unsafe { *filled.get_unchecked(nb) } as f64;
                // Only a positive drop above the best slope can win: a diagonal
                // divides it by sqrt(2), never raising it, so skip that division.
                if drop > slope {
                    let s = if DX[k] != 0 && DY[k] != 0 {
                        drop / std::f64::consts::SQRT_2
                    } else {
                        drop
                    };
                    if s > slope {
                        slope = s;
                        best = nb as i32;
                    }
                }
            }
            if best >= 0 {
                *receiver = best;
            }
        }
    });

    // Upstream areas in reverse flood order, float32 storage of float64 sums.
    let (sea, receiver, order) = (&grids.sea, &grids.receiver, &grids.order[..count]);
    let accumulation = &mut grids.accumulation;
    accumulation.resize(total, 0.0);
    match weight {
        None if !any_sea => accumulation.fill(cell_area as f32),
        _ => {
            for c in 0..total {
                accumulation[c] = if sea[c] == 0 {
                    (cell_area * weight.map_or(1.0, |w| w[c] as f64)) as f32
                } else {
                    0.0
                };
            }
        }
    }
    for &c in order.iter().rev() {
        let c = c as usize;
        // SAFETY: the flood's cells and receivers lie on the grid.
        unsafe {
            if let Some(l) = loss {
                let v = *l.get_unchecked(c);
                if v != 0.0 && !v.is_nan() {
                    let cell = accumulation.get_unchecked_mut(c);
                    *cell = (*cell as f64 - v as f64).max(0.0) as f32;
                }
            }
            let r = *receiver.get_unchecked(c);
            if r >= 0 {
                let upstream = *accumulation.get_unchecked(c) as f64;
                let down = accumulation.get_unchecked_mut(r as usize);
                *down = (*down as f64 + upstream) as f32;
            }
        }
    }
}

fn refill<T: Copy>(values: &mut Vec<T>, len: usize, value: T) {
    values.clear();
    values.resize(len, value);
}

#[cfg(test)]
mod tests;
