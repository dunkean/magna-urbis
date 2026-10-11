//! Magnitude-preserving EDM2 UNet of Terrain Diffusion (coarse and base networks).
//!
//! Inference only, with prepared weights. Activations are FP16 between layers;
//! normalizations, embeddings and attention scores are computed in FP32.
use crate::gpu::{Gpu, conv, f16, f32 as to_f32, linear};
use crate::weights::Bundle;
use burn::tensor::{Tensor, activation};

pub struct EdmConfig {
    pub image_size: usize,
    pub channels: Vec<usize>,
    pub layers: usize,
    pub midblock_attention: bool,
    pub concat_balance: f32,
    /// Conditional inputs: `(fourier channels, weight)`; zero channels means a tensor input.
    pub conditional: Vec<(usize, f32)>,
}

impl EdmConfig {
    pub fn coarse() -> Self {
        Self {
            image_size: 16,
            channels: vec![128],
            layers: 2,
            midblock_attention: false,
            concat_balance: 0.5,
            conditional: vec![(64, 0.2); 5],
        }
    }
    pub fn base() -> Self {
        Self {
            image_size: 512,
            channels: vec![192, 384, 576, 768],
            layers: 3,
            midblock_attention: true,
            concat_balance: 0.5,
            conditional: vec![(0, 1.0)],
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Resample {
    Keep,
    Down,
    Up,
}

struct Block {
    encoder: bool,
    resample: Resample,
    skip: Option<Tensor<4>>,
    res0: Tensor<4>,
    res1: Tensor<4>,
    emb: Tensor<2>,
    heads: usize,
    qkv: Option<Tensor<4>>,
    proj: Option<Tensor<4>>,
}

// A handful of layers per network: boxing blocks only adds indirections.
#[allow(clippy::large_enum_variant)]
enum Layer {
    Conv(Tensor<4>),
    Block(Block),
}

pub struct Edm {
    gpu: Gpu,
    noise_freqs: Vec<f32>,
    noise_linear: Tensor<2>,
    conditional: Vec<Conditional>,
    weights: Vec<f32>,
    encoder: Vec<Layer>,
    decoder: Vec<(bool, Block)>,
    out_conv: Tensor<4>,
    concat_balance: f32,
}

struct Conditional {
    fourier: Option<(Vec<f32>, Vec<f32>)>,
    linear: Tensor<2>,
}

fn mp_silu(x: Tensor<4>) -> Tensor<4> {
    activation::silu(x).mul_scalar(1.0 / 0.596)
}

/// `x / (1e-4 + rms over channels)` with FP32 statistics.
fn pixel_normalize(x: Tensor<4>) -> Tensor<4> {
    let norm = to_f32(x.clone())
        .square()
        .mean_dim(1)
        .sqrt()
        .add_scalar(1e-4)
        .recip();
    x.mul(f16(norm))
}

fn down(x: Tensor<4>) -> Tensor<4> {
    let [n, c, h, w] = x.dims();
    x.reshape([n, c, h / 2, 2, w / 2, 2])
        .slice([0..n, 0..c, 0..h / 2, 0..1, 0..w / 2, 0..1])
        .reshape([n, c, h / 2, w / 2])
}

pub fn up(x: Tensor<4>, factor: usize) -> Tensor<4> {
    let [n, c, h, w] = x.dims();
    x.reshape([n, c, h, 1, w, 1])
        .expand([n, c, h, factor, w, factor])
        .reshape([n, c, h * factor, w * factor])
}

fn mp_sum(a: Tensor<4>, b: Tensor<4>, t: f32) -> Tensor<4> {
    let norm = ((1.0 - t) * (1.0 - t) + t * t).sqrt();
    a.mul_scalar((1.0 - t) / norm).add(b.mul_scalar(t / norm))
}

impl Edm {
    pub fn load(gpu: &Gpu, bundle: &Bundle, config: &EdmConfig) -> Result<Self, String> {
        let w4 = |name: &str| gpu.tensor4(bundle.get(name)?);
        let w2 = |name: &str| gpu.matrix(bundle.get(name)?);
        let block = |name: &str,
                     encoder: bool,
                     resample: Resample,
                     attention: bool|
         -> Result<Block, String> {
            let res0 = w4(&format!("{name}.conv_res0.weight"))?;
            let heads = if attention { res0.dims()[0] / 64 } else { 0 };
            let skip_name = format!("{name}.conv_skip.weight");
            Ok(Block {
                encoder,
                resample,
                skip: if bundle.has(&skip_name) {
                    Some(w4(&skip_name)?)
                } else {
                    None
                },
                res0,
                res1: w4(&format!("{name}.conv_res1.weight"))?,
                emb: w2(&format!("{name}.emb_linear.weight"))?,
                heads,
                qkv: if attention {
                    Some(w4(&format!("{name}.attn_qkv.weight"))?)
                } else {
                    None
                },
                proj: if attention {
                    Some(w4(&format!("{name}.attn_proj.weight"))?)
                } else {
                    None
                },
            })
        };
        // Module names follow the upstream ModuleDict, named from the configured image size.
        let res = |level: usize| config.image_size >> level;
        let mut encoder = Vec::new();
        for level in 0..config.channels.len() {
            let r = res(level);
            if level == 0 {
                encoder.push(Layer::Conv(w4(&format!("enc.{r}x{r}_conv.weight"))?));
            } else {
                encoder.push(Layer::Block(block(
                    &format!("enc.{r}x{r}_down"),
                    true,
                    Resample::Down,
                    false,
                )?));
            }
            for i in 0..config.layers {
                encoder.push(Layer::Block(block(
                    &format!("enc.{r}x{r}_block{i}"),
                    true,
                    Resample::Keep,
                    false,
                )?));
            }
        }
        let mut decoder = Vec::new();
        for level in (0..config.channels.len()).rev() {
            let r = res(level);
            if level == config.channels.len() - 1 {
                decoder.push((
                    false,
                    block(
                        &format!("dec.{r}x{r}_in0"),
                        false,
                        Resample::Keep,
                        config.midblock_attention,
                    )?,
                ));
                decoder.push((
                    false,
                    block(&format!("dec.{r}x{r}_in1"), false, Resample::Keep, false)?,
                ));
            } else {
                decoder.push((
                    false,
                    block(&format!("dec.{r}x{r}_up"), false, Resample::Up, false)?,
                ));
            }
            for i in 0..=config.layers {
                decoder.push((
                    true,
                    block(
                        &format!("dec.{r}x{r}_block{i}"),
                        false,
                        Resample::Keep,
                        false,
                    )?,
                ));
            }
        }
        let mut conditional = Vec::new();
        let mut weights = vec![1.0];
        for (i, &(fourier, weight)) in config.conditional.iter().enumerate() {
            conditional.push(if fourier > 0 {
                Conditional {
                    fourier: Some((
                        bundle
                            .get(&format!("conditional_layers.{i}.0.freqs"))?
                            .to_f32(),
                        bundle
                            .get(&format!("conditional_layers.{i}.0.phases"))?
                            .to_f32(),
                    )),
                    linear: w2(&format!("conditional_layers.{i}.1.weight"))?,
                }
            } else {
                Conditional {
                    fourier: None,
                    linear: w2(&format!("conditional_layers.{i}.weight"))?,
                }
            });
            weights.push(weight);
        }
        Ok(Self {
            gpu: gpu.clone(),
            noise_freqs: bundle.get("noise_fourier.freqs")?.to_f32(),
            noise_linear: w2("noise_linear.weight")?,
            conditional,
            weights,
            encoder,
            decoder,
            out_conv: w4("out_conv.weight")?,
            concat_balance: config.concat_balance,
        })
    }

    /// Conditioning embedding `[n, emb]` in FP32. `scalars[i]` are per-sample
    /// Fourier inputs; `tensors` are the flattened tensor inputs, row-major.
    pub fn embedding(
        &self,
        noise_labels: &[f32],
        scalars: &[Vec<f32>],
        tensor: Option<(&[f32], usize)>,
    ) -> Tensor<2> {
        let n = noise_labels.len();
        let half = self.noise_freqs.len();
        let mut positional = Vec::with_capacity(n * half * 2);
        for &t in noise_labels {
            let row: Vec<f32> = self.noise_freqs.iter().map(|&f| t * f).collect();
            positional.extend(row.iter().map(|y| y.sin() * std::f32::consts::SQRT_2));
            positional.extend(row.iter().map(|y| y.cos() * std::f32::consts::SQRT_2));
        }
        let mut embeds = vec![linear(self.gpu.rows(positional, n), &self.noise_linear)];
        let mut scalar_index = 0;
        for layer in &self.conditional {
            embeds.push(match &layer.fourier {
                Some((freqs, phases)) => {
                    let values = &scalars[scalar_index];
                    scalar_index += 1;
                    let mut features = Vec::with_capacity(n * freqs.len());
                    for &x in values {
                        features.extend(
                            freqs
                                .iter()
                                .zip(phases)
                                .map(|(f, p)| (x * f + p).cos() * std::f32::consts::SQRT_2),
                        );
                    }
                    linear(self.gpu.rows(features, n), &layer.linear)
                }
                None => {
                    let (values, _) = tensor.expect("tensor conditioning");
                    activation::silu(linear(self.gpu.rows(values.to_vec(), n), &layer.linear))
                        .mul_scalar(1.0 / 0.596)
                }
            });
        }
        let norm = self.weights.iter().map(|w| w * w).sum::<f32>().sqrt();
        let mut emb = embeds[0].clone().mul_scalar(self.weights[0] / norm);
        for (e, w) in embeds.iter().zip(&self.weights).skip(1) {
            emb = emb.add(e.clone().mul_scalar(*w / norm));
        }
        activation::silu(emb).mul_scalar(1.0 / 0.596)
    }

    fn block(&self, block: &Block, x: Tensor<4>, emb: &Tensor<2>) -> Tensor<4> {
        let mut x = match block.resample {
            Resample::Keep => x,
            Resample::Down => down(x),
            Resample::Up => up(x, 2),
        };
        if block.encoder {
            if let Some(skip) = &block.skip {
                x = conv(x, skip, 0);
            }
            x = pixel_normalize(x);
        }
        let y = conv(mp_silu(x.clone()), &block.res0, 1);
        let c = linear(emb.clone(), &block.emb).add_scalar(1.0);
        let c = c
            .clone()
            .div(c.square().mean_dim(1).add_scalar(1e-8).sqrt());
        let [n, ch] = c.dims();
        let y = mp_silu(y.mul(f16(c.reshape([n, ch, 1, 1]))));
        let y = conv(y, &block.res1, 1);
        if let Some(skip) = block.skip.as_ref().filter(|_| !block.encoder) {
            x = conv(x, skip, 0);
        }
        let mut x = mp_sum(x, y, 0.3);
        if block.heads > 0 {
            let attended = self.attention(block, x.clone());
            x = mp_sum(x, attended, 0.3);
        }
        x.clamp(-256.0, 256.0)
    }

    fn attention(&self, block: &Block, x: Tensor<4>) -> Tensor<4> {
        let [n, c, h, w] = x.dims();
        let heads = block.heads;
        let ch = c / heads;
        let y = to_f32(conv(x, block.qkv.as_ref().unwrap(), 0)).reshape([n, heads, ch, 3, h * w]);
        let norm = y
            .clone()
            .square()
            .sum_dim(2)
            .sqrt()
            .mul_scalar(1.0 / (ch as f32).sqrt())
            .add_scalar(1e-4);
        let y = y.div(norm);
        let part = |i: usize| {
            y.clone()
                .slice([0..n, 0..heads, 0..ch, i..i + 1, 0..h * w])
                .reshape([n, heads, ch, h * w])
        };
        let (q, k, v) = (part(0), part(1), part(2));
        let scores = q
            .swap_dims(2, 3)
            .matmul(k.mul_scalar(1.0 / (ch as f32).sqrt()));
        let weights = activation::softmax(scores, 3);
        let out = v.matmul(weights.swap_dims(2, 3)).reshape([n, c, h, w]);
        conv(f16(out), block.proj.as_ref().unwrap(), 0)
    }

    /// Network output in FP32. `x` is `[n, in, h, w]` (any float type).
    pub fn forward(&self, x: Tensor<4>, emb: &Tensor<2>) -> Tensor<4> {
        let [n, _, h, w] = x.dims();
        let ones = Tensor::<4>::ones([n, 1, h, w], self.gpu.f32_options());
        let mut x = f16(Tensor::cat(vec![to_f32(x), ones], 1));
        let mut skips = Vec::new();
        for layer in &self.encoder {
            x = match layer {
                Layer::Conv(weight) => conv(x, weight, 1),
                Layer::Block(block) => self.block(block, x, emb),
            };
            skips.push(x.clone());
        }
        let t = self.concat_balance;
        for (concat, block) in &self.decoder {
            if *concat {
                let skip = skips.pop().unwrap();
                let (a, b) = (x.dims()[1] as f32, skip.dims()[1] as f32);
                let scale = ((a + b) / ((1.0 - t) * (1.0 - t) + t * t)).sqrt();
                x = Tensor::cat(
                    vec![
                        x.mul_scalar(scale / a.sqrt() * (1.0 - t)),
                        skip.mul_scalar(scale / b.sqrt() * t),
                    ],
                    1,
                );
            }
            x = self.block(block, x, emb);
        }
        to_f32(conv(x, &self.out_conv, 1))
    }
}
