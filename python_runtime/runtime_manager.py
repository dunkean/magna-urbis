"""Manage optional, isolated Python environments for Magna Urbis.

Run with: uv run --no-project --python 3.12 --script runtime_manager.py --help
All JSON output is intended for both humans and the desktop application's IPC.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EARTH_REVISION = "919550498b3fd7c9d4c53e575f6a2d5475f9be2d"
DIFFUSION_REVISION = "e8dcb4b1a834ab2f6b1a6f5256ed7c9f2f3e8230"
CUDA_INDEX = "https://download.pytorch.org/whl/cu128"
PROBE = r'''import json, sys
try:
 import torch
 result = {"python": sys.version.split()[0], "torch": torch.__version__, "torch_cuda": torch.version.cuda, "cuda_available": torch.cuda.is_available()}
 if result["cuda_available"]:
  result["device"] = torch.cuda.get_device_name(0)
  result["cuda_tensor_check"] = bool((torch.ones(1, device="cuda") + 1).cpu().item() == 2)
 print(json.dumps(result))
except Exception as exc:
 print(json.dumps({"error": str(exc), "python": sys.version.split()[0]}))
 sys.exit(1)
'''


def user_dirs():
    home = Path.home()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local") / "MagnaUrbis"
        return base, base / "cache"
    return (Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share") / "magna-urbis",
            Path(os.environ.get("XDG_CACHE_HOME") or home / ".cache") / "magna-urbis")


def environment(args):
    env = os.environ.copy()
    # uv's Python installations and download cache are user-owned, never global.
    env["UV_CACHE_DIR"] = str(args.cache_dir / "uv")
    env["UV_PYTHON_INSTALL_DIR"] = str(args.data_dir / "python")
    env["HF_HOME"] = str(args.cache_dir / "huggingface")
    env.setdefault("TERRAIN_RUNTIME_ROOT", str(args.data_dir / "terrain-runtime"))
    env.setdefault("TERRAIN_OUTPUT_ROOT", str(args.data_dir / "terrain-output"))
    return env


def interpreter(args, component):
    return args.data_dir / "venvs" / component / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def selected_interpreter(args, component):
    variable = "MAGNA_ILLUSTRATION_PYTHON" if component == "illustration" else "MAGNA_NEURAL_PYTHON"
    override = os.environ.get(variable)
    return Path(override).expanduser() if override else interpreter(args, component)


def emit(data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def execute(command, env):
    # Downloads and logs belong on stderr; stdout stays machine-readable JSON.
    return subprocess.run([str(part) for part in command], env=env, stdout=sys.stderr, check=False).returncode



def acquire_source(args):
    """Download pinned source archives into user storage, never unpack weights."""
    target = args.data_dir / "sources" / ("neural-earth-" + EARTH_REVISION)
    marker = target / ".magna-source-revision"
    if marker.is_file() and marker.read_text(encoding="utf-8") == DIFFUSION_REVISION:
        return target
    if target.exists():
        raise ValueError(f"Incomplete source directory exists; remove it before retrying: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="earth-source-", dir=target.parent) as temp:
        staging = Path(temp) / "source"
        staging.mkdir()
        def extract(url, destination, prefixes):
            archive = Path(temp) / "source.zip"
            with urllib.request.urlopen(url, timeout=60) as response, archive.open("wb") as out:
                total = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > 300 * 1024 * 1024:
                        raise ValueError("Source archive exceeds 300 MiB")
                    out.write(block)
            with zipfile.ZipFile(archive) as z:
                extracted = 0
                for item in z.infolist():
                    parts = Path(item.filename.replace("\\", "/")).parts
                    if len(parts) < 2 or any(x in ("..", ".") for x in parts):
                        continue
                    rel = Path(*parts[1:])
                    if rel.as_posix().startswith("distill/weights/"):
                        continue
                    if item.is_dir() or not any(rel.as_posix() == x or rel.as_posix().startswith(x + "/") for x in prefixes):
                        continue
                    if (item.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError("Source archive contains a symlink")
                    extracted += item.file_size
                    if extracted > 300 * 1024 * 1024:
                        raise ValueError("Extracted source exceeds 300 MiB")
                    dest = destination / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(item) as src, dest.open("wb") as out:
                        shutil.copyfileobj(src, out)
            archive.unlink()
        extract(f"https://github.com/dunkean/neural-earth/archive/{EARTH_REVISION}.zip", staging,
                ("backend", "distill", "requirements-lock.txt", "THIRD_PARTY_NOTICES.md", "LICENSE", "COPYING", "data"))
        extract(f"https://github.com/xandergos/terrain-diffusion/archive/{DIFFUSION_REVISION}.zip",
                staging / "terrain-diffusion", ("terrain_diffusion", "LICENSE", "data"))
        for path in ("backend/terrain_app.py", "distill/inference.py", "requirements-lock.txt",
                     "terrain-diffusion/terrain_diffusion/inference/world_pipeline.py"):
            if not (staging / path).is_file():
                raise ValueError(f"Source archive missing {path}")
        (staging / ".magna-source-revision").write_text(DIFFUSION_REVISION, encoding="utf-8")
        staging.rename(target)
    return target

def setup(args):
    req = args.illustration_requirements if args.component == "illustration" else args.terrain_requirements
    if args.component == "terrain" and req is None:
        earth = os.environ.get("MAGNA_NEURAL_EARTH")
        req = (Path(earth).expanduser() if earth else acquire_source(args)) / "requirements-lock.txt"
    if not req.is_file():
        raise ValueError(f"Requirements file not found: {req}")
    venv = interpreter(args, args.component).parent.parent
    env = environment(args)
    venv.parent.mkdir(parents=True, exist_ok=True)
    cmd = [args.uv, "venv", "--allow-existing", "--python", args.python, str(venv)]
    if not args.python_override:
        cmd.insert(2, "--managed-python")
    code = execute(cmd, env)
    if code:
        raise RuntimeError(f"uv venv failed (exit {code})")
    # uv routes only PyTorch ecosystem packages to the CUDA index; other
    # dependencies come from PyPI, avoiding cross-index package selection.
    code = execute([args.uv, "pip", "install", "--python", interpreter(args, args.component),
                    "--torch-backend", "cu128", "-r", req], env)
    if code:
        raise RuntimeError(f"Dependency installation failed (exit {code})")
    emit({"ok": True, "component": args.component, "python": str(interpreter(args, args.component)),
          "profile": "cuda-12.8", "model_weights_installed": False})


def probe(args, component):
    python = selected_interpreter(args, component)
    if not python.is_file():
        return {"component": component, "installed": False, "python": str(python),
                "cuda_ready": False, "reason": "Environment not installed. Run setup explicitly."}
    try:
        result = subprocess.run([str(python), "-c", PROBE], env=environment(args), capture_output=True, text=True, check=False, timeout=30)
        try:
            details = json.loads(result.stdout)
        except ValueError:
            details = {"error": result.stderr.strip() or "Invalid probe output"}
        ready = result.returncode == 0 and details.get("cuda_available", False) and details.get("cuda_tensor_check", False)
    except subprocess.TimeoutExpired:
        details = {"error": "CUDA probe timed out after 30 seconds"}
        ready = False
    return {"component": component, "installed": True, "python": str(python), "probe": details,
            "cuda_ready": ready, "reason": None if ready else "Local models require a working CUDA device and dependencies; model weights are checked separately."}


def parser():
    data, cache = user_dirs()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--uv", default=os.environ.get("MAGNA_UV", "uv"), help="Path to uv executable")
    p.add_argument("--data-dir", type=Path, default=Path(os.environ.get("MAGNA_RUNTIME_DATA", data)))
    p.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("MAGNA_RUNTIME_CACHE", cache)))
    p.add_argument("--python", dest="python_override", help="Existing Python 3.12 interpreter for new virtual environments")
    p.add_argument("--illustration-requirements", type=Path, default=ROOT / "illustration" / "requirements.txt")
    p.add_argument("--terrain-requirements", type=Path, default=None)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("acquire-source", help="Download the pinned optional Neural Earth sources")
    for name in ("setup", "probe", "run"):
        child = sub.add_parser(name)
        child.add_argument("component", choices=("illustration", "terrain"))
        if name == "run":
            child.add_argument("arguments", nargs=argparse.REMAINDER, help="Python arguments after --")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    args.data_dir = args.data_dir.expanduser().resolve()
    args.cache_dir = args.cache_dir.expanduser().resolve()
    args.python = args.python_override or "3.12"
    try:
        if args.command == "acquire-source":
            emit({"ok": True, "source": str(acquire_source(args)), "revision": EARTH_REVISION, "diffusion_revision": DIFFUSION_REVISION})
        elif args.command == "setup":
            setup(args)
        elif args.command == "status":
            emit({"data_dir": str(args.data_dir), "cache_dir": str(args.cache_dir), "profile": "cuda-12.8",
                  "components": [probe(args, name) for name in ("illustration", "terrain")]})
        elif args.command == "probe":
            result = probe(args, args.component)
            emit(result)
            return 0 if result["cuda_ready"] else 1
        else:
            python = selected_interpreter(args, args.component)
            if not python.is_file():
                raise ValueError(f"Environment not installed: {python}")
            arguments = args.arguments
            if arguments and arguments[0] == "--":
                arguments = arguments[1:]
            if not arguments:
                raise ValueError("Provide Python arguments after --")
            return subprocess.run([str(python), *arguments], env=environment(args), check=False).returncode
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as exc:
        emit({"ok": False, "error": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

