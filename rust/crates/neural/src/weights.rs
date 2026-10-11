//! Prepared weight bundles: one safetensors file per network.
//!
//! Magnitude-preserving convolutions are stored with their normalization and
//! learned gain already applied, so the runtime only runs ordinary convolutions.
//! Convolution weights are FP16; scalars, Fourier buffers and FP32 heads stay FP32.
use half::f16;
use std::collections::BTreeMap;

pub enum Values {
    F16(Vec<f16>),
    F32(Vec<f32>),
}

pub struct Entry {
    pub shape: Vec<usize>,
    pub values: Values,
}

impl Entry {
    pub fn to_f32(&self) -> Vec<f32> {
        match &self.values {
            Values::F16(v) => v.iter().map(|x| x.to_f32()).collect(),
            Values::F32(v) => v.clone(),
        }
    }
}

#[derive(Default)]
pub struct Bundle {
    pub tensors: BTreeMap<String, Entry>,
    pub metadata: BTreeMap<String, String>,
}

impl Bundle {
    pub fn get(&self, name: &str) -> Result<&Entry, String> {
        self.tensors
            .get(name)
            .ok_or_else(|| format!("Poids manquant : {name}"))
    }

    pub fn has(&self, name: &str) -> bool {
        self.tensors.contains_key(name)
    }

    pub fn scalar(&self, name: &str) -> Result<f32, String> {
        let values = self.get(name)?.to_f32();
        values
            .first()
            .copied()
            .ok_or_else(|| format!("Scalaire vide : {name}"))
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let header_len = u64::from_le_bytes(
            bytes
                .get(..8)
                .ok_or("Fichier de poids tronqué.")?
                .try_into()
                .unwrap(),
        ) as usize;
        let header = bytes
            .get(8..8 + header_len)
            .ok_or("En-tête safetensors tronqué.")?;
        let header: serde_json::Value =
            serde_json::from_slice(header).map_err(|e| format!("En-tête safetensors : {e}"))?;
        let data = &bytes[8 + header_len..];
        let mut bundle = Bundle::default();
        for (name, info) in header.as_object().ok_or("En-tête safetensors invalide.")? {
            if name == "__metadata__" {
                for (key, value) in info.as_object().into_iter().flatten() {
                    bundle
                        .metadata
                        .insert(key.clone(), value.as_str().unwrap_or_default().to_owned());
                }
                continue;
            }
            let shape: Vec<usize> = info["shape"]
                .as_array()
                .ok_or("Forme absente.")?
                .iter()
                .map(|v| v.as_u64().unwrap_or(0) as usize)
                .collect();
            let offsets = info["data_offsets"]
                .as_array()
                .ok_or("Décalages absents.")?;
            let (start, end) = (
                offsets[0].as_u64().unwrap_or(0) as usize,
                offsets[1].as_u64().unwrap_or(0) as usize,
            );
            let raw = data.get(start..end).ok_or("Données de poids tronquées.")?;
            let count: usize = shape.iter().product();
            let values = match info["dtype"].as_str() {
                Some("F16") if raw.len() == count * 2 => Values::F16(
                    raw.as_chunks::<2>()
                        .0
                        .iter()
                        .map(|&b| f16::from_le_bytes(b))
                        .collect(),
                ),
                Some("F32") if raw.len() == count * 4 => Values::F32(
                    raw.as_chunks::<4>()
                        .0
                        .iter()
                        .map(|&b| f32::from_le_bytes(b))
                        .collect(),
                ),
                Some("BF16") if raw.len() == count * 2 => Values::F32(
                    raw.as_chunks::<2>()
                        .0
                        .iter()
                        .map(|&b| f32::from_bits((u16::from_le_bytes(b) as u32) << 16))
                        .collect(),
                ),
                other => return Err(format!("{name} : type {other:?} non pris en charge.")),
            };
            bundle.tensors.insert(name.clone(), Entry { shape, values });
        }
        Ok(bundle)
    }

    pub fn serialize(&self) -> Vec<u8> {
        let mut header = serde_json::Map::new();
        let mut offset = 0usize;
        let mut payload = Vec::new();
        if !self.metadata.is_empty() {
            header.insert(
                "__metadata__".into(),
                serde_json::Value::Object(
                    self.metadata
                        .iter()
                        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
                        .collect(),
                ),
            );
        }
        for (name, entry) in &self.tensors {
            let (dtype, bytes): (&str, Vec<u8>) = match &entry.values {
                Values::F16(v) => ("F16", v.iter().flat_map(|x| x.to_le_bytes()).collect()),
                Values::F32(v) => ("F32", v.iter().flat_map(|x| x.to_le_bytes()).collect()),
            };
            header.insert(
                name.clone(),
                serde_json::json!({
                    "dtype": dtype, "shape": entry.shape,
                    "data_offsets": [offset, offset + bytes.len()],
                }),
            );
            offset += bytes.len();
            payload.extend(bytes);
        }
        let mut header = serde_json::to_vec(&serde_json::Value::Object(header)).unwrap();
        while !header.len().is_multiple_of(8) {
            header.push(b' ');
        }
        let mut out = (header.len() as u64).to_le_bytes().to_vec();
        out.extend(header);
        out.extend(payload);
        out
    }
}
