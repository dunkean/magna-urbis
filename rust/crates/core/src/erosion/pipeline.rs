//! Retained CPU stages. Uses the existing flood, incision, thermal and surface kernels.
use super::*;
use crate::{Noise, Rng};

#[allow(clippy::too_many_arguments)]
pub fn cut_coast_field(seed: &str, width: f64, motif: f64, amplitude: f64, mask: u32, mode: &str,
    n: usize, origin: f64, cell: f64, field: &mut [f32]) -> Result<(), String> {
    if n < 2 || field.len()!=n*n || !width.is_finite() || width<=0. || !motif.is_finite() || motif<=0.
        || !amplitude.is_finite() || amplitude<0. || !origin.is_finite() || !cell.is_finite() || cell<=0.
        || field.iter().any(|v|!v.is_finite()) { return Err("Invalid coast field".into()); }
    let root=Rng::new(&format!("magna-urbis:{seed}")).fork("terrain");
    let mut coast=crate::coast::Coast::new(root.fork("coast"),width,motif,amplitude,0.);
    coast.configure(mask,mode)?;
    crate::terrain_par::rows(field,n,|y,row| {
        for (x,h) in row.iter_mut().enumerate() {
            *h=coast.apply(origin+(x as f64+0.5)*cell,origin+(y as f64+0.5)*cell,width,*h as f64,cell) as f32;
        }
    });
    Ok(())
}

