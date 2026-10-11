//! Small helpers over Burn tensors: uploads, FP16/FP32 casts and convolutions.
use crate::weights::{Entry, Values};
use burn::tensor::{
    DType, Device, Tensor, TensorCreationOptions, TensorData, module::conv2d, ops::ConvOptions,
};

#[derive(Clone)]
pub struct Gpu {
    pub device: Device,
}

impl Gpu {
    pub fn new(device: Device) -> Self {
        Self { device }
    }

    pub fn f32_options(&self) -> TensorCreationOptions {
        TensorCreationOptions::new(self.device.clone()).with_dtype(DType::F32)
    }

    pub fn f16_options(&self) -> TensorCreationOptions {
        TensorCreationOptions::new(self.device.clone()).with_dtype(DType::F16)
    }

    /// Convolution weight as stored: FP16, or FP32 for heads.
    pub fn tensor4(&self, entry: &Entry) -> Result<Tensor<4>, String> {
        let shape: [usize; 4] = entry
            .shape
            .clone()
            .try_into()
            .map_err(|_| "Poids 4D attendu.")?;
        Ok(match &entry.values {
            Values::F16(v) => {
                Tensor::from_data(TensorData::new(v.clone(), shape), self.f16_options())
            }
            Values::F32(v) => {
                Tensor::from_data(TensorData::new(v.clone(), shape), self.f32_options())
            }
        })
    }

    /// `[out, in]` FP32 matrix (MP linear layers).
    pub fn matrix(&self, entry: &Entry) -> Result<Tensor<2>, String> {
        let shape: [usize; 2] = entry
            .shape
            .clone()
            .try_into()
            .map_err(|_| "Poids 2D attendu.")?;
        Ok(Tensor::from_data(
            TensorData::new(entry.to_f32(), shape),
            self.f32_options(),
        ))
    }

    pub fn vector(&self, entry: &Entry) -> Tensor<1> {
        let n = entry.to_f32().len();
        Tensor::from_data(TensorData::new(entry.to_f32(), [n]), self.f32_options())
    }

    pub fn rows(&self, values: Vec<f32>, n: usize) -> Tensor<2> {
        let width = values.len() / n.max(1);
        Tensor::from_data(TensorData::new(values, [n, width]), self.f32_options())
    }

    pub fn image(&self, values: Vec<f32>, shape: [usize; 4]) -> Tensor<4> {
        Tensor::from_data(TensorData::new(values, shape), self.f32_options())
    }
}

pub fn f16<const D: usize>(x: Tensor<D>) -> Tensor<D> {
    if x.dtype() == DType::F16 {
        x
    } else {
        x.cast(DType::F16)
    }
}

pub fn f32<const D: usize>(x: Tensor<D>) -> Tensor<D> {
    if x.dtype() == DType::F32 {
        x
    } else {
        x.cast(DType::F32)
    }
}

/// FP16 convolution with symmetric padding.
pub fn conv(x: Tensor<4>, weight: &Tensor<4>, padding: usize) -> Tensor<4> {
    conv2d(
        f16(x),
        weight.clone(),
        None,
        ConvOptions::new([1, 1], [padding, padding], [1, 1], 1),
    )
}

/// General convolution in the weight's precision, with optional FP32 bias.
///
/// The bias is added separately: cubecl 0.11 selects a much slower kernel for
/// biased convolutions from 128 output channels (≈2 instead of ≈20 TFLOPS).
pub fn conv_ext(
    x: Tensor<4>,
    weight: &Tensor<4>,
    bias: Option<&Tensor<1>>,
    stride: usize,
    padding: usize,
    dilation: usize,
) -> Tensor<4> {
    let half = weight.dtype() == DType::F16;
    let x = if half { f16(x) } else { f32(x) };
    let y = conv2d(
        x,
        weight.clone(),
        None,
        ConvOptions::new(
            [stride, stride],
            [padding, padding],
            [dilation, dilation],
            1,
        ),
    );
    match bias {
        Some(b) => {
            let c = b.dims()[0];
            let b = if half { f16(b.clone()) } else { b.clone() };
            y.add(b.reshape([1, c, 1, 1]))
        }
        None => y,
    }
}

/// `x @ wᵀ` in FP32 for `[n, in]` inputs and `[out, in]` weights.
pub fn linear(x: Tensor<2>, weight: &Tensor<2>) -> Tensor<2> {
    f32(x).matmul(weight.clone().transpose())
}

pub async fn read(x: Tensor<4>) -> Result<Vec<f32>, String> {
    f32(x)
        .into_data_async()
        .await
        .map_err(|e| format!("Lecture GPU : {e:?}"))?
        .try_into_vec_as::<f32>()
        .map_err(|e| format!("Lecture GPU : {e:?}"))
}
