"""Contact sheet of the stored CHM windows (0..40 m grey ramp): python -I quicklook.py <chm_dir>"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

d = Path(sys.argv[1])
files = sorted((d / 'windows').glob('*.npz'))
tiles = []
for f in files:
    a = np.load(f)['chm'].astype(np.float32)
    img = Image.fromarray((np.clip(a / 40, 0, 1) * 255).astype(np.uint8)).resize((384, 384), Image.BILINEAR).convert('RGB')
    ImageDraw.Draw(img).text((4, 4), f.stem, fill=(255, 64, 64))
    tiles.append(img)
sheet = Image.new('RGB', (384 * 4, 384 * ((len(tiles) + 3) // 4)))
for i, t in enumerate(tiles):
    sheet.paste(t, (384 * (i % 4), 384 * (i // 4)))
sheet.save(d / 'quicklook' / 'sheet.png')
# Native-resolution 160 px crops show crown texture.
crops = Image.new('RGB', (320 * 4, 320 * ((len(files) + 3) // 4)))
for i, f in enumerate(files):
    a = np.load(f)['chm'].astype(np.float32)
    c = a[a.shape[0] // 2 - 80:a.shape[0] // 2 + 80, a.shape[1] // 2 - 80:a.shape[1] // 2 + 80]
    img = Image.fromarray((np.clip(c / 40, 0, 1) * 255).astype(np.uint8)).resize((320, 320), Image.NEAREST).convert('RGB')
    ImageDraw.Draw(img).text((4, 4), f.stem, fill=(255, 64, 64))
    crops.paste(img, (320 * (i % 4), 320 * (i // 4)))
crops.save(d / 'quicklook' / 'crops.png')
