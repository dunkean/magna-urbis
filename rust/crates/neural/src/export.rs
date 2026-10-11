//! Offline preparation of the Terrain Diffusion checkpoints (native only).
//!
//! Reads the original PyTorch zip checkpoints and safetensors directly, without
//! Python, then writes the prepared FP16 bundles loaded by native and browser runtimes.
use crate::weights::{Bundle, Entry, Values};
use half::{bf16, f16};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

/// Named tensors as `(shape, values)`.
type State = BTreeMap<String, (Vec<usize>, Vec<f32>)>;
type Job<'a> = Box<dyn Fn() -> Result<Bundle, String> + 'a>;

#[derive(Clone, Debug)]
enum Val {
    None,
    Bool(bool),
    Int(i64),
    Float,
    Str(String),
    Tuple(Vec<Val>),
    List(Vec<Val>),
    Dict(Vec<(Val, Val)>),
    Global(String),
    Storage(String, String),
    Tensor {
        storage: String,
        dtype: String,
        offset: usize,
        size: Vec<usize>,
        stride: Vec<usize>,
    },
    Mark,
    Other,
}

fn int(v: &Val) -> Result<i64, String> {
    match v {
        Val::Int(i) => Ok(*i),
        Val::Bool(b) => Ok(*b as i64),
        _ => Err(format!("Entier attendu, trouvé {v:?}")),
    }
}

fn ints(v: &Val) -> Result<Vec<usize>, String> {
    match v {
        Val::Tuple(items) | Val::List(items) => {
            items.iter().map(|x| int(x).map(|i| i as usize)).collect()
        }
        _ => Err("Tuple d’entiers attendu.".into()),
    }
}

