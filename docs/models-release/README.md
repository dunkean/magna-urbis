# Neural model release workflow

The first public **Infinite Generation distillé** release is
[`dunkean/neural-earth-distilled`](https://huggingface.co/dunkean/neural-earth-distilled),
at commit `b1782a3f80f5001de5ac701c1ff37128f128b9d7`, tagged `v0.1.0`. The desktop
catalogue uses that immutable revision by default. All eight inference checkpoints
were anonymously downloaded and verified against the inventory's SHA-256 hashes;
they are distributed under MIT with the original teacher attribution retained.

Run these commands from the repository root with Python 3.11 or newer. Listing, status, preparation and local verification use the standard library. For Hub operations, install `huggingface_hub` into the optional Python runtime. Authentication, if needed, is handled by the standard Hugging Face environment or CLI; do not put tokens in these files or command arguments. Hub cache location follows Hugging Face settings such as `HF_HOME`.

```powershell
python scripts/neural_release.py list
python scripts/neural_release.py status
python scripts/neural_release.py status --weights-dir out/neural-weights --json
python scripts/neural_release.py download-original --stage coarse --stage base --stage decoder --cache-dir out/hf-cache
python scripts/neural_release.py prepare-distilled --output out/neural-release
```

Teacher downloads always use the inventory's full pinned revision. Each requested stage's weights and all four pipeline configurations are fetched into the Hugging Face cache. Published LFS SHA-256 hashes and Git blob hashes are verified. Downloading all three stages requires over 1.1 GB. Use `--local-files-only` to restrict retrieval to an existing cache. Stage choice is repeatable; configs are always included. `--cache-dir` specifies the actual Hub cache directory; omit it for the standard Hugging Face cache. Offline `status --json` returns an `ok` flag, `weightsDir`, and a `models` array with per-file integrity results; its exit code is nonzero if any file is missing or corrupt.

`prepare-distilled` verifies every weight against the existing inventory before copying the eight distilled inference files, configuration, inventory, distilled and teacher licenses, and model card into a new or empty folder. It does not upload.

Download the published release using its immutable commit:

```powershell
python scripts/neural_release.py download-distilled --repo dunkean/neural-earth-distilled --revision b1782a3f80f5001de5ac701c1ff37128f128b9d7 --cache-dir out/hf-cache --output out/neural-weights
$env:MAGNA_NEURAL_WEIGHTS_DIR = (Resolve-Path out/neural-weights).Path
```

Downloads verify each file against the local inventory before use. Pass `--model coarse2` (repeatable) for a subset, or omit it for all distilled files. An existing valid file is reused; a corrupt file is replaced only after a verified replacement has been copied. `--local-files-only` works with cached files. The runtime needs the relevant distilled files for the selected models; the finite residual path needs `coarse2`, `residual8k` and the selected decoder. This environment variable affects the Python service, not the browser profile.

Publishing is a separate, explicit operation to an existing repository and branch, using the current Hugging Face credentials:

```powershell
python scripts/neural_release.py publish --repo OWNER/REPOSITORY --revision BRANCH --directory out/neural-release
```

The command verifies weights, inventory, configs and both licenses and rejects extra files before upload. `README.md` may be edited for the actual release. No repository is created and no publication happens during preparation. After publishing, record the returned commit and use that full commit SHA for downloads. See [the model card](MODEL_CARD.md) for the finite residual and continuous-world distinction.
