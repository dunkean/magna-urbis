"""Reproduce the pre-mesoscale renderer snapshot for a bounded GPU comparison."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
COMMIT='69527c79913afef13d60ab9174134831b07c5957'
def main():
    target=ROOT/'evidence/meso-baseline';target.mkdir(parents=True,exist_ok=True);files=[]
    sources=['tile_viewer.gd','tile_terrain.gdshader','mesoscale.gd','shaders/terrain_detail.gdshaderinc','shaders/meso_material.gdshaderinc','shaders/surface_water.gdshaderinc','tools/prepare_mesoscale.py']
    mapping={source:Path(source).name for source in sources}
    for source,name in mapping.items():
        blob=subprocess.run(['git','show',f'{COMMIT}:godot-render/{source}'],cwd=ROOT,check=True,capture_output=True).stdout
        code=blob.decode('utf-8')
        if source!='tools/prepare_mesoscale.py':
            for old,new in mapping.items():code=code.replace('res://'+old,'res://evidence/meso-baseline/'+new)
        (target/name).write_bytes(code.encode('utf-8'))
        files.append({'source':source,'sourceSha256':hashlib.sha256(blob).hexdigest()})
    # 69527c7 and this iteration use identical native/prepared inputs. Keep
    # them shared, including the same montane field and saved PBR variants.
    (target/'source.json').write_text(json.dumps({'commit':COMMIT,'files':files},indent=2),encoding='utf-8')
    print('Prepared original baseline',COMMIT)
if __name__=='__main__':main()
