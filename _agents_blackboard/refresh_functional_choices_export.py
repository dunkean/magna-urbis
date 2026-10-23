"""Merge a native registry-only export, preserving every unrelated byte."""
import hashlib
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
native_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / '_agents_blackboard/functional-choices-native.json'
artifact = root / 'rust/crates/houses/data/urban-admission.json'
original = artifact.read_bytes()
text = original.decode('utf-8')
before = json.loads(text)
native_text = native_path.read_text(encoding='utf-8-sig').strip()
native = json.loads(native_text)
source_hash = hashlib.sha256((root / 'rust/crates/houses/data/recipes.json').read_bytes()).hexdigest()
assert before['source_sha256'] == source_hash, 'Stale admission source hash; do not refresh just one registry'
assert before['functional_choices']['catalogue_version'] == native['catalogue_version']
assert native['version'] == 'functional-choices-2'
matches = list(re.finditer(r'^  "functional_choices":\s*', text, re.MULTILINE))
assert len(matches) == 1
start = matches[0].end()
old, length = json.JSONDecoder().raw_decode(text[start:])
assert old == before['functional_choices']
end = start + length
replacement = '\n'.join(line if i == 0 else '  ' + line for i, line in enumerate(native_text.splitlines()))
updated = text[:start] + replacement + text[end:]
after = json.loads(updated)
assert after.pop('functional_choices') == native
before.pop('functional_choices')
assert after == before
# Byte preservation outside the sole edited top-level field is structural here;
# no reserialization of the 223 profiles or 417 feasibility records occurs.
assert updated[:start] == text[:start] and updated[start+len(replacement):] == text[end:]
temporary = artifact.with_suffix('.json.functional-choices.tmp')
temporary.write_bytes(updated.encode('utf-8'))
temporary.replace(artifact)
print(json.dumps({'artifact':str(artifact.relative_to(root)),
    'rules':len(native['rules']), 'profiles':len(before['profiles']),
    'feasibility':len(before['feasibility']['profiles']),
    'unrelated_bytes_preserved':True, 'source_sha256':source_hash}))
