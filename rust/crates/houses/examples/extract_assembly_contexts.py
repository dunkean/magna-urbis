"""Extract the preselected 22 historical requests; never generate a city."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[4]
selection = ROOT / "web/out/java100k-compound-path-readonly-audit/cohort-selection.json"
captures = ROOT / "web/out/native-assembly-cohort-proof-v5/unit/plans__assembly__tests__cohort__native_assembly_fixed_twenty_two_original_java_contexts"
destination = ROOT / "rust/crates/houses/tests/fixtures/assembly-contexts22"
sha = lambda data: hashlib.sha256(data).hexdigest()
selected_bytes = selection.read_bytes()
selected = json.loads(selected_bytes)
assert selected["caseCount"] == len(selected["cases"]) == 22
destination.mkdir(parents=True, exist_ok=True)
files = []
for case in selected["cases"]:
    source = captures / f"case-{case['globalIndex']}-native-input.json"
    raw = source.read_bytes()
    payload = json.loads(raw)
    assert payload["site"]["id"] == payload["incumbent"]["id"] == case["id"]
    assert payload["incumbent"]["recipe_id"] == case["source"]
    target = destination / source.name
    if target.exists() and target.read_bytes() != raw:
        raise RuntimeError(f"Refusing to replace frozen evidence: {target}")
    target.write_bytes(raw)
    files.append({**case, "file": source.name, "sha256": sha(raw), "bytes": len(raw)})
manifest = {"schema_version": "assembly-contexts22-1", "selection": str(selection.relative_to(ROOT)).replace("\\", "/"),
            "selection_sha256": sha(selected_bytes), "scope": "22 fixed historical contexts, independent component attempts; no city replay or cumulative gain",
            "source": str(captures.relative_to(ROOT)).replace("\\", "/"), "cases": files}
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Extracted {len(files)} exact requests, {sum(f['bytes'] for f in files)} bytes")
