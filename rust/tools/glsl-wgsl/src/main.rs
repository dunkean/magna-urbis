//! Translates GLSL 450 shaders to WGSL with naga, validates the result and re-parses the emitted WGSL.
//!
//! Usage: `glsl-wgsl <stage> <input.glsl> <output.wgsl> [<stage> <input> <output> ...]`, stage `vert` or `frag`.
//! Every job is translated even if an earlier one failed; the exit code reports any failure.
use naga::back::wgsl;
use naga::front::glsl;
use naga::valid::{Capabilities, ValidationFlags, Validator};
use std::process::ExitCode;

/// WebGPU core: pack2x16float/unpack2x16float are core WGSL builtins (naga files them under this capability).
const CAPABILITIES: Capabilities = Capabilities::SHADER_FLOAT16_IN_FLOAT32;

fn translate(stage: &str, input: &str, output: &str) -> Result<(), String> {
    let source = std::fs::read_to_string(input).map_err(|e| format!("{input}: {e}"))?;
    let stage = match stage {
        "vert" => naga::ShaderStage::Vertex,
        "frag" => naga::ShaderStage::Fragment,
        other => return Err(format!("unknown stage {other}")),
    };
    let mut frontend = glsl::Frontend::default();
    let module = frontend
        .parse(&glsl::Options::from(stage), &source)
        .map_err(|e| format!("{input}: GLSL parse\n{}", e.emit_to_string(&source)))?;
    let info = Validator::new(ValidationFlags::all(), CAPABILITIES)
        .validate(&module)
        .map_err(|e| format!("{input}: validation\n{}", e.emit_to_string(&source)))?;
    let text = wgsl::write_string(&module, &info, wgsl::WriterFlags::empty())
        .map_err(|e| format!("{input}: WGSL output: {e}"))?;
    // Round trip: the emitted WGSL must parse and validate on its own.
    let reparsed = naga::front::wgsl::parse_str(&text)
        .map_err(|e| format!("{output}: WGSL re-parse\n{}", e.emit_to_string(&text)))?;
    Validator::new(ValidationFlags::all(), CAPABILITIES)
        .validate(&reparsed)
        .map_err(|e| format!("{output}: WGSL re-validation\n{}", e.emit_to_string(&text)))?;
    std::fs::write(output, text).map_err(|e| format!("{output}: {e}"))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || !args.len().is_multiple_of(3) {
        eprintln!("usage: glsl-wgsl <vert|frag> <input.glsl> <output.wgsl> [...]");
        return ExitCode::from(2);
    }
    let mut failed = false;
    for job in args.chunks(3) {
        if let Err(error) = translate(&job[0], &job[1], &job[2]) {
            eprintln!("{error}");
            failed = true;
        }
    }
    if failed { ExitCode::FAILURE } else { ExitCode::SUCCESS }
}
