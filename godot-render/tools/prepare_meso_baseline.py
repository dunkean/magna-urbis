"""Reproduce the pre-mesoscale renderer snapshot for a bounded GPU comparison."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
COMMIT='59db3591dd0e469211553813ce144bee4a37b31d'
def main():
    target=ROOT/'evidence/meso-baseline';target.mkdir(parents=True,exist_ok=True);files=[]
    for source,name in [('tile_viewer.gd','tile_viewer.gd'),('tile_terrain.gdshader','tile_terrain.gdshader'),('shaders/terrain_detail.gdshaderinc','terrain_detail.gdshaderinc')]:
        blob=subprocess.run(['git','show',f'{COMMIT}:godot-render/{source}'],cwd=ROOT,check=True,capture_output=True).stdout
        code=blob.decode('utf-8').replace('res://tile_terrain.gdshader','res://evidence/meso-baseline/tile_terrain.gdshader').replace('res://shaders/terrain_detail.gdshaderinc','res://evidence/meso-baseline/terrain_detail.gdshaderinc')
        (target/name).write_text(code,encoding='utf-8')
        files.append({'source':source,'sourceSha256':hashlib.sha256(blob).hexdigest()})
    (target/'source.json').write_text(json.dumps({'commit':COMMIT,'files':files},indent=2),encoding='utf-8')
    print('Prepared original baseline',COMMIT)
if __name__=='__main__':main()
