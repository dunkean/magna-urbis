"""Prepare/replay 128 untouched Rynek requests; no build, server or city run."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import time

from native_foundation_compare import audit_phase
from prepared_plan_cache_proof import request_spans
from strip_initial_budget_proof import area

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "web/out/p5-cultures-final/rynek-town-13-5000/city-13-temperate-valley-s-placement-requests.json"
OUTPUT = REPO / "web/out/native-entry-secondary-proof"
BEFORE = REPO / "web/out/native-foundation-cli-proof/plan_replay.exe"
SCOPE = ("Deterministic regularly spaced sample, not random or a city acceptance/capacity estimate. "
         "Raw request fragments, IDs, seeds, terrain, programmes and existing neighbours are preserved. "
         "Omitted earlier-city occupation is not reconstructed. No details or server are generated.")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def array_spans(text):
    # Reuse the raw-span scanner with a temporary textual envelope. No number
    # is parsed and reserialized into the retained fixture.
    prefix = '{"requests":'
    _, _, spans = request_spans(prefix + text + "}")
    return [(a - len(prefix), b - len(prefix), r) for a, b, r in spans]


def eligible(request):
    config = request.get("config") or {}
    return (request.get("function") in ("domestic", "mixed")
            and config.get("mode") == "historical_inspired"
            and not config.get("recipe") and not config.get("workshop")
            and all(value is None for value in (config.get("overrides") or {}).values()))


def prepare(root):
    raw = SOURCE.read_bytes()
    text = raw.decode("utf-8")
    spans = array_spans(text)
    candidates = [(i, a, b, r) for i, (a, b, r) in enumerate(spans) if eligible(r)]
    if len(spans) != 718 or len(candidates) != 693:
        raise ValueError("Frozen Rynek source no longer has 718 requests / 693 eligible requests")
    ranks = [i * (len(candidates) - 1) // 127 for i in range(128)]
    chosen = [candidates[i] for i in ranks]
    fixture = ('{"schema_version":"1","requests":['
               + ",".join(text[a:b] for _, a, b, _ in chosen) + "]}\n").encode("utf-8")
    root.mkdir(parents=True, exist_ok=False)
    (root / "requests.json").write_bytes(fixture)
    _, _, retained = request_spans(fixture.decode("utf-8"))
    if len({r["id"] for _, _, _, r in chosen}) != 128:
        raise ValueError("Duplicate selected request IDs")
    rows = []
    for sample, (rank, (source_index, a, b, request), (fa, fb, emitted)) in enumerate(zip(ranks, chosen, retained)):
        fragment = text[a:b].encode("utf-8")
        if emitted != request or fixture.decode("utf-8")[fa:fb].encode("utf-8") != fragment:
            raise ValueError("Raw selected request changed during extraction")
        rows.append(dict(sampleIndex=sample, eligibleRank=rank, sourceIndex=source_index,
                         sourceCharacterSpan=[a, b], rawRequestSha256=sha(fragment),
                         id=request["id"], function=request["function"], seed=request.get("seed"),
                         configSeed=request["config"].get("seed")))
    manifest = dict(version="native-entry-secondary-proof-1", source=str(SOURCE.relative_to(REPO)),
                    sourceSha256=sha(raw), sourceRequests=len(spans), eligibleRequests=len(candidates),
                    selectedRequests=128, requestSha256=sha(fixture),
                    selection="eligible_rank=floor(i*(693-1)/127), i=0..127; source order retained",
                    eligibility="domestic/mixed, historical_inspired, no recipe/workshop, all override values null",
                    baselineExecutable=str(BEFORE.relative_to(REPO)), baselineExecutableSha256=sha(BEFORE.read_bytes()),
                    functions=dict(Counter(r["function"] for r in rows)), sites=rows, scope=SCOPE)
    save(root / "manifest.json", manifest)
    (root / "README.md").write_text(
        "# Secondary native-entry proof: prepared, not yet replayed\n\n"
        "128 raw requests selected regularly from 693 automatic domestic/mixed requests out of 718 Rynek requests. "
        "IDs, seeds and geometry/terrain decimal bytes are untouched.\n\n"
        "Replay only after the fresh contact CLI is ready:\n\n"
        "```powershell\npython web/scripts/native_entry_secondary_proof.py replay --after PATH_TO_FROZEN_PLAN_REPLAY --runs 5\n```\n\n"
        "The runner copies both executables, records their hashes and alternates baseline/after executions. "
        "Each output is unique; existing artifacts cannot be replaced. Before is the frozen foundation CLI. "
        "Comparisons report gained/lost IDs, areas/styles, entry and recovery diagnostics, independent rights/terrain and native timings.\n\n"
        + SCOPE + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("sourceRequests", "eligibleRequests", "selectedRequests", "requestSha256", "functions")}))


def replay(root, after, runs):
    manifest = read(root / "manifest.json")
    fixture = root / "requests.json"
    if sha(fixture.read_bytes()) != manifest["requestSha256"]:
        raise ValueError("Frozen requests changed")
    if sha(BEFORE.read_bytes()) != manifest["baselineExecutableSha256"]:
        raise ValueError("Frozen baseline executable changed")
    run_root = root / "replay"
    run_root.mkdir(exist_ok=False)
    executables, hashes = {}, {}
    for phase, source in (("before", BEFORE), ("after", after.resolve())):
        folder = run_root / phase
        folder.mkdir()
        frozen = folder / "plan_replay.exe"
        hashes[phase] = sha(source.read_bytes())
        shutil.copy2(source, frozen)
        if sha(frozen.read_bytes()) != hashes[phase]:
            raise ValueError("Executable changed during copy")
        executables[phase] = frozen
    rows, plan_hashes = [], {}
    for run in range(runs):
        for phase in ("before", "after"):
            folder = run_root / phase
            output = folder / f"run-{run + 1:02d}-plans.json"
            command = [str(executables[phase]), str(fixture), str(output)]
            started = time.perf_counter()
            result = subprocess.run(command, capture_output=True, timeout=60, check=False)
            wall_ms = (time.perf_counter() - started) * 1000
            (folder / f"run-{run + 1:02d}-stdout.log").write_bytes(result.stdout)
            (folder / f"run-{run + 1:02d}-stderr.log").write_bytes(result.stderr)
            result.check_returncode()
            native = json.loads(result.stdout.decode("utf-8").strip().splitlines()[-1])
            plan_hash = sha(output.read_bytes())
            plan_hashes.setdefault(phase, plan_hash)
            if plan_hash != plan_hashes[phase]:
                raise ValueError(f"Nondeterministic plans in {phase}, run {run + 1}")
            rows.append(dict(phase=phase, run=run + 1, command=command, native=native,
                             wallMsIncludingReadWrite=wall_ms, planSha256=plan_hash))
    if sha(fixture.read_bytes()) != manifest["requestSha256"] or any(
            sha(executables[k].read_bytes()) != hashes[k] for k in executables):
        raise ValueError("Executable or requests changed during replay")
    requests = read(fixture)["requests"]
    batches = {phase: read(run_root / phase / "run-01-plans.json") for phase in executables}
    summary = {}
    for phase, batch in batches.items():
        recovery = Counter()
        body_areas = {}
        for building in batch["buildings"]:
            body_areas[building["id"]] = area(building["footprint"])
            for diagnostic in building.get("diagnostics", []):
                for prefix in ("Initial strip programme recovery:", "Missing simple family recovery:"):
                    if diagnostic.startswith(prefix):
                        recovery[prefix] += 1
        summary[phase] = dict(accepted=len(batch["buildings"]), refused=len(batch["refusals"]),
                              recoveryDiagnostics=dict(recovery), bodyAreaByIdM2=body_areas,
                              nativeMs=[row["native"]["ms"] for row in rows if row["phase"] == phase],
                              independentAudit=audit_phase(requests, batch))
        summary[phase]["medianNativeMs"] = statistics.median(summary[phase]["nativeMs"])
    report = dict(version="native-entry-secondary-replay-1", capturedUtc=datetime.now(timezone.utc).isoformat(),
                  requestSha256=manifest["requestSha256"], executableSha256=hashes,
                  repeatedOutputByteIdentical=True, phases=summary, runs=rows, scope=SCOPE)
    save(run_root / "report.json", report)
    subprocess.run([sys.executable, str(REPO / "web/scripts/native_entry_report.py"),
                    str(run_root / "before/run-01-plans.json"), str(run_root / "after/run-01-plans.json"),
                    str(run_root / "entry-comparison.json")], check=True)
    print(json.dumps({phase: {k: value[k] for k in ("accepted", "refused", "medianNativeMs", "recoveryDiagnostics")}
                      for phase, value in summary.items()}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "replay"))
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--after", type=Path)
    parser.add_argument("--runs", type=int, choices=(1, 3, 5), default=5)
    args = parser.parse_args()
    if args.phase == "prepare":
        prepare(args.output.resolve())
    elif args.after is None:
        parser.error("replay requires an explicit --after executable")
    else:
        replay(args.output.resolve(), args.after, args.runs)


if __name__ == "__main__":
    main()
