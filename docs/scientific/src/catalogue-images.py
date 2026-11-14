"""One-shot: convert the 10k-town captures to 720 px webp for the styles catalogue.
Run: python -I docs/scientific/src/catalogue-images.py"""
import json
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[3]
CAP = ROOT / 'web/out/planches-styles-v7'
OUT = ROOT / 'docs/scientific/assets/cultures'
OUT.mkdir(parents=True, exist_ok=True)
ids = json.loads((ROOT / 'rust/crates/core/src/urban/catalogue.json').read_text(encoding='utf-8'))['cultures'].keys()
total = n = 0
for cid in ids:
    for d in ('ville-10k-riviere', 'ville-10k'):
        a, b = CAP / d / f'{cid}-2d-core.png', CAP / d / f'{cid}-3d-near.png'
        if a.exists() and b.exists():
            for src, view in ((a, '2d'), (b, '3d')):
                im = Image.open(src).convert('RGB')
                im = im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS)
                dst = OUT / f'{cid}-{view}.webp'
                im.save(dst, 'WEBP', quality=70, method=6)
                total += dst.stat().st_size
            n += 1
            break
print(f'{n} cultures, total {total / 1e6:.1f} MB')