/// Minimal unpickler for `torch.save` state dictionaries (protocol 2–4).
fn unpickle(data: &[u8]) -> Result<Val, String> {
    let mut stack: Vec<Val> = Vec::new();
    let mut memo: BTreeMap<u32, Val> = BTreeMap::new();
    let mut pos = 0;
    let take = |pos: &mut usize, n: usize| -> Result<&[u8], String> {
        let slice = data.get(*pos..*pos + n).ok_or("Pickle tronqué.")?;
        *pos += n;
        Ok(slice)
    };
    let pop_mark = |stack: &mut Vec<Val>| -> Result<Vec<Val>, String> {
        let at = stack
            .iter()
            .rposition(|v| matches!(v, Val::Mark))
            .ok_or("Marque pickle absente.")?;
        let items = stack.split_off(at + 1);
        stack.pop();
        Ok(items)
    };
    loop {
        let op = *data.get(pos).ok_or("Pickle sans fin.")?;
        pos += 1;
        match op {
            0x80 => pos += 1,
            0x95 => pos += 8,
            b'.' => return stack.pop().ok_or_else(|| "Pickle vide.".into()),
            b'}' => stack.push(Val::Dict(Vec::new())),
            b']' => stack.push(Val::List(Vec::new())),
            b')' => stack.push(Val::Tuple(Vec::new())),
            b'(' => stack.push(Val::Mark),
            b'N' => stack.push(Val::None),
            0x88 => stack.push(Val::Bool(true)),
            0x89 => stack.push(Val::Bool(false)),
            b'K' => stack.push(Val::Int(take(&mut pos, 1)?[0] as i64)),
            b'M' => {
                let b = take(&mut pos, 2)?;
                stack.push(Val::Int(u16::from_le_bytes([b[0], b[1]]) as i64));
            }
            b'J' => {
                let b = take(&mut pos, 4)?;
                stack.push(Val::Int(i32::from_le_bytes(b.try_into().unwrap()) as i64));
            }
            0x8a => {
                let n = take(&mut pos, 1)?[0] as usize;
                let b = take(&mut pos, n)?;
                let mut value: i64 = 0;
                for (i, byte) in b.iter().enumerate().take(8) {
                    value |= (*byte as i64) << (8 * i);
                }
                if n > 0 && n < 8 && b[n - 1] & 0x80 != 0 {
                    value -= 1 << (8 * n);
                }
                stack.push(Val::Int(value));
            }
            b'G' => {
                let b = take(&mut pos, 8)?;
                let _ = b;
                stack.push(Val::Float);
            }
            b'X' | b'T' => {
                let b = take(&mut pos, 4)?;
                let n = u32::from_le_bytes(b.try_into().unwrap()) as usize;
                stack.push(Val::Str(String::from_utf8_lossy(take(&mut pos, n)?).into()));
            }
            0x8c | b'U' => {
                let n = take(&mut pos, 1)?[0] as usize;
                stack.push(Val::Str(String::from_utf8_lossy(take(&mut pos, n)?).into()));
            }
            b'c' => {
                let mut line = || -> Result<String, String> {
                    let end = data[pos..]
                        .iter()
                        .position(|&b| b == b'\n')
                        .ok_or("GLOBAL invalide.")?;
                    let text = String::from_utf8_lossy(&data[pos..pos + end]).into_owned();
                    pos += end + 1;
                    Ok(text)
                };
                let module = line()?;
                let name = line()?;
                stack.push(Val::Global(format!("{module}.{name}")));
            }
            b'q' => {
                let i = take(&mut pos, 1)?[0] as u32;
                memo.insert(i, stack.last().cloned().ok_or("Mémo vide.")?);
            }
            b'r' => {
                let i = u32::from_le_bytes(take(&mut pos, 4)?.try_into().unwrap());
                memo.insert(i, stack.last().cloned().ok_or("Mémo vide.")?);
            }
            0x94 => {
                let i = memo.len() as u32;
                memo.insert(i, stack.last().cloned().ok_or("Mémo vide.")?);
            }
            b'h' => {
                let i = take(&mut pos, 1)?[0] as u32;
                stack.push(memo.get(&i).cloned().ok_or("Mémo absent.")?);
            }
            b'j' => {
                let i = u32::from_le_bytes(take(&mut pos, 4)?.try_into().unwrap());
                stack.push(memo.get(&i).cloned().ok_or("Mémo absent.")?);
            }
            0x85..=0x87 => {
                let n = (op - 0x84) as usize;
                let items =
                    stack.split_off(stack.len().checked_sub(n).ok_or("Pile pickle courte.")?);
                stack.push(Val::Tuple(items));
            }
            b't' => {
                let items = pop_mark(&mut stack)?;
                stack.push(Val::Tuple(items));
            }
            b'Q' => {
                let pid = stack.pop().ok_or("PERSID vide.")?;
                let Val::Tuple(items) = pid else {
                    return Err("Identifiant persistant invalide.".into());
                };
                let (Some(Val::Global(kind)), Some(Val::Str(key))) = (items.get(1), items.get(2))
                else {
                    return Err("Stockage persistant invalide.".into());
                };
                let dtype = kind.rsplit('.').next().unwrap_or_default().to_owned();
                stack.push(Val::Storage(key.clone(), dtype));
            }
            b'R' | 0x81 => {
                let args = stack.pop().ok_or("REDUCE sans arguments.")?;
                let callable = stack.pop().ok_or("REDUCE sans fonction.")?;
                let Val::Tuple(args) = args else {
                    stack.push(Val::Other);
                    continue;
                };
                let value = match &callable {
                    Val::Global(name) if name == "torch._utils._rebuild_tensor_v2" => {
                        let Some(Val::Storage(storage, dtype)) = args.first() else {
                            return Err("Tenseur sans stockage.".into());
                        };
                        Val::Tensor {
                            storage: storage.clone(),
                            dtype: dtype.clone(),
                            offset: int(&args[1])? as usize,
                            size: ints(&args[2])?,
                            stride: ints(&args[3])?,
                        }
                    }
                    Val::Global(name) if name == "collections.OrderedDict" => Val::Dict(Vec::new()),
                    _ => Val::Other,
                };
                stack.push(value);
            }
            b'b' => {
                stack.pop();
            }
            b's' => {
                let value = stack.pop().ok_or("SETITEM vide.")?;
                let key = stack.pop().ok_or("SETITEM vide.")?;
                if let Some(Val::Dict(items)) = stack.last_mut() {
                    items.push((key, value));
                }
            }
            b'u' => {
                let items = pop_mark(&mut stack)?;
                if let Some(Val::Dict(dict)) = stack.last_mut() {
                    for [key, value] in items.as_chunks::<2>().0 {
                        dict.push((key.clone(), value.clone()));
                    }
                }
            }
            b'a' => {
                let value = stack.pop().ok_or("APPEND vide.")?;
                if let Some(Val::List(items)) = stack.last_mut() {
                    items.push(value);
                }
            }
            b'e' => {
                let items = pop_mark(&mut stack)?;
                if let Some(Val::List(list)) = stack.last_mut() {
                    list.extend(items);
                }
            }
            _ => return Err(format!("Opcode pickle non pris en charge : 0x{op:02x}")),
        }
    }
}

