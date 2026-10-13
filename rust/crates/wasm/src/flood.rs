//! Priority-flood drainage of the terrain bench's vector water chain, the
//! kernel of `web/src/ui/simpleHydrology.ts` `computeHydrology`, bit for bit:
//! same flood order (height, then insertion), same D8 ties, same float32
//! accumulation rounded from float64 sums, as the TypeScript version computes.

use wasm_bindgen::prelude::*;

const DX: [isize; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY: [isize; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];

/// Monotone priority queue in (height, insertion) order: a radix heap on the
/// sortable float32 bits. The flood only pushes cells at or above the level it
/// pops, so keys never fall below the last popped one. Equal heights pop
/// first-in, first-out, so the order is exactly the binary heap's on the
/// (height, insertion count) key, without one redistribution per pop.
struct FloodHeap {
    /// Bucket b > 0 holds keys whose highest bit differing from `last` is b - 1;
    /// bucket 0 the keys equal to `last`, unpopped from `head` on.
    buckets: Vec<Vec<(u32, u32)>>,
    last: u32,
    head: usize,
    size: usize,
}

impl FloodHeap {
    fn new() -> Self {
        Self { buckets: (0..33).map(|_| Vec::new()).collect(), last: 0, head: 0, size: 0 }
    }
    #[inline]
    fn bucket(&self, key: u32) -> usize {
        if key == self.last { 0 } else { 32 - (key ^ self.last).leading_zeros() as usize }
    }
    fn push(&mut self, cell: usize, height: f32) {
        let bits = if height == 0.0 { 0.0_f32 } else { height }.to_bits();
        let key = if bits & 0x8000_0000 != 0 { !bits } else { bits | 0x8000_0000 };
        debug_assert!(key >= self.last);
        let b = self.bucket(key);
        self.buckets[b].push((key, cell as u32));
        self.size += 1;
    }
    fn pop(&mut self) -> usize {
        if self.head == self.buckets[0].len() {
            self.buckets[0].clear();
            self.head = 0;
            let i = (1..33).find(|&i| !self.buckets[i].is_empty()).unwrap();
            let mut moved = std::mem::take(&mut self.buckets[i]);
            self.last = moved.iter().map(|e| e.0).min().unwrap();
            // Every lower bucket is empty and each bucket stays in insertion
            // order, so ties keep their first-in, first-out order.
            for &(key, cell) in &moved {
                let b = self.bucket(key);
                self.buckets[b].push((key, cell));
            }
            // Keep the emptied bucket's allocation.
            moved.clear();
            if self.buckets[i].is_empty() {
                self.buckets[i] = moved;
            }
        }
        self.size -= 1;
        self.head += 1;
        self.buckets[0][self.head - 1].1 as usize
    }
    fn is_empty(&self) -> bool {
        self.size == 0
    }
}

/// Grids of one flood; each `take_*` hands its array to JavaScript once.
#[wasm_bindgen]
pub struct Flood {
    filled: Vec<f32>,
    receiver: Vec<i32>,
    order: Vec<i32>,
    accumulation: Vec<f32>,
    basin: Vec<i32>,
    sea: Vec<u8>,
    outlets: u32,
}

#[wasm_bindgen]
impl Flood {
    pub fn take_filled(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.filled)
    }
    pub fn take_receiver(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.receiver)
    }
    pub fn take_order(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.order)
    }
    pub fn take_accumulation(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.accumulation)
    }
    pub fn take_basin(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.basin)
    }
    pub fn take_sea(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.sea)
    }
    #[wasm_bindgen(getter)]
    pub fn outlets(&self) -> u32 {
        self.outlets
    }
}

