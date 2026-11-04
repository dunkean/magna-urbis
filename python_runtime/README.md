# Optional Python runtimes

The desktop's procedural features do not require Python. These environments are
installed only on request, in user data; model weights are a separate download.
Local illustration and neural terrain currently require a working NVIDIA CUDA
GPU. A successful CPU-only PyTorch import does not mean those models can run.

With `uv` installed or bundled, invoke the standard-library manager with:

```sh
uv run --no-project --python 3.12 --script python_runtime/runtime_manager.py status
uv run --no-project --python 3.12 --script python_runtime/runtime_manager.py setup illustration
uv run --no-project --python 3.12 --script python_runtime/runtime_manager.py setup terrain
uv run --no-project --python 3.12 --script python_runtime/runtime_manager.py probe terrain
uv run --no-project --python 3.12 --script python_runtime/runtime_manager.py run illustration -- -m illustration
```

The initial `uv run` can install managed Python; do not invoke it automatically at
startup. Use `--offline` on `uv run` when no network access is permitted. The
`setup` commands can download several gigabytes, use PyTorch 2.11 CUDA 12.8
wheels, and do not download model weights. Terrain setup also downloads pinned Neural Earth and terrain-diffusion source archives
into the data directory; it installs the upstream requirements lock, which includes
additional packages beyond inference. External geographic rasters are not included in the upstream source archives.
Set `MAGNA_NEURAL_EARTH` to use an existing source tree instead of downloading one.
The service must receive `MAGNA_NEURAL_EARTH`
pointing to the resulting `sources/neural-earth-<revision>` directory. Source
acquisition is also available separately as `acquire-source`.

Global options go before the command: `--uv` supplies the executable used by
setup, `--data-dir` and `--cache-dir` relocate user-owned files, `--python`
selects an existing Python 3.12 interpreter when creating an environment, and
`--terrain-requirements` / `--illustration-requirements` override lock paths.
`MAGNA_UV`, `MAGNA_RUNTIME_DATA`, and `MAGNA_RUNTIME_CACHE` also set defaults.
Status reports environment and CUDA detection; it does not validate model
weights or every dependency. `run` forwards arguments and exit status to the
selected environment's Python, with Hugging Face and uv caches kept under the
configured cache directory. Output from status, setup, and probe is JSON; setup
progress is on stderr. Run commands use the child process's normal streams.
