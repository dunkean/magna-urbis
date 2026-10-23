"""Compare a top orthographic raw-ground GPU diagnostic to independent CPU bilerp.
Usage: python compare_ground_mean.py packet.surfacebin image.png report.json [x z widthM]
Requires numpy and Pillow. No input or canonical data is edited.
"""
import json,struct,sys,hashlib
from pathlib import Path
import numpy as np
from PIL import Image
packet_path,image_path,report_path=map(Path,sys.argv[1:4]);focus_x,focus_z,width_m=map(float,sys.argv[4:7]) if len(sys.argv)>4 else (20000.,20000.,10000.)
b=packet_path.read_bytes();assert b[:8]==b'MUFSURF1';ml=struct.unpack_from('<I',b,8)[0];m=json.loads(b[16:16+ml]);off=(16+ml+7)//8*8;world=m['value']['world'];grid=world['terrain']
d=next(d for d in m['arrays'] if d['path']==['world','fields','groundMaterialMeanColor']);assert d['dtype']=='u32'
packed=np.frombuffer(b,dtype='<u4',count=d['length'],offset=off+d['offset']);rgb=np.stack([packed&255,packed>>8&255,packed>>16&255],-1).astype(float)/255
linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4).reshape(grid['height'],grid['width'],3)
im=np.asarray(Image.open(image_path))[:,:,:3];height,width=im.shape[:2];pixel_m=width_m/width
x=(focus_x-width_m/2+(np.arange(width)+.5)*pixel_m-grid['originX'])/grid['spacingM'];z=(focus_z-height*pixel_m/2+(np.arange(height)+.5)*pixel_m-grid['originZ'])/grid['spacingM']
valid=(z[:,None]>=0)&(z[:,None]<=grid['height']-1)&(x[None,:]>=0)&(x[None,:]<=grid['width']-1)
x=np.clip(x,0,grid['width']-1.00001);z=np.clip(z,0,grid['height']-1.00001);cx=np.floor(x).astype(int);cz=np.floor(z).astype(int);fx=x-cx;fz=z-cz
expected=(linear[cz[:,None],cx[None,:]]*(1-fz[:,None,None])*(1-fx[None,:,None])+linear[cz[:,None],cx[None,:]+1]*(1-fz[:,None,None])*fx[None,:,None]+linear[cz[:,None]+1,cx[None,:]]*fz[:,None,None]*(1-fx[None,:,None])+linear[cz[:,None]+1,cx[None,:]+1]*fz[:,None,None]*fx[None,:,None])
expected=np.where(expected<=.0031308,expected*12.92,1.055*np.maximum(expected,0)**(1/2.4)-.055)*255;error=np.abs(im.astype(float)-expected)[valid]
reference_path=report_path.with_suffix('.cpu-reference.png');Image.fromarray(np.uint8(np.clip(np.round(expected),0,255))).save(reference_path)
report={'passed':float(error.max())<=1.0,'meanByteError':float(error.mean()),'maximumByteError':float(error.max()),'sourceWorldId':world['id'],'sourceId':grid['source']['id'],'sourceVersion':grid['source']['version'],'surfaceLayers':world['surfaceLayers'],'sourcePacketSha256':hashlib.sha256(b).hexdigest(),'gpuImageSha256':hashlib.sha256(image_path.read_bytes()).hexdigest(),'focus':[focus_x,focus_z],'widthM':width_m,'pixelMetres':pixel_m,'comparedPixels':int(valid.sum()),'scope':'Independent exact canonical groundMean bilinear reconstruction versus a saved unlit raw-ground top-view GPU image, with urban/water/canopy objects hidden; excludes lighting, geometryDetail and source upsampling claims.'}
report_path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));sys.exit(0 if report['passed'] else 1)