/// Priority-flood from the sea, the map edge and the `outlet` cells, then D8
/// on the filled surface, upstream areas and basins. Empty `weight`, `outlet`
/// and `loss` slices mean none.
#[wasm_bindgen]
pub fn flood_hydrology(height: &[f32], n: usize, cell_area: f64, weight: &[f32], outlet: &[u8], loss: &[f32]) -> Result<Flood, JsValue> {
    let total = n * n;
    if n < 2 || height.len() != total {
        return Err(JsValue::from_str("Grille hydrologique invalide."));
    }
    let weight = (weight.len() == total).then_some(weight);
    let outlet = (outlet.len() == total).then_some(outlet);
    let loss = (loss.len() == total).then_some(loss);
    let mut filled = height.to_vec();
    let mut receiver = vec![-1_i32; total];
    let mut order = vec![0_i32; total];
    let mut sea = vec![0_u8; total];
    let last = n - 1;

    // Sea: cells at or below zero connected to the map edge.
    let mut stack = Vec::new();
    for i in 0..n {
        for c in [i, last * n + i, i * n, i * n + last] {
            if height[c] <= 0.0 && sea[c] == 0 {
                sea[c] = 1;
                stack.push(c);
            }
        }
    }
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

    // Outlets: the sea, the extra outlets and the map edge.
    let mut heap = FloodHeap::new();
    for y in 0..n {
        for x in 0..n {
            let c = y * n + x;
            if sea[c] != 0 || outlet.is_some_and(|o| o[c] != 0) || x == 0 || y == 0 || x == last || y == last {
                heap.push(c, height[c]);
                // Outlets are done: marked -2 until the flood ends.
                receiver[c] = -2;
            }
        }
    }
    let offsets: [isize; 8] = std::array::from_fn(|k| DY[k] * n as isize + DX[k]);
    let mut pit = vec![0_u32; total];
    let (mut head, mut tail, mut popped) = (0_usize, 0_usize, 0_usize);
    while head < tail || !heap.is_empty() {
        let c = if head < tail {
            head += 1;
            pit[head - 1] as usize
        } else {
            heap.pop()
        };
        order[popped] = c as i32;
        popped += 1;
        let (x, y) = (c % n, c / n);
        let level = filled[c];
        let inner = x > 0 && y > 0 && x < last && y < last;
        for k in 0..8 {
            let nb = if inner {
                (c as isize + offsets[k]) as usize
            } else {
                let (xx, yy) = (x as isize + DX[k], y as isize + DY[k]);
                if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                    continue;
                }
                yy as usize * n + xx as usize
            };
            if receiver[nb] != -1 {
                continue;
            }
            receiver[nb] = c as i32;
            let z = height[nb];
            if z <= level {
                filled[nb] = level;
                pit[tail] = nb as u32;
                tail += 1;
            } else {
                heap.push(nb, z);
            }
        }
        if head == tail {
            head = 0;
            tail = 0;
        }
    }

    for r in receiver.iter_mut() {
        if *r == -2 {
            *r = -1;
        }
    }

    // Steepest D8 descent on the filled surface; flats keep their flood parent.
    let distance: [f64; 8] = std::array::from_fn(|k| if DX[k] != 0 && DY[k] != 0 { std::f64::consts::SQRT_2 } else { 1.0 });
    for y in 0..n {
        for x in 0..n {
            let c = y * n + x;
            if receiver[c] < 0 || sea[c] != 0 || outlet.is_some_and(|o| o[c] != 0) {
                continue;
            }
            let z = filled[c] as f64;
            let (mut best, mut slope) = (-1_isize, 0.0_f64);
            let inner = x > 0 && y > 0 && x < last && y < last;
            for k in 0..8 {
                let nb = if inner {
                    c as isize + offsets[k]
                } else {
                    let (xx, yy) = (x as isize + DX[k], y as isize + DY[k]);
                    if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                        continue;
                    }
                    yy * n as isize + xx
                };
                // Only a positive drop above the best slope can win: a diagonal
                // divides it by sqrt(2), never raising it, so skip that division.
                let drop = z - filled[nb as usize] as f64;
                if drop > slope {
                    let s = drop / distance[k];
                    if s > slope {
                        slope = s;
                        best = nb;
                    }
                }
            }
            if best >= 0 {
                receiver[c] = best as i32;
            }
        }
    }

    // Upstream areas in reverse flood order, float32 storage of float64 sums.
    let mut accumulation = vec![0.0_f32; total];
    for c in 0..total {
        if sea[c] == 0 {
            accumulation[c] = (cell_area * weight.map_or(1.0, |w| w[c] as f64)) as f32;
        }
    }
    for k in (0..total).rev() {
        let c = order[k] as usize;
        if let Some(l) = loss {
            let v = l[c];
            if v != 0.0 && !v.is_nan() {
                accumulation[c] = (accumulation[c] as f64 - v as f64).max(0.0) as f32;
            }
        }
        let r = receiver[c];
        if r >= 0 {
            let r = r as usize;
            accumulation[r] = (accumulation[r] as f64 + accumulation[c] as f64) as f32;
        }
    }
    let mut basin = vec![0_i32; total];
    let mut ids = 0_i32;
    for k in 0..total {
        let c = order[k] as usize;
        let r = receiver[c];
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
        if sea[c] == 0 && drains[b] == 0 {
            drains[b] = 1;
            outlets += 1;
        }
    }
    Ok(Flood { filled, receiver, order, accumulation, basin, sea, outlets })
}