/// FP32 state dictionary `key` of a `torch.save` zip checkpoint.
fn read_torch(path: &Path, key: &str) -> Result<State, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("{}: {e}", path.display()))?;
    let names: Vec<String> = archive.file_names().map(str::to_owned).collect();
    let pickle = names
        .iter()
        .find(|n| n.ends_with("/data.pkl"))
        .ok_or("data.pkl absent du checkpoint.")?
        .clone();
    let prefix = pickle.trim_end_matches("data.pkl").to_owned();
    let mut bytes = Vec::new();
    archive
        .by_name(&pickle)
        .map_err(|e| e.to_string())?
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let Val::Dict(root) = unpickle(&bytes)? else {
        return Err("Checkpoint : dictionnaire attendu.".into());
    };
    let state = root
        .into_iter()
        .find(|(k, _)| matches!(k, Val::Str(s) if s == key))
        .map(|(_, v)| v)
        .ok_or_else(|| format!("Clé « {key} » absente du checkpoint."))?;
    let Val::Dict(state) = state else {
        return Err("État du modèle invalide.".into());
    };
    let mut storages: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut result = BTreeMap::new();
    for (name, value) in state {
        let (
            Val::Str(name),
            Val::Tensor {
                storage,
                dtype,
                offset,
                size,
                stride,
            },
        ) = (name, value)
        else {
            continue;
        };
        if dtype != "FloatStorage" {
            return Err(format!("{name} : stockage {dtype} non pris en charge."));
        }
        if !storages.contains_key(&storage) {
            let mut raw = Vec::new();
            archive
                .by_name(&format!("{prefix}data/{storage}"))
                .map_err(|e| e.to_string())?
                .read_to_end(&mut raw)
                .map_err(|e| e.to_string())?;
            storages.insert(storage.clone(), raw);
        }
        let raw = &storages[&storage];
        let count: usize = size.iter().product();
        let mut values = Vec::with_capacity(count);
        let mut index = vec![0usize; size.len()];
        for _ in 0..count {
            let at = offset + index.iter().zip(&stride).map(|(i, s)| i * s).sum::<usize>();
            values.push(f32::from_le_bytes(
                raw[at * 4..at * 4 + 4].try_into().unwrap(),
            ));
            for d in (0..size.len()).rev() {
                index[d] += 1;
                if index[d] < size[d] {
                    break;
                }
                index[d] = 0;
            }
        }
        result.insert(name, (size, values));
    }
    Ok(result)
}

fn read_safetensors(path: &Path) -> Result<State, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Bundle::parse(&bytes)?
        .tensors
        .into_iter()
        .map(|(k, v)| {
            let values = v.to_f32();
            (k, (v.shape, values))
        })
        .collect())
}

fn round_bf16(v: f32) -> f32 {
    bf16::from_f32(v).to_f32()
}

