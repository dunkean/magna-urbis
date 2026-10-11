//! Distilled one-pass decoder ("student200k"): a small pixel-normalized UNet.
use crate::edm::up;
use crate::gpu::{Gpu, conv_ext, f16, f32 as to_f32};
use crate::weights::Bundle;
use burn::tensor::{Tensor, activation};

struct Conv {
    weight: Tensor<4>,
    bias: Option<Tensor<1>>,
}

struct Block {
    skip: Option<Conv>,
    first: Conv,
    second: Conv,
    dilation: usize,
}

pub struct Student {
    stem: Conv,
    encoders: Vec<Block>,
    down: Vec<Conv>,
    middle: Vec<Block>,
    decoders: Vec<Block>,
    head: Conv,
    direct: Conv,
    eps: f32,
}

/// `x * rsqrt(mean(x²) + eps)` over channels, statistics in FP32.
fn pixel_norm(x: Tensor<4>, eps: f32) -> Tensor<4> {
    let scale = to_f32(x.clone())
        .square()
        .mean_dim(1)
        .add_scalar(eps)
        .sqrt()
        .recip();
    x.mul(f16(scale))
}

impl Student {
    pub fn load(
        gpu: &Gpu,
        bundle: &Bundle,
        depth: usize,
        dilations: &[usize],
    ) -> Result<Self, String> {
        let conv = |name: &str| -> Result<Conv, String> {
            let bias = format!("{name}.bias");
            Ok(Conv {
                weight: gpu.tensor4(bundle.get(&format!("{name}.weight"))?)?,
                bias: if bundle.has(&bias) {
                    Some(gpu.vector(bundle.get(&bias)?))
                } else {
                    None
                },
            })
        };
        let block = |name: &str, dilation: usize| -> Result<Block, String> {
            Ok(Block {
                skip: if bundle.has(&format!("{name}.skip.weight")) {
                    Some(conv(&format!("{name}.skip"))?)
                } else {
                    None
                },
                first: conv(&format!("{name}.layers.1"))?,
                second: conv(&format!("{name}.layers.4"))?,
                dilation,
            })
        };
        Ok(Self {
            stem: conv("stem")?,
            encoders: (0..depth)
                .map(|i| block(&format!("encoders.{i}"), 1))
                .collect::<Result<_, _>>()?,
            down: (0..depth - 1)
                .map(|i| conv(&format!("down.{i}")))
                .collect::<Result<_, _>>()?,
            middle: dilations
                .iter()
                .enumerate()
                .map(|(i, &d)| block(&format!("middle.{i}"), d))
                .collect::<Result<_, _>>()?,
            decoders: (0..depth - 1)
                .map(|i| block(&format!("decoders.{i}"), 1))
                .collect::<Result<_, _>>()?,
            head: conv("head")?,
            direct: conv("direct")?,
            eps: 1e-6,
        })
    }

    fn block(&self, block: &Block, x: Tensor<4>) -> Tensor<4> {
        let d = block.dilation;
        let skip = match &block.skip {
            Some(c) => conv_ext(x.clone(), &c.weight, c.bias.as_ref(), 1, 0, 1),
            None => f16(x.clone()),
        };
        let y = pixel_norm(x, self.eps);
        let y = activation::silu(conv_ext(
            y,
            &block.first.weight,
            block.first.bias.as_ref(),
            1,
            d,
            d,
        ));
        let y = pixel_norm(y, self.eps);
        let y = activation::silu(conv_ext(
            y,
            &block.second.weight,
            block.second.bias.as_ref(),
            1,
            d,
            d,
        ));
        skip.add(y).mul_scalar(std::f32::consts::FRAC_1_SQRT_2)
    }

    /// `[n, 16, h, w]` features to the `[n, 1, h, w]` FP32 normalized residual.
    pub fn forward(&self, input: Tensor<4>) -> Tensor<4> {
        let original = to_f32(input);
        let mut x = conv_ext(
            original.clone(),
            &self.stem.weight,
            self.stem.bias.as_ref(),
            1,
            1,
            1,
        );
        let mut skips = Vec::new();
        for (level, block) in self.encoders.iter().enumerate() {
            x = self.block(block, x);
            if level < self.down.len() {
                skips.push(x.clone());
                let c = &self.down[level];
                x = conv_ext(x, &c.weight, c.bias.as_ref(), 2, 1, 1);
            }
        }
        for block in &self.middle {
            x = self.block(block, x);
        }
        for block in &self.decoders {
            let skip = skips.pop().unwrap();
            x = self.block(block, Tensor::cat(vec![up(x, 2), skip], 1));
        }
        let head = conv_ext(
            to_f32(x),
            &self.head.weight,
            self.head.bias.as_ref(),
            1,
            0,
            1,
        );
        head.add(conv_ext(original, &self.direct.weight, None, 1, 0, 1))
    }
}
