"""Derive new current native exteriors from retained source site requests.

No legacy version retagging, renderer roof synthesis, source-file writes or GPU.
The original accepted plot footprints constrain the new native planning call.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import time


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-plans", type=Path, required=True)
    parser.add_argument("--source-requests", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True,
                        help="Bound Surface packet whose urban IDs select the source plots")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--runtime-repo", type=Path,
                        help="Repo providing existing TS world/mesh adapters; defaults to this repo")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    repo = here.parents[3]
    runtime_repo = (args.runtime_repo or repo).resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    target = out / "target"
    exe = target / "release" / ("surface-retained-native-realizer.exe" if os.name == "nt"
                                else "surface-retained-native-realizer")
    env = {**os.environ, "CARGO_TARGET_DIR": str(target)}
    if not args.skip_build:
        subprocess.run(["cargo", "build", "--manifest-path", str(here / "runner/Cargo.toml"),
                        "--release", "--offline", "--locked"], env=env, check=True)
    exe_sha = digest(exe.read_bytes())

    def save(name: str, value) -> None:
        (out / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n",
                                encoding="utf-8")

    def call(stem: str, request, planning: bool = False):
        data = encoded(request)
        (out / (stem + "-request.json")).write_bytes(data)
        started = time.perf_counter()
        result = subprocess.run([str(exe), *(["--plan"] if planning else [])],
                                input=data + b"\n", stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=True)
        (out / (stem + "-response.json")).write_bytes(result.stdout)
        (out / (stem + "-stderr.log")).write_bytes(result.stderr)
        return json.loads(result.stdout), {
            "requestSha256": digest(data), "responseSha256": digest(result.stdout),
            "durationMs": (time.perf_counter() - started) * 1000,
            "executableSha256": exe_sha,
        }

    # Read the small binary manifest only, not the hundreds of MB of terrain.
    with args.base.open("rb") as file:
        header = file.read(16)
        if header[:8] != b"MUFSURF1":
            raise ValueError("Expected a binary Surface source packet")
        manifest = json.loads(file.read(struct.unpack_from("<I", header, 8)[0]))
    ids = {building["id"] for building in manifest["value"]["urban"]["buildings"]}
    if len(ids) != 500:
        raise ValueError("This reference fixture requires the original500 selected source plot IDs")
    plans_bytes = args.source_plans.read_bytes()
    source_cache_sha = digest(plans_bytes)
    cache = json.loads(plans_bytes)
    old = [building for building in cache["buildings"] if building["id"] in ids]
    if len(old) != len(ids) or not old:
        raise ValueError("Base packet IDs do not identify unique original source plans")
    clone = {"buildings": old, "materials": cache["materials"],
             "generator_version": cache["generator_version"],
             "schema_version": cache["schema_version"]}
    (out / "accepted-500-source-clone.json").write_bytes(encoded(clone))
    requests_bytes = args.source_requests.read_bytes()
    requests_sha = digest(requests_bytes)
    all_requests = json.loads(requests_bytes)
    if isinstance(all_requests, dict):
        all_requests = all_requests["requests"]
    requests_count = len(all_requests)
    requests = [request for request in all_requests if request["id"] in ids]
    if len(requests) != len(old):
        raise ValueError("A selected retained plot lacks its original placement request")
    by_id = {request["id"]: request for request in requests}
    footprints = {building["id"]: building["footprint"] for building in old}

    # Negative proof is preserved. This is NOT followed by version retagging.
    legacy, legacy_report = call("trial-one", {"building": old[0], "interiors": False})
    save("trial-one-report.json", {**legacy_report, "sourceCacheSha256": source_cache_sha,
         "sourceBuildingId": old[0]["id"], "response": legacy,
         "scope": "Original plan replay result; new planning below is a separate explicit derivation"})

    trial_plan_request = {"schema_version": "1", "requests": [by_id[old[0]["id"]]],
                          "footprints": {old[0]["id"]: old[0]["footprint"]}}
    trial, trial_report = call("new-plan-trial", trial_plan_request, True)
    save("new-plan-trial-report.json", {**trial_report, "response": trial})
    if not trial.get("ok") or not trial["data"]["buildings"]:
        raise RuntimeError("Current native planning trial refused; explicit response retained")
    exterior, exterior_report = call("new-plan-realize-trial", {
        "building": trial["data"]["buildings"][0], "interiors": False})
    save("new-plan-realize-trial-report.json", {**exterior_report, "response": exterior})
    if not exterior.get("ok"):
        raise RuntimeError("Current native exterior trial refused; no fallback generated")

    batch, planning_report = call("new-plans-500", {
        "schema_version": "1", "requests": requests, "footprints": footprints}, True)
    if not batch.get("ok"):
        raise RuntimeError("Native current planning batch failed; response retained")
    accepted = batch["data"]["buildings"]
    planning_report.update({"sourceCacheSha256": source_cache_sha,
                           "sourcePlacementRequestsSha256": requests_sha,
                           "sourcePlacementRequests": str(args.source_requests.resolve()),
                           "sourceRequestsAvailable": requests_count,
                           "selectedRequests": len(requests), "buildings": len(accepted),
                           "refusals": batch["data"]["refusals"],
                           "planGeneratorVersion": batch["data"]["generator_version"]})
    save("new-plans-500-report.json", planning_report)
    if not accepted:
        raise RuntimeError("No source sites accepted; native refusals retained")

    lines = b"".join(encoded({"building": building, "interiors": False}) + b"\n"
                     for building in accepted)
    (out / "new-realize-accepted-requests.jsonl").write_bytes(lines)
    result = subprocess.run([str(exe)], input=lines, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=True)
    (out / "new-realize-accepted-responses.jsonl").write_bytes(result.stdout)
    responses = [json.loads(line) for line in result.stdout.splitlines()]
    if len(responses) != len(accepted):
        raise RuntimeError("Native JSONL response count differs from submitted source plans")
    refused = [{"sourceID": building["id"], "error": response.get("error")}
               for building, response in zip(accepted, responses) if not response.get("ok")]
    save("new-realize-accepted-report.json", {
        "requestJsonlSha256": digest(lines), "responseJsonlSha256": digest(result.stdout),
        "executableSha256": exe_sha, "interiors": False,
        "realizationAccepted": len(accepted) - len(refused), "realizationRefused": refused})
    if refused:
        raise RuntimeError("Native exterior refusals retained; fixture not silently truncated")
    if digest(args.source_plans.read_bytes()) != source_cache_sha or digest(
            args.source_requests.read_bytes()) != requests_sha:
        raise RuntimeError("An original source file changed during production")
    tsx = runtime_repo / "web/node_modules/tsx/dist/cli.mjs"
    subprocess.run(["node", str(tsx), str(here / "assemble-fixture.ts"),
                    "--root", str(runtime_repo), "--out", str(out),
                    "--base", str(args.base.resolve())], check=True)


if __name__ == "__main__":
    main()
