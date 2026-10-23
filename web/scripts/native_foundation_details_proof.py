"""Eight exact foundation witnesses, one old/new CLI replay with native details."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

from prepared_plan_cache_proof import request_spans

REPO = Path(__file__).resolve().parents[2]
PROOF = REPO / "web/out/strip-initial-budget-proof"
OUTPUT = REPO / "web/out/native-foundation-detail-proof"
PHASES = {
    "before": ("after-cache-and-simple", REPO / "web/out/prepared-plan-cache-proof/after/plan_replay.exe"),
    "after": ("after-native-foundation", REPO / "web/out/native-foundation-cli-proof/plan_replay.exe"),
}


def load(path):
    return json.loads(path.read_bytes())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def main():
    comparison = load(PROOF / "after-native-foundation/foundation-comparison.json")
    witnesses = {s["id"] for s in comparison["audits"]["after-native-foundation"]["sites"]
                 if s.get("terrain", {}).get("retainedPlanWouldExceedStep")}
    assert len(witnesses) == 8, "Expected the eight frozen physical-domain witnesses"
    assert not any(c.get("bodyAreaDeltaM2", 0) < -0.0001 for c in comparison["sites"]), "Add regression witnesses explicitly"
    source = (PROOF / "requests.json").read_text(encoding="utf-8")
    start, end, spans = request_spans(source)
    chosen = [(a, b, r) for a, b, r in spans if r["id"] in witnesses]
    assert len(chosen) == len(witnesses)
    raw = (source[:start] + "[" + ",".join(source[a:b] for a, b, _ in chosen)
           + "]" + source[end:]).encode("utf-8")
    OUTPUT.mkdir(exist_ok=False)
    request_file = OUTPUT / "requests.json"
    request_file.write_bytes(raw)
    selected = {s["id"]: s for s in load(PROOF / "selection.json")["sites"]}
    save(OUTPUT / "selection.json", {
        "version": "native-foundation-detail-proof-1", "requestSha256": digest(raw),
        "sourceRequestSha256": digest(source.encode("utf-8")),
        "rule": "Eight accepted after-foundation poses whose same retained court/path domain would exceed the unchanged step limit; no area regressions existed to add. Original order and raw request fragments retained.",
        "sites": [selected[r["id"]] for _, _, r in chosen],
    })
    phases = {}
    for name, (reference_phase, binary) in PHASES.items():
        folder = OUTPUT / name
        folder.mkdir()
        plans_file, details_file = folder / "plans.json", folder / "details.json"
        binary_hash = digest(binary.read_bytes())
        command = [str(binary), str(request_file), str(plans_file), "--details", str(details_file)]
        result = subprocess.run(command, capture_output=True, timeout=60, check=False)
        (folder / "stdout.log").write_bytes(result.stdout)
        (folder / "stderr.log").write_bytes(result.stderr)
        assert digest(binary.read_bytes()) == binary_hash, "Frozen executable changed"
        save(folder / "runtime.json", {"command": command, "binarySha256": binary_hash,
             "requestSha256": digest(raw), "returncode": result.returncode,
             "capturedUtc": datetime.now(timezone.utc).isoformat()})
        if result.returncode:
            raise RuntimeError(f"{name} detail replay failed; logs retained")
        plans = load(plans_file)
        reference = {b["id"]: b for b in load(PROOF / reference_phase / "plans.json")["buildings"]}
        equality = {b["id"]: b == reference[b["id"]] for b in plans["buildings"]}
        details = load(details_file)
        assert len(plans["buildings"]) == 8 and not plans["refusals"]
        assert len(details["details"]) == 16
        phases[name] = {"binarySha256": binary_hash, "plansEqualFull128": equality,
                        "details": details["details"]}
        print(json.dumps({"phase": name, "plansEqualFull128": all(equality.values()),
                          "detailPassed": sum(d["ok"] for d in details["details"]), "detailTotal": 16}), flush=True)
    before = {(d["id"], d["interiors"]): d for d in phases["before"]["details"]}
    changes = []
    for after in phases["after"]["details"]:
        old = before[(after["id"], after["interiors"])]
        status = ("unchanged_success" if old["ok"] and after["ok"] else
                  "new_failure" if old["ok"] else "fixed" if after["ok"] else
                  "preexisting_failure" if old["error"] == after["error"] else "changed_failure")
        changes.append({"id": after["id"], "sourceIndex": selected[after["id"]]["sourceIndex"],
                        "interiors": after["interiors"], "status": status,
                        "before": old, "after": after})
    report = {
        "version": "native-foundation-detail-proof-1", "requestSha256": digest(raw),
        "phases": phases, "changes": changes,
        "allReducedPlansExactlyMatchFull128": all(v for phase in phases.values() for v in phase["plansEqualFull128"].values()),
        "scope": "Eight exact original requests, one CLI run per version, exterior and interior native realization. Reduced-batch plans compared to full128 per version so missing earlier occupation cannot silently change a witness. No city rate or catalogue-wide claim.",
    }
    save(OUTPUT / "comparison.json", report)
    print(json.dumps({"allReducedPlansExactlyMatchFull128": report["allReducedPlansExactlyMatchFull128"],
                      "detailChanges": [{k: c[k] for k in ("sourceIndex", "interiors", "status")} for c in changes]}, ensure_ascii=False))
    if not report["allReducedPlansExactlyMatchFull128"]:
        raise SystemExit("Witness drift: do not treat reduced details as exact full128 plans")


if __name__ == "__main__":
    main()
