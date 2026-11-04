#!/usr/bin/env python3
"""Prepare and retrieve the pinned Neural Earth inference artifacts."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'rust/models/neural-earth'
INVENTORY = json.loads((ASSETS / 'model-inventory.json').read_text(encoding='utf-8'))
DISTILLED = tuple(k for k in INVENTORY['models'] if k != 'coarse_original')
CONFIGS = ('coarse-config.json', 'pipeline-config.json')
ORIGINAL = {
    'coarse': ('coarse_model/diffusion_pytorch_model.safetensors', 11200936, 'f88cdc26c70a2c73ee4c91088b8cec3f45202fc452682ac759554b099c5c2f33'),
    'base': ('base_model/diffusion_pytorch_model.safetensors', 1014772076, '351d1b1a77cf32e15adc4f72ed5fd26d317340598329d35f5dce2ff6dbcce735'),
    'decoder': ('decoder_model/diffusion_pytorch_model.safetensors', 111709108, 'b6c7fa99f836ad75c514236c9529e18a68ea207ed59dd39fd1341fc9a8a03bcc'),
}
ORIGINAL_CONFIGS = {'config.json': '0c293000c80941d5fe4e6a9fa60d21355468a454', 'coarse_model/config.json': 'cef4fd543fe40d4c4f807aa4a4a5bdd041b30985', 'base_model/config.json': 'fe29b9bff062c584d9ab96a9d1b817b44f30ffbb', 'decoder_model/config.json': '09b0acc2ff9ca390067853470b55d46e2d643f59'}


def verify_git_blob(path, digest):
    data = Path(path).read_bytes()
    actual = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
    if actual != digest:
        raise ValueError(f'Git blob hash mismatch: {path}')
    return path


def verify(path, size, digest):
    path = Path(path)
    if not path.is_file() or path.stat().st_size != size:
        raise ValueError(f'Missing or incorrect size: {path}')
    with path.open('rb') as f:
        actual = hashlib.file_digest(f, 'sha256').hexdigest()
    if actual != digest:
        raise ValueError(f'SHA-256 mismatch: {path}')
    return path


def verify_model(directory, key):
    model = INVENTORY['models'][key]
    return verify(Path(directory) / model['file'], model['bytes'], model['sha256'])


def hub():
    try:
        from huggingface_hub import hf_hub_download, HfApi
    except ImportError as exc:
        raise ValueError('Install huggingface_hub in the optional Python runtime to download or publish.') from exc
    return hf_hub_download, HfApi


def commit_revision(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise argparse.ArgumentTypeError('revision must be a full lowercase 40-character commit SHA')
    return value


def selected(values):
    return values or list(DISTILLED)


def safe_copy(source, dest, *, replace=False, check=None):
    dest = Path(dest)
    if not replace and dest.exists():
        raise ValueError(f'Refusing to overwrite: {dest}')
    # A failed or interrupted copy must never leave a partial destination.
    with tempfile.NamedTemporaryFile(prefix=f'.{dest.name}.', suffix='.tmp', dir=dest.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copyfile(source, temporary)
        if check is not None:
            check(temporary)
        if replace:
            os.replace(temporary, dest)
        else:
            # Creating a hard link fails if another process created the target.
            os.link(temporary, dest)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(source, output):
    # Validate everything before writing; exports must contain only curated inference files.
    files = [verify_model(source, key) for key in DISTILLED]
    extras = [ASSETS / name for name in (*CONFIGS, 'LICENSE-TEACHER.txt', 'model-inventory.json')]
    extras.append(ROOT / 'docs/models-release/MODEL_CARD.md')
    extras.append(ROOT / 'docs/models-release/LICENSE')
    for path in extras:
        if not path.is_file():
            raise ValueError(f'Missing release input: {path}')
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError(f'Output directory must be empty: {output}')
    output.mkdir(parents=True, exist_ok=True)
    for path in files + extras:
        safe_copy(path, output / ('README.md' if path.name == 'MODEL_CARD.md' else path.name))


def validate_release(directory):
    directory = Path(directory)
    expected = {INVENTORY['models'][k]['file'] for k in DISTILLED} | set(CONFIGS) | {'model-inventory.json', 'LICENSE', 'LICENSE-TEACHER.txt', 'README.md'}
    actual = {p.name for p in directory.iterdir()}
    if actual != expected or any(not p.is_file() or p.is_symlink() for p in directory.iterdir()):
        raise ValueError('Release directory must contain exactly the prepared inference files; regenerate it with prepare-distilled.')
    if json.loads((directory / 'model-inventory.json').read_text(encoding='utf-8')) != INVENTORY:
        raise ValueError('Release inventory differs from the local pinned inventory.')
    for key in DISTILLED:
        verify_model(directory, key)
    for name in (*CONFIGS, 'LICENSE-TEACHER.txt'):
        if (directory / name).read_bytes() != (ASSETS / name).read_bytes():
            raise ValueError(f'Release file differs from pinned source: {name}')
    if (directory / 'LICENSE').read_bytes() != (ROOT / 'docs/models-release/LICENSE').read_bytes():
        raise ValueError('Release license differs from pinned source: LICENSE')
    if not (directory / 'README.md').read_text(encoding='utf-8').strip():
        raise ValueError('Release model card is empty.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list', help='List pinned artifacts and provenance')
    p = sub.add_parser('status', help='Verify locally available distilled weights')
    p.add_argument('--weights-dir', type=Path, default=ASSETS)
    p.add_argument('--json', action='store_true', help='Print machine-readable offline integrity status')
    p = sub.add_parser('download-original', help='Fetch selected teacher stages and all pipeline configs to the Hugging Face cache')
    p.add_argument('--stage', action='append', choices=ORIGINAL, required=True)
    p.add_argument('--local-files-only', action='store_true')
    p.add_argument('--cache-dir', type=Path, help='Hugging Face Hub cache directory')
    p = sub.add_parser('download-distilled', help='Fetch and verify pinned distilled artifacts from an explicit Hub repository')
    p.add_argument('--repo', required=True)
    p.add_argument('--revision', required=True, type=commit_revision)
    p.add_argument('--model', action='append', choices=DISTILLED)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--local-files-only', action='store_true')
    p.add_argument('--cache-dir', type=Path, help='Hugging Face Hub cache directory')
    p = sub.add_parser('prepare-distilled', help='Prepare a curated release folder without uploading')
    p.add_argument('--weights-dir', type=Path, default=ASSETS)
    p.add_argument('--output', required=True, type=Path)
    p = sub.add_parser('publish', help='Explicitly upload a validated prepared folder to an existing model repository')
    p.add_argument('--repo', required=True)
    p.add_argument('--revision', required=True, help='Existing destination branch')
    p.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == 'list':
        print(json.dumps({'teacher': {'repo': INVENTORY['teacherModel'], 'revision': INVENTORY['teacherRevision'], 'stages': ORIGINAL, 'configs': ORIGINAL_CONFIGS}, 'distilled': {k: INVENTORY['models'][k] for k in DISTILLED}}, indent=2))
    elif args.command == 'status':
        failed = False
        rows = []
        for key in DISTILLED:
            try:
                path = verify_model(args.weights_dir, key)
                row = {'id': key, 'ok': True, 'path': str(path)}
            except (OSError, ValueError) as exc:
                failed = True
                row = {'id': key, 'ok': False, 'path': str(args.weights_dir / INVENTORY['models'][key]['file']), 'error': str(exc)}
            rows.append(row)
            if not args.json:
                print(f'{key}: ' + (f'verified {row["path"]}' if row['ok'] else row['error']))
        if args.json:
            print(json.dumps({'ok': not failed, 'weightsDir': str(args.weights_dir), 'models': rows}))
        return int(failed)
    elif args.command == 'download-original':
        download, _ = hub()
        for name, digest in ORIGINAL_CONFIGS.items():
            path = download(repo_id=INVENTORY['teacherModel'], revision=INVENTORY['teacherRevision'], filename=name, local_files_only=args.local_files_only, cache_dir=args.cache_dir)
            print(verify_git_blob(path, digest))
        for stage in dict.fromkeys(args.stage):
            name, size, digest = ORIGINAL[stage]
            path = download(repo_id=INVENTORY['teacherModel'], revision=INVENTORY['teacherRevision'], filename=name, local_files_only=args.local_files_only, cache_dir=args.cache_dir)
            print(verify(path, size, digest))
    elif args.command == 'download-distilled':
        download, _ = hub()
        args.output.mkdir(parents=True, exist_ok=True)
        for key in dict.fromkeys(selected(args.model)):
            item = INVENTORY['models'][key]
            target = args.output / item['file']
            if target.exists():
                try:
                    print(verify_model(args.output, key))
                    continue
                except ValueError:
                    pass  # Keep the corrupt file until a verified replacement is ready.
            source = download(repo_id=args.repo, revision=args.revision, filename=item['file'], local_files_only=args.local_files_only, cache_dir=args.cache_dir)
            verify(source, item['bytes'], item['sha256'])
            safe_copy(source, target, replace=True, check=lambda path: verify(path, item['bytes'], item['sha256']))
            print(verify_model(args.output, key))
    elif args.command == 'prepare-distilled':
        prepare(args.weights_dir, args.output)
        print(f'Prepared {args.output}; no upload performed.')
    else:
        validate_release(args.directory)
        _, api = hub()
        result = api().upload_folder(repo_id=args.repo, repo_type='model', revision=args.revision, folder_path=str(args.directory))
        print(f'Uploaded to {args.repo} at {args.revision}; commit: {result.oid}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        sys.exit(1)
