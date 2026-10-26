"""CPU verification of actual prepared files, not claimed target triangle counts."""
import argparse,hashlib,io,json,struct
from pathlib import Path
import numpy as np
from PIL import Image

args=argparse.ArgumentParser();args.add_argument('--prepared',required=True);args.add_argument('--probe',required=True);options=args.parse_args()
root=Path(options.prepared);report=json.loads((root/'report.json').read_text(encoding='utf-8'));probe=json.loads(Path(options.probe).read_text(encoding='utf-8'));checks=0
def check(value,message):
    global checks
    checks+=1
    if not value:raise AssertionError(message)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
near=report['lods'][0];path=root/near['path'];data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];document=json.loads(data[20:20+length]);binary=data[28+length:]
check(data[:4]==b'glTF' and struct.unpack_from('<I',data,8)[0]==len(data),'GLB header matches bytes')
check(sha(path)==near['sha256'],'GLB hash')
actual=sum(document['accessors'][p['indices']]['count']//3 for m in document['meshes'] for p in m['primitives'])
check(actual==near['actualTriangles']==report['leafReconstruction']['actualLeafTriangles']+report['leafReconstruction']['actualBranchTriangles'] and actual<135000,'actual index counts, not the requested decimation ratio')
check(report['leafReconstruction']['componentDrops']==0,'no source leaf dropped')
check(report['leafReconstruction']['actualLeafTriangles']==2*report['leafReconstruction']['leafComponents'],'one quad per actual component')
leaf=next(m for m in document['materials'] if m['name'].endswith('-prepared-cutout'))
check(leaf['alphaMode']=='MASK' and leaf['alphaCutoff']==.5,'export cutout policy')
image_index=document['textures'][leaf['pbrMetallicRoughness']['baseColorTexture']['index']]['source'];view=document['bufferViews'][document['images'][image_index]['bufferView']]
base=Image.open(io.BytesIO(binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])).convert('RGBA')
prepared_alpha=Image.open(root/report['preparedAlpha']['path']).convert('RGBA')
check(np.array_equal(np.array(base)[:,:,3],np.array(prepared_alpha)[:,:,0]),'exported alpha is byte-exact same prepared binary texture as CPU bake')
check(set(np.unique(np.array(base)[:,:,3])).issubset({0,255}),'binary cutout alpha')
check('normalTexture' in leaf,'authored leaf NormalGL bound')
check(near['actualNormalizedBounds']['maximumHorizontalRadius']<=1.000001,'canonical root-centred crown support preserved')
check(abs(report['normalization']['sourceBottomPivot'][1])<.05,'root pivot is measured from the stem, not the leaning crown bbox')
impostor=json.loads((root/report['middleImpostor']['path']).read_text(encoding='utf-8'))
check(len(impostor['indices'])//3==impostor['triangleCount']==2,'impostor actual quad count')
check(impostor['views']==near['views'],'same derivative/views/alpha grid for near and middle')
for lod in report['lods']:
    for view in lod['views']:
        for product in view['products'].values():check(sha(root/product['path'])==product['sha256'],'bake product hash')
        if 'sharedMask' in view:
            mask=view['sharedMask'];check(sha(root/mask['path'])==mask['sha256'],'shared A8 hash');check((root/mask['path']).stat().st_size==mask['width']*mask['height'],'A8 actual grid size')
check(probe['assetMaskSha256']==near['views'][0]['sharedMask']['sha256'],'probe actually uses current prepared mask')
check(not report['runtimeEnabled'] and not report['canonicalCoverCalibrated'] and not report['selectedCoverageCalibrated'],'offline evidence does not masquerade as renderer qualification')
check(report['device']=='CPU' and report['threads']==2,'CPU preparation scope')
curve=probe['calibration']['opticalMean'];check(all(a<=b for a,b in zip(curve,curve[1:])) and curve[0]==0,'monotone optical marginal')
check(all(case['coverageAboveTargetPixels']==0 for case in probe['counts4Bins']['cases']),'same binary C/V counts bound')
print(json.dumps({'test':'prepared-tree-products','checks':checks,'result':'PASS','actualTriangles':actual,'impostorTriangles':2,'scope':'CPU file/alpha/grid/algebra evidence only; no Godot renderer or artistic acceptance'}))
