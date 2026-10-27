"""Extract the architectural source inventory, without inventing recipes.

Run from any directory. --check verifies the tracked snapshot byte-for-byte.
Recipe roles and operators are authored separately, never inferred from names.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
DESTINATION = REPOSITORY / 'rust/crates/houses/data/source-inventory.json'
SOURCE_FILES = [
    'docs/styles_architecturaux_mondiaux_city_mapper_FR.md',
    'docs/catalogue_settlements_antiquite_moyen_age_rpg_FR.md',
    'docs/sources/javanese-domestic-architecture_FR.md',
    'docs/sources/roman-compact-domestic-architecture_FR.md',
]


def extract():
    result = {'schema_version': '1', 'sources': [], 'packs': [], 'entries': [], 'functional_forms': []}
    for relative in SOURCE_FILES:
        source = (REPOSITORY / relative).read_text(encoding='utf-8-sig').replace('\r\n', '\n')
        result['sources'].append({'path': relative, 'sha256': hashlib.sha256(source.encode('utf-8')).hexdigest()})
    text = (REPOSITORY / SOURCE_FILES[0]).read_text(encoding='utf-8')
    pack_id = None
    section = ''
    for line_number, line in enumerate(text.splitlines(), 1):
        # Chapters III–IX refer back to IDs; they do not define new entries.
        if line.startswith('# III.'):
            break
        if line.startswith('#'):
            section = line.lstrip('# ').strip()
        heading = re.match(r'^## (\d+)\. (.+) `([^`]+)`$', line)
        if heading:
            pack_id = heading[3]
            result['packs'].append({'id': pack_id, 'label': heading[2], 'source_line': line_number})
        if not line.startswith('| P'):
            continue
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        identifier = re.search(r'`([^`]+)`', cells[1])
        if not identifier:
            continue
        identifier = identifier[1]
        if not re.match(r'^(SET-|LOT-|FP-|RF-|MAT-|.+-[BS]\d+$)', identifier):
            continue
        label = re.search(r'\*\*(.+?)\*\*', cells[1])
        result['entries'].append({
            'id': identifier, 'priority': cells[0],
            'label': label[1] if label else cells[2],
            'pack_id': pack_id if re.search(r'-[BS]\d+$', identifier) else None,
            'section': section, 'columns': cells[2:],
            'source_line': line_number, 'source_text': line,
        })
    companion = (REPOSITORY / SOURCE_FILES[1]).read_text(encoding='utf-8')
    section = ''
    for line_number, line in enumerate(companion.splitlines(), 1):
        if line.startswith('## '):
            section = line[3:]
        if section.startswith(('2.1.', '2.2.', '2.4.', '2.5.')) and line.startswith('- **'):
            label, description = re.match(r'^- \*\*(.+?)\*\*\s*[—–-]\s*(.+)$', line).groups()
            result['functional_forms'].append({
                'label': label, 'description': description,
                'section': section, 'source_line': line_number,
            })
    ids = [entry['id'] for entry in result['entries']]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate source IDs')
    return json.dumps(result, ensure_ascii=False, indent=2) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = extract()
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text(encoding='utf-8') != content:
            raise SystemExit('Source inventory is stale: run python rust/scripts/house-source.py')
    else:
        DESTINATION.parent.mkdir(parents=True, exist_ok=True)
        DESTINATION.write_text(content, encoding='utf-8', newline='\n')
    data = json.loads(content)
    print(f"{len(data['packs'])} packs; " + '; '.join(
        f"{sum(bool(re.match(pattern, e['id'])) for e in data['entries'])} {name}"
        for name, pattern in [('B', r'.+-B\d+$'), ('FP', r'FP-'), ('RF', r'RF-'), ('MAT', r'MAT-')]
    ))
