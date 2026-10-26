"""Correct the measured exporter RGB encoding bug without touching geometry.

The original source RGB is sRGB. Blender's combined diffuse/alpha PNG embedded
linear RGB in the glTF base-color slot, which is decoded as sRGB again. Rebuild
that PNG from pinned original RGB plus BYTE-IDENTICAL exported cutout alpha.
Old products are never overwritten; all original BIN bytes are retained.
"""
import argparse,copy,hashlib,io,json,pathlib,shutil,struct
from PIL import Image
import numpy as np
import cv2
def sha(value):return hashlib.sha256(value).hexdigest()
def parse(raw):
    assert raw[:4]==b'glTF' and struct.unpack_from('<I',raw,4)[0]==2
    n,kind=struct.unpack_from('<I4s',raw,12);assert kind==b'JSON'
    document=json.loads(raw[20:20+n]);size,kind=struct.unpack_from('<I4s',raw,20+n);assert kind==b'BIN\0'
    return document,raw[28+n:28+n+size]
def encode(document,binary):
    text=json.dumps(document,separators=(',',':')).encode();text+=b' '*((-len(text))%4);binary+=b'\0'*((-len(binary))%4)
    return b'glTF'+struct.pack('<II',2,28+len(text)+len(binary))+struct.pack('<I4s',len(text),b'JSON')+text+struct.pack('<I4s',len(binary),b'BIN\0')+binary
def decode_srgb(x):return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--prepared',type=pathlib.Path,required=True);parser.add_argument('--source-root',type=pathlib.Path,required=True);parser.add_argument('--source-manifest',type=pathlib.Path,required=True);parser.add_argument('--out',type=pathlib.Path,required=True);o=parser.parse_args()
    assert not o.out.exists(),'Output must be a NEW directory; preserve old negative products'
    assert o.prepared.resolve() not in o.out.resolve().parents,'Output cannot be inside its source'
    catalogue=json.loads(o.source_manifest.read_text());source_item=next(x for x in catalogue['sourceFiles'] if x['path']=='textures/tree_small_02_leaves_diff_1k.png')
    source_raw=(o.source_root/source_item['path']).read_bytes();assert sha(source_raw)==source_item['sha256']
    assert source_raw[24:26]==bytes([16,6]),'Expected the pinned16bit RGBA source'
    report=json.loads((o.prepared/'report.json').read_text());lod=report['lods'][0];original=(o.prepared/lod['path']).read_bytes();assert sha(original)==lod['sha256']
    document,binary=parse(original);before=copy.deepcopy(document)
    leaf=next(m for m in document['materials'] if m['name'].endswith('-prepared-cutout'));texture=document['textures'][leaf['pbrMetallicRoughness']['baseColorTexture']['index']];view_index=document['images'][texture['source']]['bufferView'];view=document['bufferViews'][view_index]
    old_png=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
    cv2.setNumThreads(1)
    old=np.asarray(Image.open(io.BytesIO(old_png)).convert('RGBA'))
    source_bgra=cv2.imdecode(np.frombuffer(source_raw,np.uint8),cv2.IMREAD_UNCHANGED);assert source_bgra.dtype==np.uint16
    source=source_bgra[:,:,[2,1,0,3]]
    assert old.shape==source.shape
    fixed=np.dstack((source[:,:,:3],old[:,:,3].astype(np.uint16)*257))
    assert np.array_equal(fixed[:,:,:3],source[:,:,:3]) and np.array_equal(fixed[:,:,3]//257,old[:,:,3])
    ok,encoded_png=cv2.imencode('.png',fixed[:,:,[2,1,0,3]],[cv2.IMWRITE_PNG_COMPRESSION,9]);assert ok
    new_png=encoded_png.tobytes()
    offset=len(binary);assert offset%4==0
    view['byteOffset']=offset;view['byteLength']=len(new_png);extended=binary+new_png;extended+=b'\0'*((-len(extended))%4);document['buffers'][0]['byteLength']=len(extended)
    corrected=encode(document,extended);decoded,new_binary=parse(corrected)
    assert new_binary[:len(binary)]==binary,'ALL original geometry/image BIN bytes must stay exact'
    for i,item in enumerate(before['bufferViews']):
        if i!=view_index:assert decoded['bufferViews'][i]==item
    for key in ['accessors','meshes','materials','nodes','scenes','textures','images','samplers']:
        assert decoded.get(key)==before.get(key),key+' changed'
    decoded_pixels=cv2.imdecode(np.frombuffer(new_binary[offset:offset+len(new_png)],np.uint8),cv2.IMREAD_UNCHANGED)[:,:,[2,1,0,3]]
    assert np.array_equal(decoded_pixels,fixed)
    selected=old[:,:,3]>=128;rgb=source[:,:,:3][selected]/65535.;prior=old[:,:,:3][selected]/255.
    proof={'policy':'pinned16bit sRGB RGB exact, normalized cutout alpha8 expanded exactly to16bit; append-only GLB BIN image replacement','sourceDiffuse':source_item,'inputGlbSha256':sha(original),'outputGlbSha256':sha(corrected),'inputEmbeddedPngSha256':sha(old_png),'outputEmbeddedPngSha256':sha(new_png),'originalBinPrefixSha256':sha(binary),'allOriginalBinBytesRetained':True,'geometryAccessorsMeshesUVNormalsTangentsMaterialsUnchanged':True,'source16bitRGBExact':True,'alpha8PlaneByteExact':True,'alphaNormalizedValuesExact':True,'originalEncodedRGBMean':rgb.mean(0).tolist(),'inputEmbeddedEncodedRGBMean':prior.mean(0).tolist(),'sourceDecodedLinearMean':decode_srgb(rgb).mean(0).tolist(),'inputEmbeddedMeanAbsoluteErrorToSourceLinear':np.abs(prior-decode_srgb(rgb)).mean(0).tolist(),'negativeProductPreserved':str(o.prepared.resolve()),'scope':'Offline encoding correction only. Source texture/canonical fields/candidates/CVmask/lookup/geometry unchanged. Does not fix roughness or normal-response differences.','imageTool':{'name':'OpenCV','version':cv2.__version__,'threads':1,'operations':'CPU PNG decode/encode only; no GPU'}}
    shutil.copytree(o.prepared,o.out);(o.out/lod['path']).write_bytes(corrected)
    previous=report['assetDigest'];lod['bytes']=len(corrected);lod['sha256']=sha(corrected);report['glbAlbedoEncodingCorrection']=proof;report['pipelineVersion']+=':srgb-glb-albedo-v1'
    report['assetDigest']=sha(json.dumps([previous,proof['sourceDiffuse']['sha256'],proof['outputGlbSha256'],proof['policy']],separators=(',',':')).encode())
    version=copy.deepcopy(report['assetVersion']);assert isinstance(version,dict)
    version.update({'pipelineVersion':report['pipelineVersion'],'geometrySha256':proof['outputGlbSha256'],'albedoEncodingPolicy':proof['policy'],'albedoSourceRGBSha256':proof['sourceDiffuse']['sha256']});report['assetVersion']=version
    (o.out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');(o.out/'albedo-correction.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'out':str(o.out),'proof':proof,'sourceAssetDigest':report['assetDigest']}))
if __name__=='__main__':main()
