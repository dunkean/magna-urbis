"""Inventory locked npm/Cargo dependencies and retain their upstream notices.

Python 3.11+, standard library only. --refresh uses installed sources or verified
registry archives; --check is offline and needs no installed dependencies.
Archives are read in memory, never extracted or executed.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "licenses"
CACHE = ROOT / ".tmp" / "license-inventory"
NOTICE_NAME = re.compile(r"^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:[._-].*)?$", re.I)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def tracked():
    return subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")[:-1]


def inputs():
    names = [p for p in tracked() if p.endswith(("Cargo.lock", "Cargo.toml"))]
    names += ["web/package.json", "web/package-lock.json",
              "illustration/requirements.txt", "godot-render/tools/requirements-ground.txt"]
    # Git checkouts may use LF or CRLF; the inventory must verify on either OS.
    return {p: digest((ROOT / p).read_text(encoding="utf-8").encode("utf-8")) for p in sorted(names)}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "MagnaUrbis-license-inventory/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def archive_files(url, integrity):
    data = fetch(url)
    algorithm, expected = integrity.split("-", 1)
    actual = hashlib.new(algorithm, data).digest()
    if actual != base64.b64decode(expected):
        raise ValueError(f"Registry checksum mismatch: {url}")
    found = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            if not member.isfile():
                continue
            relative = member.name.split("/", 1)[-1]
            name = relative.rsplit("/", 1)[-1]
            if relative in ("Cargo.toml", "package.json") or NOTICE_NAME.match(name):
                stream = archive.extractfile(member)
                if stream:
                    found[relative] = stream.read().decode("utf-8", errors="replace")
    return found


def local_files(directory, metadata_name):
    if not (directory / metadata_name).is_file():
        return None
    found = {metadata_name: (directory / metadata_name).read_text(encoding="utf-8")}
    for path in sorted(directory.rglob("*")):
        if path.is_file() and NOTICE_NAME.match(path.name) and "node_modules" not in path.relative_to(directory).parts:
            found[path.relative_to(directory).as_posix()] = path.read_text(encoding="utf-8", errors="replace")
    return found


def locked_packages():
    packages = {}
    lock = json.loads((ROOT / "web/package-lock.json").read_text(encoding="utf-8"))
    for path, meta in lock["packages"].items():
        if not path:
            continue
        name = meta.get("name", path.rsplit("node_modules/", 1)[-1])
        key = f"npm:{name}@{meta['version']}"
        if key not in packages:
            packages[key] = dict(id=key, ecosystem="npm", name=name, version=meta["version"],
                                 license=meta.get("license"), source=meta["resolved"],
                                 integrity=meta["integrity"], lockfiles=["web/package-lock.json"],
                                 development=meta.get("dev", False), optional=meta.get("optional", False),
                                 installPaths=[])
        packages[key]["installPaths"].append(path)
    for lockfile in inputs():
        if not lockfile.endswith("Cargo.lock"):
            continue
        for meta in tomllib.loads((ROOT / lockfile).read_text(encoding="utf-8"))["package"]:
            if not meta.get("source", "").startswith("registry+"):
                continue  # Local/path packages are documented separately.
            name, version = meta["name"], meta["version"]
            key = f"cargo:{name}@{version}"
            if key not in packages:
                packages[key] = dict(id=key, ecosystem="cargo", name=name, version=version,
                                     source=f"https://static.crates.io/crates/{name}/{name}-{version}.crate",
                                     integrity="sha256-" + base64.b64encode(bytes.fromhex(meta["checksum"])).decode(),
                                     lockfiles=[])
            packages[key]["lockfiles"].append(lockfile)
    return packages


def resolve(package):
    package = dict(package)
    cache = CACHE / (digest(package["id"].encode()) + ".json")
    if cache.exists():
        files = json.loads(cache.read_text(encoding="utf-8"))
    else:
        if package["ecosystem"] == "npm":
            directory = ROOT / "web" / package["installPaths"][0]
            files = local_files(directory, "package.json")
            if files and json.loads(files["package.json"]).get("version") != package["version"]:
                files = None
        else:
            registry = Path.home() / ".cargo/registry/src"
            matches = sorted(registry.glob(f"*/{package['name']}-{package['version']}"))
            files = local_files(matches[0], "Cargo.toml") if matches else None
        if files is None:
            files = archive_files(package["source"], package["integrity"])
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(files, ensure_ascii=False), encoding="utf-8")
    # Preserve upstream wording while using stable line endings across archives,
    # installed sources and Git checkouts on Windows/macOS/Linux.
    files = {p: t.replace("\r\n", "\n").replace("\r", "\n") for p, t in files.items()}
    if package["ecosystem"] == "cargo":
        meta = tomllib.loads(files["Cargo.toml"])["package"]
        package["license"] = meta.get("license")
        if meta.get("license-file"):
            package["licenseFile"] = meta["license-file"]
        package["homepage"] = meta.get("repository", meta.get("homepage"))
    else:
        meta = json.loads(files["package.json"])
        repository = meta.get("repository", {})
        package["homepage"] = repository.get("url") if isinstance(repository, dict) else repository
    notices = {p: t for p, t in files.items() if p not in ("Cargo.toml", "package.json")}
    package["notices"] = [{"path": p, "sha256": digest(t.encode())} for p, t in sorted(notices.items())]
    if not package.get("license"):
        package["review"] = "License is specified by upstream license-file; read the retained text."
    if not notices:
        package["review"] = "No license/notice text found in the package; declared license alone is not a redistribution notice."
    package.pop("installPaths", None)
    return package, notices


def refresh():
    packages, texts = [], {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for package, notices in pool.map(resolve, sorted(locked_packages().values(), key=lambda p: p["id"])):
            packages.append(package)
            for path, content in sorted(notices.items()):
                key = digest(content.encode())
                entry = texts.setdefault(key, {"content": content, "uses": []})
                entry["uses"].append(f"{package['id']} / {path}")
    chunks = ["Magna Urbis — upstream npm and Cargo license/copyright/notice texts\n"
              "Generated by scripts/license_inventory.py --refresh.\n"
              "See THIRD_PARTY_NOTICES.md for scope, assets, Python, models and release obligations.\n"
              "The upstream license expressions are retained verbatim; OR means a choice, AND cumulative terms.\n"]
    for key, entry in sorted(texts.items()):
        chunks.append("\n" + "=" * 78 + "\nSHA-256: " + key + "\n" +
                      "\n".join(entry["uses"]) + "\n" + "-" * 78 + "\n" + entry["content"].rstrip() + "\n")
    notice_data = "\n".join(chunks).encode("utf-8")
    inventory = dict(schemaVersion=1, generator="scripts/license_inventory.py", inputs=inputs(),
                     scope="All registry packages in committed npm/Cargo lockfiles, including dev, optional and other-platform packages. Not a resolved release SBOM.",
                     noticeFile="licenses/DEPENDENCY_LICENSES.txt", noticeSha256=digest(notice_data), packages=packages)
    OUT.mkdir(exist_ok=True)
    (OUT / "DEPENDENCY_LICENSES.txt").write_bytes(notice_data)
    (OUT / "dependency-inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Inventoried {len(packages)} packages; retained {len(texts)} distinct notice texts.")
    reviews = [p for p in packages if p.get("review")]
    print(f"{len(reviews)} entries require reading the license-file or obtaining missing upstream notices; see each review field.")


def check():
    inventory = json.loads((OUT / "dependency-inventory.json").read_text(encoding="utf-8"))
    if inventory["inputs"] != inputs():
        raise SystemExit("License inventory is stale: run python scripts/license_inventory.py --refresh")
    actual = {p["id"] for p in inventory["packages"]}
    if actual != set(locked_packages()):
        raise SystemExit("License inventory package set does not match lockfiles")
    if inventory["noticeSha256"] != digest((ROOT / inventory["noticeFile"]).read_text(encoding="utf-8").encode("utf-8")):
        raise SystemExit("Dependency license text checksum mismatch")
    print(f"OK: {len(actual)} locked packages; input and notice checksums match.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--refresh", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    refresh() if args.refresh else check()
