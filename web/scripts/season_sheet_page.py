"""Builds the review page of a season sheet: web/out/season-sheet/<label>/page/.

Usage, from web/: python scripts/season_sheet_page.py <label>
Satellite and parchment of one view are stacked in one WebP, so a style switch needs no second download.
"""
import json
import sys
from pathlib import Path
from PIL import Image

label = sys.argv[1]
root = Path('out/season-sheet') / label
page = root / 'page'
(page / 't').mkdir(parents=True, exist_ok=True)
meta = json.loads((root / 'meta.json').read_text(encoding='utf8'))
SEASONS, ZOOMS, STYLES = ['winter', 'spring', 'summer', 'autumn'], ['near', 'mid', 'far'], ['satellite', 'parchment']
WIDTH, HEIGHT = 1000, 714
rows, missing = [], []
for world, record in meta['worlds'].items():
    rows.append({'id': world, 'zone': record['zone'], 'relief': record['relief'], 'culture': record['culture'], 'places': len(record.get('places') or [])})
    for zoom in ZOOMS:
        for season in SEASONS:
            target = page / 't' / f'{world}-{zoom}-{season}.webp'
            sheet = Image.new('RGB', (WIDTH, HEIGHT * 2))
            for i, style in enumerate(STYLES):
                shot = root / f'{world}-{style}-{zoom}-{season}.png'
                if not shot.exists():
                    missing.append(shot.name)
                    continue
                sheet.paste(Image.open(shot).convert('RGB').resize((WIDTH, HEIGHT), Image.LANCZOS), (0, HEIGHT * i))
            sheet.save(target, 'WEBP', quality=74, method=5)
template = Path(__file__).with_name('season_sheet_page.html').read_text(encoding='utf8')
(page / 'index.html').write_text(template.replace('/*ROWS*/[]', json.dumps(rows)), encoding='utf8')
print(len(rows), 'worlds', len(list((page / 't').glob('*.webp'))), 'images', 'missing', missing[:6], sum(f.stat().st_size for f in (page / 't').glob('*.webp')) // 2**20, 'MiB')