pub struct TerrainPipeline {
    seed: String,
    checkpoints: Vec<Checkpoint>,
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
/// Only retain fields which a later phase still reads. Noise and topology are
/// deterministic and stay on the live pipeline rather than in every checkpoint.
struct Checkpoint {
    next: u32,
    h: Vec<f32>, uplift: Vec<f32>, acc: Vec<f32>, channels: Vec<bool>,
    raw: Vec<f32>, output: Vec<f32>, drainage: Vec<f64>, scale: f64,
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
            seed: seed.to_owned(), checkpoints: Vec::new(),
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
    pub fn checkpoint(&mut self, slot: usize) -> Result<(), String> {
        if slot > self.checkpoints.len() || slot > 8 { return Err("Invalid terrain checkpoint".into()); }
        self.checkpoints.truncate(slot);
        self.checkpoints.push(Checkpoint {
            next: self.next,
            h: if self.next <= 3 { self.h.clone() } else { Vec::new() },
            uplift: if self.next <= 1 { self.uplift.clone() } else { Vec::new() },
            acc: if self.next <= 3 { self.acc.clone() } else { Vec::new() },
            channels: if self.next <= 2 { self.channels.clone() } else { Vec::new() },
            raw: if (4..=5).contains(&self.next) { self.raw.clone() } else { Vec::new() },
            output: self.output.clone(),
            drainage: if (4..=5).contains(&self.next) { self.drainage.clone() } else { Vec::new() },
            scale: self.scale,
        });
        Ok(())
    }
    pub fn restore(&mut self, slot: usize, parameters: &[f32], surface: &[f32], flags: &[u32]) -> Result<(), String> {
        // Revalidate new controls; the caller identifies the unchanged prefix.
        let configured = Self::new(&self.seed, parameters, surface, flags)?;
        if configured.grid.n != self.grid.n { return Err("Terrain checkpoint grid changed".into()); }
        let c = self.checkpoints.get(slot).ok_or("Missing terrain checkpoint")?;
        self.next=c.next; self.h=c.h.clone(); self.uplift=c.uplift.clone(); self.acc=c.acc.clone();
        self.channels=c.channels.clone(); self.raw=c.raw.clone(); self.output=c.output.clone();
        self.drainage=c.drainage.clone(); self.scale=c.scale;
        self.p=configured.p; self.s=configured.s; self.flags=configured.flags; self.tuning=configured.tuning;
        self.checkpoints.truncate(slot+1);
        Ok(())
    }
    pub fn checkpoint_height(&self, slot: usize) -> Result<Vec<f32>, String> {
        let c = self.checkpoints.get(slot).ok_or("Missing terrain checkpoint")?;
        Ok(if !c.output.is_empty() { c.output.clone() } else { self.sample_height(&c.h) })
    }
    /// An early coast is allowed to evolve in subsequent erosion/normalization.
    /// The geographic cut is applied again at finishing to keep a marine coast.
    pub fn cut_coast(&mut self, mask: u32, mode: &str) -> Result<(), String> {
        if mask == 0 { return Ok(()); }
        let p=&self.p;
        let (n, origin, cell, field) = if self.next <= 3 {
            (self.grid.n, p[5], p[4], &mut self.h)
        } else { (1024, 0., p[11], &mut self.output) };
        cut_coast_field(&self.seed,p[0],p[3]*2400.,p[12],mask,mode,n,origin,cell,field)?;
        if (4..=5).contains(&self.next) {
            self.raw=self.output.iter().map(|&h|(h as f64/self.scale.max(1e-12)) as f32).collect();
        }
        Ok(())
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
    /// Final field without a copy: moves the retained output out (the pipeline
    /// is done with it); before reconstruction, the same values as `height`.
    pub fn take_height(&mut self) -> Vec<f32> {
        if !self.output.is_empty() {
            return std::mem::take(&mut self.output);
        }
        self.height()
    }
    pub fn height(&self) -> Vec<f32> {
        if !self.output.is_empty() {
            return self.output.clone();
        }
        self.sample_height(&self.h)
    }
    fn sample_height(&self, h: &[f32]) -> Vec<f32> {
        let p = &self.p;
        let nc = self.grid.n;
        (0..1024 * 1024)
            .map(|i| {
                sample(
                    h,
                    nc,
                    (((i % 1024) as f64 + 0.5) * p[11] - p[5]) / p[4] - 0.5,
                    (((i / 1024) as f64 + 0.5) * p[11] - p[5]) / p[4] - 0.5,
                    false,
                ) as f32
            })
            .collect()
    }
    fn initialize(&mut self) {
        let mut uplift = std::mem::take(&mut self.uplift);
        let mut h = std::mem::take(&mut self.h);
        let this = &*self;
        let p = &this.p;
        let n = this.grid.n;
        crate::terrain_par::rows2(&mut uplift, &mut h, n, |y, uplift, h| {
            for x in 0..n {
                let i = y * n + x;
                let px = p[5] + (x as f64 + 0.5) * p[4];
                let py = p[5] + (y as f64 + 0.5) * p[4];
                let env = this.coarse_value(i,0,||this.noise.fbm(px / p[6] + 3.1, py / p[6] - 1.7, 3));
                let d=this.coarse_value(i,1,||this.noise2.fbm(px/(2700.*p[3])+8.4,py/(2700.*p[3]),3));
                let mountains = if this.flags[0] == 1 && p[32] > 0. {
                    let z = (d + (p[14] - 0.5) * 1.4) / 0.28;
                    0.5 + 0.5 * z / (1. + z * z).sqrt()
                } else {
                    smooth((d + (p[14] - 0.5) * 1.4 + 0.28) / 0.56)
                };
                let ridge = if p[32] > 0. {
                    this.coarse_value(i,3,||this.noise2.ridged(px / p[6] + 5.7, py / p[6] - 3.2, 3))
                } else {
                    0.
                };
                let q = ((px - p[0] * 0.5) * p[20] + (py - p[0] * 0.5) * p[21]) / p[0];
                let u = (0.7 + 0.5 * env - 0.25 * q).max(0.12)
                    * (0.20 + 0.80 * mountains)
                    * (1. + p[32] * mountains * (0.24 + 1.8 * ridge * ridge - 1.));
                let edge = x.min(y).min(n - 1 - x).min(n - 1 - y) as f64 / (0.1 * n as f64);
                uplift[x] = (u * (0.25 + 0.75 * smooth(edge))) as f32;
                h[x] = if this.grid.borders[i] {
                    0.
                } else {
                    (2.5 * u + 0.6 * this.coarse_value(i,2,||this.noise2.fbm(px / p[7], py / p[7], 3))) as f32
                };
            }
        });
        self.uplift = uplift;
        self.h = h;
    }
    fn regional(&mut self) {
        if self.flags[1] == 0 {
            return;
        }
        let p = &self.p;
        let n = self.grid.n;
        let count = n * n;
        let mut work = Work::default();
        let cap = 4. * 0.004_f64.sqrt() * p[3] * 2400. / p[4];
        for _ in 0..p[13] as usize {
            for i in 0..count {
                if !self.grid.borders[i] {
                    self.h[i] = (self.h[i] as f64 + self.uplift[i] as f64 * p[19]) as f32;
                }
            }
            if p[18] > 0. {
                work.flood.compute(&self.h, &self.grid, Some(&mut work.flow));
                let fl = &work.flood;
                resolve_pits(&mut self.h, fl, &self.grid, (p[33] * p[18] * 0.6).min(0.6), &mut work.basins);
                carve_sills(&mut self.h, fl, &self.grid, p[4], p[34], &mut work.basins);
                accumulate_f64(&mut self.acc, &fl.order, &work.flow);
                let acc = &self.acc;
                incise(&mut self.h, &fl.order, &work.flow, &mut work.baseline, None, p[4], |c, slope, distance| {
                    let response = slope * slope / (slope * slope + p[36] * p[36]);
                    (p[22] * (acc[c] as f64).sqrt().min(cap) * response / distance).min(6.)
                });
                if self.flags[7] == 1 {
                    thermal(&mut self.h, &self.grid, p[4], p[15], 3, p[37] * p[18] * 0.8, &mut work.relax);
                }
                for i in 0..count {
                    self.channels[i] = self.acc[i] as f64 >= count as f64 * 0.001;
                }
                if self.flags[8] == 1 {
                    let dose = p[17] * 3. * p[18];
                    for _ in 0..dose.floor() as usize {
                        diffuse(&mut self.h, n, &self.channels, 0.5, &mut work.relax);
                    }
                    if dose.fract() > 0. {
                        diffuse(&mut self.h, n, &self.channels, 0.5 * dose.fract(), &mut work.relax);
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
        let mut work = Work::default();
        if self.flags[7] == 1 {
            thermal(
                &mut self.h,
                &self.grid,
                p[4],
                p[15] * 0.95,
                4,
                p[37] * p[18] * 0.8,
                &mut work.relax,
            );
        }
        for _ in 0..2 {
            work.flood.compute(&self.h, &self.grid, None);
            if resolve_pits(&mut self.h, &work.flood, &self.grid, p[33] * p[18] * 0.5, &mut work.basins) == 0 {
                break;
            }
            carve_sills(&mut self.h, &work.flood, &self.grid, p[4], p[35], &mut work.basins);
        }
        if self.flags[8] == 1 {
            diffuse(&mut self.h, self.grid.n, &self.channels, p[18] * 0.5, &mut work.relax);
        }
    }
    fn reconstruct(&mut self) {
        let mut raw = vec![0.; 1024 * 1024];
        let mut drainage = vec![0.; raw.len()];
        let this = &*self;
        let p = &this.p;
        let n = this.grid.n;
        let bspline = this.flags[9] == 2 || this.flags[9] == 0 && this.flags[0] == 1;
        crate::terrain_par::rows2(&mut raw, &mut drainage, 1024, |y, raw, drainage_row| {
            for x in 0usize..1024 {
                let i = y * 1024 + x;
                let px = (x as f64 + 0.5) * p[11];
                let py = (y as f64 + 0.5) * p[11];
                let warp = p[38] * (16. * p[3]).min(p[4] * 0.9);
                let wx = px + warp * this.fine_value(i,0,||this.noise2.fbm(px / p[8] + 11.3, py / p[8], 2));
                let wy = py + warp * this.fine_value(i,1,||this.noise2.fbm(px / p[8] - 4.7, py / p[8] + 2.9, 2));
                let fx = (wx - p[5]) / p[4] - 0.5;
                let fy = (wy - p[5]) / p[4] - 0.5;
                raw[x] = if bspline {
                    sample_delta(&this.h, n, fx, fy)
                } else {
                    sample(&this.h, n, fx, fy, true)
                } as f32;
                let drainage = sample(
                    &this.acc,
                    n,
                    (px - p[5]) / p[4] - 0.5,
                    (py - p[5]) / p[4] - 0.5,
                    false,
                );
                drainage_row[x] = if this.flags[0] == 1 && this.flags[9] == 0 {
                    1.
                } else {
                    1. - 0.85
                        * p[18]
                        * smooth((drainage - 4.) / ((n * n) as f64 * 0.001 - 4.).max(12.))
                };
            }
        });
        self.output = raw.clone();
        self.raw = raw;
        self.drainage = drainage;
    }
    fn calibrate(&mut self) {
        if self.flags[3] == 1 {
            let i = (self.raw.len() as f64 * 0.99) as usize;
            let p99 = nth_smallest(&self.raw, i);
            self.scale = self.p[12] * (1. - 0.2 * self.p[18]) / (p99 as f64).max(0.0001);
        }
        let (raw, scale) = (&self.raw, self.scale);
        self.output.resize(raw.len(), 0.);
        crate::terrain_par::cells(&mut self.output, |i, out| {
            *out = (raw[i] as f64 * scale).max(0.3) as f32;
        });
    }
    fn detail(&mut self) {
        if self.flags[4] == 0 {
            return;
        }
        let mut output = std::mem::take(&mut self.output);
        let this = &*self;
        let p = &this.p;
        let raw = &this.raw;
        let amplitude = p[12] * (1. - 0.2 * p[18]);
        crate::terrain_par::rows(&mut output, 1024, |y, row| {
            for x in 0usize..1024 {
                let i = y * 1024 + x;
                let gx = raw[y * 1024 + (x + 1).min(1023)] as f64
                    - raw[y * 1024 + x.saturating_sub(1)] as f64;
                let gy = raw[(y + 1).min(1023) * 1024 + x] as f64
                    - raw[y.saturating_sub(1) * 1024 + x] as f64;
                let slope = gx.hypot(gy) * this.scale / (2. * p[11]);
                let r=this.fine_value(i,2,||this.noise2.ridged((x as f64+0.5)*p[11]/p[9],(y as f64+0.5)*p[11]/p[9],p[10] as usize));
                row[x] = (raw[i] as f64 * this.scale
                    + (r - 0.5)
                        * p[16]
                        * amplitude
                        * smooth((slope - 0.015) / 0.3)
                        * this.drainage[i])
                    .max(0.3) as f32;
            }
        });
        self.output = output;
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
            let i = (self.output.len() as f64 * 0.01) as usize;
            let p1 = nth_smallest(&self.output, i);
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

#[cfg(test)]
mod checkpoint_tests {
    use super::*;
    fn configuration() -> (Vec<f32>, Vec<f32>, Vec<u32>) {
        let plan=crate::GenerationNoisePlan::erosion("resume",2400.,"hills",0.3,2400.,0.5).unwrap();
        let mut p=plan.parameters; p[2]=64.;p[4]=2400.*1.44/64.;p[13]=1.;
        let mut s=p[24..32].to_vec();s[0]=88.;s[1]=2400./64.;s[2]=-12.*s[1];s[3]=1.;
        (p,s,vec![0,1,1,1,1,1,1,1,1,0,0])
    }
    fn pipeline(p:&[f32],s:&[f32],f:&[u32])->TerrainPipeline {
        let mut pipeline=TerrainPipeline::new("resume",p,s,f).unwrap();
        let coarse=vec![0.;64*64*4];
        let fine:Vec<f32>=(0..1024*1024*4).map(|i|if i%4==2 {(i as f32*0.0001).sin().abs()}else{0.}).collect();
        pipeline.set_noise(&coarse,&fine).unwrap();pipeline
    }
    #[test]
    fn changed_late_controls_resume_to_the_exact_fresh_result() {
        let(p,s,f)=configuration();let mut retained=pipeline(&p,&s,&f);
        for stage in 0..8 {retained.advance(stage).unwrap();retained.checkpoint(stage as usize).unwrap();}
        let mut changed=p.clone();changed[16]*=2.;
        retained.restore(2,&changed,&s,&f).unwrap();
        for stage in 3..8 {retained.advance(stage).unwrap();}
        let mut fresh=pipeline(&changed,&s,&f);for stage in 0..8 {fresh.advance(stage).unwrap();}
        assert_eq!(retained.height(),fresh.height());
    }
    #[test]
    fn every_checkpoint_restores_internal_fields_without_resampling() {
        let(p,s,f)=configuration();let mut retained=pipeline(&p,&s,&f);
        for stage in 0..8 {retained.advance(stage).unwrap();retained.checkpoint(stage as usize).unwrap();}
        let expected=retained.height();
        for boundary in (0..7).rev() {
            retained.restore(boundary,&p,&s,&f).unwrap();
            for stage in boundary as u32+1..8 {retained.advance(stage).unwrap();}
            assert_eq!(retained.height(),expected,"checkpoint {boundary}");
        }
    }
    #[test]
    fn coast_deforms_the_initial_field_and_can_be_replayed_from_its_input() {
        let(p,s,f)=configuration();let mut retained=pipeline(&p,&s,&f);
        retained.advance(0).unwrap();retained.checkpoint(0).unwrap();
        let initial=retained.height();retained.cut_coast(255,"island").unwrap();retained.checkpoint(1).unwrap();
        let cut=retained.height();assert!(cut.iter().any(|&h|h<0.));assert_ne!(initial,cut);
        retained.restore(0,&p,&s,&f).unwrap();retained.cut_coast(255,"island").unwrap();assert_eq!(retained.height(),cut);
        assert_eq!(retained.checkpoint_height(0).unwrap(),initial);
        let mut changed=p.clone();changed[2]=128.;assert!(retained.restore(0,&changed,&s,&f).is_err());
    }
}