/// Prepares a magnitude-preserving EDM UNet as executed by production in BF16:
/// parameters and buffers rounded to BF16, then `normalize(w) * gain / sqrt(fan_in)`.
fn prepare_edm(state: State, prefix: &str, config: &str) -> Bundle {
    let state: BTreeMap<String, (Vec<usize>, Vec<f32>)> = state
        .into_iter()
        .filter_map(|(k, (s, v))| {
            k.strip_prefix(prefix)
                .map(|k| (k.to_owned(), (s, v.into_iter().map(round_bf16).collect())))
        })
        .collect();
    let mut bundle = Bundle::default();
    bundle.metadata.insert("config".into(), config.into());
    for (name, (shape, values)) in &state {
        if name.starts_with("logvar_") {
            continue;
        }
        if let Some(module) = name.strip_suffix(".weight") {
            let gain = if module == "out_conv" {
                state["out_gain"].1[0]
            } else if let Some(block) = module.strip_suffix(".emb_linear") {
                state[&format!("{block}.emb_gain")].1[0]
            } else {
                1.0
            };
            let fan_in: usize = shape[1..].iter().product();
            let rms = (values.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>()
                / values.len() as f64)
                .sqrt() as f32;
            let scale = gain / (1e-4 + rms) / (fan_in as f32).sqrt();
            let prepared: Vec<f32> = values.iter().map(|&v| round_bf16(v * scale)).collect();
            let values = if shape.len() == 4 {
                Values::F16(prepared.iter().map(|&v| f16::from_f32(v)).collect())
            } else {
                Values::F32(prepared)
            };
            bundle.tensors.insert(
                name.clone(),
                Entry {
                    shape: shape.clone(),
                    values,
                },
            );
        } else if name.ends_with("freqs") || name.ends_with("phases") {
            bundle.tensors.insert(
                name.clone(),
                Entry {
                    shape: shape.clone(),
                    values: Values::F32(values.clone()),
                },
            );
        }
    }
    bundle
}

/// The local convolutional student: convolutions in FP16, FP32 output heads.
fn prepare_student(state: State, config: &str) -> Bundle {
    let mut bundle = Bundle::default();
    bundle.metadata.insert("config".into(), config.into());
    for (name, (shape, values)) in state {
        let head = name.starts_with("head.") || name.starts_with("direct.");
        let values = if shape.len() == 4 && !head {
            Values::F16(
                values
                    .iter()
                    .map(|&v| f16::from_f32(round_bf16(v)))
                    .collect(),
            )
        } else {
            Values::F32(values)
        };
        bundle.tensors.insert(name, Entry { shape, values });
    }
    bundle
}

pub struct Sources<'a> {
    pub coarse: &'a Path,
    pub base: &'a Path,
    pub decoder: &'a Path,
}

/// Writes `coarse.safetensors`, `base.safetensors` and `decoder.safetensors`.
pub fn export(sources: Sources<'_>, out: &Path) -> Result<(), String> {
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let jobs: [(&str, Job); 3] = [
        (
            "coarse",
            Box::new(|| {
                Ok(prepare_edm(
                    read_torch(sources.coarse, "model")?,
                    "solver.net.",
                    "coarse4",
                ))
            }),
        ),
        (
            "base",
            Box::new(|| Ok(prepare_edm(read_safetensors(sources.base)?, "", "base"))),
        ),
        (
            "decoder",
            Box::new(|| {
                Ok(prepare_student(
                    read_torch(sources.decoder, "model")?,
                    "student200k",
                ))
            }),
        ),
    ];
    for (name, job) in jobs {
        let bundle = job()?;
        let path = out.join(format!("{name}.safetensors"));
        std::fs::write(&path, bundle.serialize())
            .map_err(|e| format!("{}: {e}", path.display()))?;
        println!("{} · {} tenseurs", path.display(), bundle.tensors.len());
    }
    Ok(())
}
