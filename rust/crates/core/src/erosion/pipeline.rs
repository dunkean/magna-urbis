//! Retained CPU stages. Uses the existing flood, incision, thermal and surface kernels.
use super::*;
use crate::{Noise, Rng};

pub struct TerrainPipeline {
    p: Vec<f64>,
    s: Vec<f64>,
    flags: Vec<u32>,
    next: u32,
    noise: Noise,
    noise2: Noise,
    coarse_noise: Vec<f32>,
    fine_noise: Vec<f32>,
    grid: Grid,
    h: Vec<f32>,
    uplift: Vec<f32>,
    acc: Vec<f32>,
    channels: Vec<bool>,
    raw: Vec<f32>,
    output: Vec<f32>,
    drainage: Vec<f64>,
    scale: f64,
    tuning: [f64; 17],
}
impl TerrainPipeline {
    pub fn new(
        seed: &str,
        parameters: &[f32],
        surface: &[f32],
        flags: &[u32],
    ) -> Result<Self, String> {
        if seed.len() > 4096
            || parameters.len() != 41
            || surface.len() != 8
            || flags.len() != 11
            || parameters.iter().chain(surface).any(|v| !v.is_finite())
            || !(64.0..=640.0).contains(&parameters[2])
            || parameters[2].fract() != 0.0
            || !(500.0..=100000.0).contains(&parameters[0])
            || !(64.0..=1024.0).contains(&(surface[0] - 24.0))
            || surface[0].fract() != 0.0
            || !(1.0..=200.0).contains(&parameters[13])
            || parameters[13].fract()!=0.0
            || parameters[6..12].iter().any(|&v|v<=0.0)
            || !(1.0..=6.0).contains(&parameters[10])
            || !(0.0..=3.0).contains(&parameters[17])
            || !(0.0..=100.0).contains(&surface[3])
            || parameters[4] <= 0.0
            || surface[1] <= 0.0
            || flags[..9].iter().any(|&v| v > 1)
            || flags[9] > 2
            || flags[10] > 1
        {
            return Err("Invalid CPU procedural stage configuration".into());
        }
        let root = Rng::new(&format!("magna-urbis:{seed}")).fork("terrain");
        let n = parameters[2] as usize;
        let count = n * n;
        Ok(Self {
            p: parameters.iter().map(|&v| v as f64).collect(),
            s: surface.iter().map(|&v| v as f64).collect(),
            flags: flags.to_vec(),
            next: 0,
            noise: Noise::new(root.fork("noise")),
            noise2: Noise::new(root.fork("noise2")),
            coarse_noise:Vec::new(),fine_noise:Vec::new(),
            grid: Grid::new(n),
            h: vec![0.; count],
            uplift: vec![0.; count],
            acc: vec![1.; count],
            channels: vec![false; count],
            raw: Vec::new(),
            output: Vec::new(),
            drainage: Vec::new(),
            scale: 1.,
            tuning: TUNING.with(|v| v.get()),
        })
    }
    pub fn advance(&mut self, stage: u32) -> Result<(), String> {
        if stage != self.next || stage > 7 {
            return Err(format!("Expected CPU stage {}, got {stage}", self.next));
        }
        let previous = TUNING.with(|v| v.replace(self.tuning));
        match stage {
            0 => self.initialize(),
            1 => self.regional(),
            2 => self.finish(),
            3 => self.reconstruct(),
            4 => self.calibrate(),
            5 => self.detail(),
            6 => self.surface(),
            7 => self.normalize(),
            _ => unreachable!(),
        }
        TUNING.with(|v| v.set(previous));
        self.next += 1;
        if self.h.iter().chain(&self.output).any(|v| !v.is_finite()) {
            return Err("Non-finite CPU terrain".into());
        }
        Ok(())
    }
    pub fn set_noise(&mut self,coarse:&[f32],fine:&[f32])->Result<(),String>{
        if self.next!=0 || !coarse.is_empty()&&coarse.len()!=self.grid.n*self.grid.n*4 || fine.len()!=1024*1024*4 || coarse.iter().chain(fine).any(|v|!v.is_finite()){return Err("Invalid retained generation noises".into());}
        self.coarse_noise=coarse.to_vec();self.fine_noise=fine.to_vec();Ok(())
    }
    fn coarse_value(&self,i:usize,k:usize,f:impl FnOnce()->f64)->f64{self.coarse_noise.get(i*4+k).map_or_else(f,|&v|v as f64)}
    fn fine_value(&self,i:usize,k:usize,f:impl FnOnce()->f64)->f64{self.fine_noise.get(i*4+k).map_or_else(f,|&v|v as f64)}
    pub fn height(&self) -> Vec<f32> {
        if !self.output.is_empty() {
            return self.output.clone();
        }
        let p = &self.p;
        let nc = self.grid.n;
        (0..1024 * 1024)
            .map(|i| {
                sample(
                    &self.h,
                    nc,
                    (((i % 1024) as f64 + 0.5) * p[11] - p[5]) / p[4] - 0.5,
                    (((i / 1024) as f64 + 0.5) * p[11] - p[5]) / p[4] - 0.5,
                    false,
                ) as f32
            })
            .collect()
    }
    fn initialize(&mut self) {
        let p = &self.p;
        let n = self.grid.n;
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                let px = p[5] + (x as f64 + 0.5) * p[4];
                let py = p[5] + (y as f64 + 0.5) * p[4];
                let env = self.coarse_value(i,0,||self.noise.fbm(px / p[6] + 3.1, py / p[6] - 1.7, 3));
                let d=self.coarse_value(i,1,||self.noise2.fbm(px/(2700.*p[3])+8.4,py/(2700.*p[3]),3));
                let mountains = if self.flags[0] == 1 && p[32] > 0. {
                    let z = (d + (p[14] - 0.5) * 1.4) / 0.28;
                    0.5 + 0.5 * z / (1. + z * z).sqrt()
                } else {
                    smooth((d + (p[14] - 0.5) * 1.4 + 0.28) / 0.56)
                };
                let ridge = if p[32] > 0. {
                    self.coarse_value(i,3,||self.noise2.ridged(px / p[6] + 5.7, py / p[6] - 3.2, 3))
                } else {
                    0.
                };
                let q = ((px - p[0] * 0.5) * p[20] + (py - p[0] * 0.5) * p[21]) / p[0];
                let u = (0.7 + 0.5 * env - 0.25 * q).max(0.12)
                    * (0.20 + 0.80 * mountains)
                    * (1. + p[32] * mountains * (0.24 + 1.8 * ridge * ridge - 1.));
                let edge = x.min(y).min(n - 1 - x).min(n - 1 - y) as f64 / (0.1 * n as f64);
                self.uplift[i] = (u * (0.25 + 0.75 * smooth(edge))) as f32;
                self.h[i] = if self.grid.borders[i] {
                    0.
                } else {
                    (2.5 * u + 0.6 * self.coarse_value(i,2,||self.noise2.fbm(px / p[7], py / p[7], 3))) as f32
                };
            }
        }
    }
    fn regional(&mut self) {
        if self.flags[1] == 0 {
            return;
        }
        let p = &self.p;
        let n = self.grid.n;
        let count = n * n;
        for _ in 0..p[13] as usize {
            for i in 0..count {
                if !self.grid.borders[i] {
                    self.h[i] = (self.h[i] as f64 + self.uplift[i] as f64 * p[19]) as f32;
                }
            }
            if p[18] > 0. {
                let fl = flood(&self.h, &self.grid);
                resolve_pits(&mut self.h, &fl, &self.grid, (p[33] * p[18] * 0.6).min(0.6));
                carve_sills(&mut self.h, &fl, &self.grid, p[4], p[34]);
                let flow = continuous_flow(&fl, &self.grid);
                self.acc.fill(1.);
                for &c in fl.order.iter().rev() {
                    let r = flow.first[c];
                    let s = flow.second[c];
                    let t = flow.fraction[c] as f64;
                    if r != usize::MAX {
                        self.acc[r] = (self.acc[r] as f64 + self.acc[c] as f64 * (1. - t)) as f32;
                    }
                    if s != usize::MAX {
                        self.acc[s] = (self.acc[s] as f64 + self.acc[c] as f64 * t) as f32;
                    }
                }
                let base = self.h.clone();
                let cap = 4. * 0.004_f64.sqrt() * p[3] * 2400. / p[4];
                for &c in &fl.order {
                    let r = flow.first[c];
                    let s = flow.second[c];
                    if r == usize::MAX {
                        continue;
                    }
                    let t = flow.fraction[c] as f64;
                    let lower = if s == usize::MAX {
                        self.h[r] as f64
                    } else {
                        (1. - t) * self.h[r] as f64 + t * self.h[s] as f64
                    };
                    let original = if s == usize::MAX {
                        base[r] as f64
                    } else {
                        (1. - t) * base[r] as f64 + t * base[s] as f64
                    };
                    let slope =
                        ((base[c] as f64 - original) / (p[4] * flow.distance[c] as f64)).max(0.);
                    let response = slope * slope / (slope * slope + p[36] * p[36]);
                    let factor = (p[22] * (self.acc[c] as f64).sqrt().min(cap) * response
                        / flow.distance[c] as f64)
                        .min(6.);
                    self.h[c] = (self.h[c] as f64)
                        .min((self.h[c] as f64 + factor * lower) / (1. + factor))
                        as f32;
                }
                if self.flags[7] == 1 {
                    thermal(&mut self.h, &self.grid, p[4], p[15], 3, p[37] * p[18] * 0.8);
                }
                for i in 0..count {
                    self.channels[i] = self.acc[i] as f64 >= count as f64 * 0.001;
                }
                if self.flags[8] == 1 {
                    let dose = p[17] * 3. * p[18];
                    for _ in 0..dose.floor() as usize {
                        diffuse(&mut self.h, n, &self.channels, 0.5);
                    }
                    if dose.fract() > 0. {
                        diffuse(&mut self.h, n, &self.channels, 0.5 * dose.fract());
                    }
                }
            }
            for i in 0..count {
                if self.grid.borders[i] {
                    self.h[i] = 0.;
                }
            }
        }
    }
    fn finish(&mut self) {
        for h in &mut self.h {
            *h = h.max(0.);
        }
        if self.flags[2] == 0 || self.p[18] <= 0. {
            return;
        }
        let p = &self.p;
        if self.flags[7] == 1 {
            thermal(
                &mut self.h,
                &self.grid,
                p[4],
                p[15] * 0.95,
                4,
                p[37] * p[18] * 0.8,
            );
        }
        for _ in 0..2 {
            let fl = flood(&self.h, &self.grid);
            if resolve_pits(&mut self.h, &fl, &self.grid, p[33] * p[18] * 0.5) == 0 {
                break;
            }
            carve_sills(&mut self.h, &fl, &self.grid, p[4], p[35]);
        }
        if self.flags[8] == 1 {
            diffuse(&mut self.h, self.grid.n, &self.channels, p[18] * 0.5);
        }
    }
    fn reconstruct(&mut self) {
        let p = &self.p;
        let n = self.grid.n;
        self.raw = vec![0.; 1024 * 1024];
        self.drainage = vec![0.; self.raw.len()];
        let bspline = self.flags[9] == 2 || self.flags[9] == 0 && self.flags[0] == 1;
        for y in 0usize..1024 {
            for x in 0usize..1024 {
                let i = y * 1024 + x;
                let px = (x as f64 + 0.5) * p[11];
                let py = (y as f64 + 0.5) * p[11];
                let warp = p[38] * (16. * p[3]).min(p[4] * 0.9);
                let wx = px + warp * self.fine_value(i,0,||self.noise2.fbm(px / p[8] + 11.3, py / p[8], 2));
                let wy = py + warp * self.fine_value(i,1,||self.noise2.fbm(px / p[8] - 4.7, py / p[8] + 2.9, 2));
                let fx = (wx - p[5]) / p[4] - 0.5;
                let fy = (wy - p[5]) / p[4] - 0.5;
                self.raw[i] = if bspline {
                    sample_delta(&self.h, n, fx, fy)
                } else {
                    sample(&self.h, n, fx, fy, true)
                } as f32;
                let drainage = sample(
                    &self.acc,
                    n,
                    (px - p[5]) / p[4] - 0.5,
                    (py - p[5]) / p[4] - 0.5,
                    false,
                );
                self.drainage[i] = if self.flags[0] == 1 && self.flags[9] == 0 {
                    1.
                } else {
                    1. - 0.85
                        * p[18]
                        * smooth((drainage - 4.) / ((n * n) as f64 * 0.001 - 4.).max(12.))
                };
            }
        }
        self.output = self.raw.clone();
    }
    fn calibrate(&mut self) {
        if self.flags[3] == 1 {
            let mut sorted = self.raw.clone();
            let i = (sorted.len() as f64 * 0.99) as usize;
            let p99 = *sorted.select_nth_unstable_by(i, f32::total_cmp).1;
            self.scale = self.p[12] * (1. - 0.2 * self.p[18]) / (p99 as f64).max(0.0001);
        }
        self.output = self
            .raw
            .iter()
            .map(|&h| (h as f64 * self.scale).max(0.3) as f32)
            .collect();
    }
    fn detail(&mut self) {
        if self.flags[4] == 0 {
            return;
        }
        let p = &self.p;
        let amplitude = p[12] * (1. - 0.2 * p[18]);
        for y in 0usize..1024 {
            for x in 0usize..1024 {
                let i = y * 1024 + x;
                let gx = self.raw[y * 1024 + (x + 1).min(1023)] as f64
                    - self.raw[y * 1024 + x.saturating_sub(1)] as f64;
                let gy = self.raw[(y + 1).min(1023) * 1024 + x] as f64
                    - self.raw[y.saturating_sub(1) * 1024 + x] as f64;
                let slope = gx.hypot(gy) * self.scale / (2. * p[11]);
                let r=self.fine_value(i,2,||self.noise2.ridged((x as f64+0.5)*p[11]/p[9],(y as f64+0.5)*p[11]/p[9],p[10] as usize));
                self.output[i] = (self.raw[i] as f64 * self.scale
                    + (r - 0.5)
                        * p[16]
                        * amplitude
                        * smooth((slope - 0.015) / 0.3)
                        * self.drainage[i])
                    .max(0.3) as f32;
            }
        }
    }
    fn surface(&mut self) {
        if self.flags[5] == 0 || self.p[23] <= 0. {
            return;
        }
        let p = &self.p;
        let s = &self.s;
        let mut t = self.tuning;
        t[SURFACE_CARVE] = p[40];
        t[SURFACE_THERMAL] = s[5] / (p[23] * 0.09);
        t[SURFACE_DIFFUSION] = s[7] / (p[23] * 0.025);
        TUNING.with(|v| v.set(t));
        erode_with(
            &mut self.output,
            1024,
            p[11],
            p[23],
            s[4],
            &ShapeErosion {
                gain: s[6] / (p[23] * 0.07 * s[1]),
                routed: p[39] > 0.5,
                motif: p[3] * 2400.,
                coarse: s[0] as usize - 24,
                iterations: s[3] as usize,
                canyon_amplitude: (self.flags[10] == 1).then_some(p[12]),
            },
        );
    }
    fn normalize(&mut self) {
        if self.flags[6] == 1 {
            let mut sorted = self.output.clone();
            let i = (sorted.len() as f64 * 0.01) as usize;
            let p1 = *sorted.select_nth_unstable_by(i, f32::total_cmp).1;
            for h in &mut self.output {
                *h = (1. + *h - p1).max(0.3);
            }
        } else {
            for h in &mut self.output {
                *h = h.max(0.3);
            }
        }
    }
}
