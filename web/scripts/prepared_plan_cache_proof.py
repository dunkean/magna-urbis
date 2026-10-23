"""Isolated before/after replay of the 120 already accepted native requests.

No build, server, city generation or detail realization. Every phase has its
own frozen executable and 3 or 5 short runs. Existing artifacts are never replaced.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "web/out/strip-initial-budget-proof"
DEFAULT_OUTPUT = REPO / "web/out/prepared-plan-cache-proof"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def request_spans(text):
    """Locate raw requests without rewriting any retained decimal/field bytes."""
    decoder = json.JSONDecoder()
    skip = lambda i: i + len(text[i:]) - len(text[i:].lstrip())
    i = skip(0)
    if text[i] != "{":
        raise ValueError("Expected a PlanBatchRequest object")
    i += 1
    while True:
        i = skip(i)
        key, i = decoder.raw_decode(text, i)
        i = skip(i)
        if text[i] != ":":
            raise ValueError("Missing object separator")
        i = skip(i + 1)
        if key == "requests":
            start = i
            if text[i] != "[":
                raise ValueError("Expected request array")
            i += 1
            spans = []
            while True:
                i = skip(i)
                if text[i] == "]":
                    return start, i + 1, spans
                begin = i
                request, i = decoder.raw_decode(text, i)
                spans.append((begin, i, request))
                i = skip(i)
                if text[i] == ",":
                    i += 1
                elif text[i] != "]":
                    raise ValueError("Invalid request array separator")
        _, i = decoder.raw_decode(text, i)
        i = skip(i)
        if text[i] != ",":
            raise ValueError("No requests array")
        i += 1


def prepare(root, source):
    source_bytes = (source / "requests.json").read_bytes()
    reference_bytes = (source / "after-recovery/plans.json").read_bytes()
    reference = json.loads(reference_bytes)
    accepted = [b["id"] for b in reference["buildings"]]
    refused = {b["id"] for b in reference["refusals"]}
    if len(accepted) != 120 or len(set(accepted)) != 120 or len(refused) != 8:
        raise ValueError("Proof requires the frozen 120 accepted / 8 refused baseline")
    if reference["open_spaces"] or set(accepted) & refused:
        raise ValueError("Unexpected occupation or duplicate baseline identities")
    text = source_bytes.decode("utf-8")
    start, end, spans = request_spans(text)
    chosen = [(i, a, b, r) for i, (a, b, r) in enumerate(spans) if r["id"] in set(accepted)]
    if len(spans) != 128 or [r["id"] for _, _, _, r in chosen] != accepted:
        raise ValueError("Accepted requests are not in the baseline source order")
    if {r["id"] for _, _, r in spans} != set(accepted) | refused:
        raise ValueError("Source requests do not match the baseline")
    fixture = (text[:start] + "[" + ",".join(text[a:b] for _, a, b, _ in chosen)
               + "]" + text[end:]).encode("utf-8")
    root.mkdir(parents=True, exist_ok=False)
    with (root / "requests.json").open("xb") as stream:
        stream.write(fixture)
    expected = dict(reference)
    expected["refusals"] = []
    save(root / "reference-accepted-plans.json", expected)
    save(root / "selection.json", {
        "version": "prepared-plan-cache-proof-1", "source": str(source),
        "sourceRequestSha256": sha(source_bytes), "sourcePlansSha256": sha(reference_bytes),
        "requestSha256": sha(fixture), "sourceCount": 128, "selectedCount": 120,
        "rule": "Keep baseline accepted IDs in original order; preserve each raw request substring and all other top-level fields. Refusals add no occupation.",
        "removedRefusedIds": sorted(refused),
        "sites": [{"sourceSampleIndex": i, "id": r["id"],
                   "rawRequestSha256": sha(text[a:b].encode("utf-8"))}
                  for i, a, b, r in chosen],
    })


def first_difference(a, b, path="$"):
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return {"path": path, "beforeKeys": list(a), "afterKeys": list(b)}
        for key in a:
            if a[key] != b[key]:
                return first_difference(a[key], b[key], path + "." + key)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return {"path": path, "beforeLength": len(a), "afterLength": len(b)}
        for i, (left, right) in enumerate(zip(a, b)):
            if left != right:
                return first_difference(left, right, f"{path}[{i}]")
    elif a != b:
        return {"path": path, "before": repr(a)[:240], "after": repr(b)[:240]}
    return None


def run_phase(args):
    root = args.output.resolve()
    binary = args.binary.resolve()
    binary_bytes = binary.read_bytes()
    if args.phase == "before":
        prepare(root, args.source.resolve())
    selection = json.loads((root / "selection.json").read_bytes())
    fixture = root / "requests.json"
    if sha(fixture.read_bytes()) != selection["requestSha256"]:
        raise ValueError("Frozen proof requests changed")
    phase = root / args.phase
    phase.mkdir(exist_ok=False)
    frozen = phase / "plan_replay.exe"
    shutil.copy2(binary, frozen)
    if sha(frozen.read_bytes()) != sha(binary_bytes):
        raise ValueError("Executable changed while freezing it")
    reference = json.loads((root / "reference-accepted-plans.json").read_bytes())
    runs, first_bytes, first_json = [], None, None
    for i in range(args.runs):
        output = phase / f"run-{i + 1:02d}-plans.json"
        command = [str(frozen), str(fixture), str(output)]
        started = time.perf_counter()
        result = subprocess.run(command, capture_output=True, timeout=60, check=False)
        wall_ms = (time.perf_counter() - started) * 1000
        (phase / f"run-{i + 1:02d}-stdout.log").write_bytes(result.stdout)
        (phase / f"run-{i + 1:02d}-stderr.log").write_bytes(result.stderr)
        if result.returncode:
            raise RuntimeError(f"Replay failed with exit {result.returncode}; logs preserved in {phase}")
        native = json.loads(result.stdout.decode("utf-8").strip())
        raw = output.read_bytes()
        plans = json.loads(raw)
        if first_bytes is None:
            first_bytes, first_json = raw, plans
        run = {
            "run": i + 1, "command": command, "nativeMs": native["ms"],
            "wallMsIncludingStartupReadWrite": wall_ms,
            "accepted": native["accepted"], "refused": native["refused"], "open": native["open"],
            "plansByteSha256": sha(raw), "plansCanonicalJsonSha256": sha(canonical(plans)),
            "bytesEqualFirstRun": raw == first_bytes, "jsonEqualFirstRun": plans == first_json,
            "jsonEqualFrozenAcceptedBaseline": plans == reference,
            "firstDifferenceFromBaseline": first_difference(reference, plans),
        }
        runs.append(run)
        print(json.dumps({"phase": args.phase, "run": i + 1, "nativeMs": run["nativeMs"],
                          "accepted": run["accepted"], "sameJson": plans == reference}), flush=True)
    summary = {
        "version": "prepared-plan-cache-proof-1", "phase": args.phase,
        "capturedUtc": datetime.now(timezone.utc).isoformat(),
        "originalExecutable": str(binary), "frozenExecutable": str(frozen),
        "executableSha256": sha(binary_bytes), "requestSha256": selection["requestSha256"],
        "runs": runs, "nativeMs": [r["nativeMs"] for r in runs],
        "medianNativeMs": statistics.median(r["nativeMs"] for r in runs),
        "medianWallMsIncludingStartupReadWrite": statistics.median(r["wallMsIncludingStartupReadWrite"] for r in runs),
        "allRunsByteIdentical": all(r["bytesEqualFirstRun"] for r in runs),
        "allRunsJsonIdenticalToBaseline": all(r["jsonEqualFrozenAcceptedBaseline"] for r in runs),
        "scope": "120 frozen accepted requests; 3 or 5 fresh CLI processes, no server/build/city/details. Native timer excludes process startup and output serialization; includes catalogue loading in each process. Sequential phases are not a randomized benchmark.",
    }
    save(phase / "summary.json", summary)
    ok = summary["allRunsByteIdentical"] and summary["allRunsJsonIdenticalToBaseline"]
    if args.phase == "after":
        before = json.loads((root / "before/summary.json").read_bytes())
        before_bytes = (root / "before/run-01-plans.json").read_bytes()
        before_json = json.loads(before_bytes)
        comparison = {
            "version": summary["version"], "requestSha256": summary["requestSha256"],
            "beforeExecutableSha256": before["executableSha256"],
            "afterExecutableSha256": summary["executableSha256"],
            "beforeNativeMs": before["nativeMs"], "afterNativeMs": summary["nativeMs"],
            "beforeMedianNativeMs": before["medianNativeMs"],
            "afterMedianNativeMs": summary["medianNativeMs"],
            "nativeMedianRatioAfterBefore": summary["medianNativeMs"] / before["medianNativeMs"],
            "plansByteIdentical": before_bytes == first_bytes,
            "plansJsonIdentical": before_json == first_json,
            "firstDifference": first_difference(before_json, first_json),
            "allRunsByteIdenticalWithinEachPhase": before["allRunsByteIdentical"] and summary["allRunsByteIdentical"],
            "scope": summary["scope"],
        }
        if before["requestSha256"] != summary["requestSha256"]:
            raise ValueError("Before/after fixture mismatch")
        save(root / "comparison.json", comparison)
        ok = ok and comparison["plansByteIdentical"] and comparison["plansJsonIdentical"]
        print(json.dumps(comparison, ensure_ascii=False), flush=True)
    else:
        print(json.dumps({"phase": args.phase, "medianNativeMs": summary["medianNativeMs"],
                          "allRunsByteIdentical": summary["allRunsByteIdentical"],
                          "allRunsJsonIdenticalToBaseline": summary["allRunsJsonIdenticalToBaseline"]}), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("before", "after"))
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--runs", type=int, choices=(3, 5), default=5)
    raise SystemExit(run_phase(parser.parse_args()))
