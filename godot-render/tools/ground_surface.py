"""N1--N4 surface information and visible-ground classification for Godot.

Uses retained DEM/hydrology/ground data, never the rendered map colours.
All 90 catalogue types have explicit rules. Scores are continuous; six slots
retain two rock profiles, one fragment recipe and three matrix/context recipes.
Their normalization preserves exposed-rock / fragment / matrix budgets.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import gzip
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, shift
from surface_context import ROOT, ROCK_FIELDS, digest, read_json, write_json, load_hydrology

VERSION = 2
TYPE_IDS = ([f'B{i:02}' for i in range(1, 13)] + [f'S{i:02}' for i in range(1, 7)] +
            [f'G{i:02}' for i in range(1, 7)] + [f'R{i:02}' for i in range(1, 23)] +
            [f'F{i:02}' for i in range(1, 13)] + [f'P{i:02}' for i in range(1, 17)] +
            [f'H{i:02}' for i in range(1, 7)] + [f'N{i:02}' for i in range(1, 9)] + ['I01', 'I02'])
INDEX = {name: i for i, name in enumerate(TYPE_IDS)}
STATES = {'mean': 0., 'dry': -.28, 'wet': .24}


def ramp(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def load_archive(directory, schema, n):
    blob = gzip.decompress((directory / schema['file']).read_bytes())
    types = {'Float32Array': '<f4', 'Uint8Array': 'u1', 'Int32Array': '<i4'}
    return {k: np.frombuffer(blob, types[v['type']], count=n*n, offset=v['offset']).reshape(n, n)
            for k, v in schema['fields'].items()}


def distance(mask, cell, width, signed=False):
    if not mask.any():
        return np.full(mask.shape, width, np.float32)
    d = distance_transform_edt(~mask, sampling=cell)
    if signed:
        d -= distance_transform_edt(mask, sampling=cell)
    return d.astype(np.float32)


def smooth_appearance(value, mask, sigma):
    """Normalized physical-distance filter; permanent water is not a donor."""
    weight=gaussian_filter(np.asarray(mask,np.float32),sigma,mode='nearest')
    result=gaussian_filter(np.asarray(value,np.float32)*mask,sigma,mode='nearest')/np.maximum(weight,1.e-6)
    return np.where(weight>1.e-6,result,value).astype(np.float32)


def ambient_occlusion(height, cell):
    """Eight local terrain horizons; ambient-only shading, no fake sun shadow."""
    occlusion=np.zeros_like(height)
    for dy,dx in [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]:
        horizon=np.zeros_like(height)
        for radius in (120,400,1200):
            length=np.hypot(dx,dy)
            neighbour=shift(height,(dy/length*radius/cell,dx/length*radius/cell),order=1,mode='nearest',prefilter=False)
            horizon=np.maximum(horizon,np.arctan2(neighbour-height,radius))
        occlusion+=np.sin(horizon)**2/8
    return np.clip(1-.7*occlusion,.3,1).astype(np.float32)


def derive(fields, hydro, height, meta, river):
    n, width = meta['n'], meta['width']
    cell = width/n
    slope = fields['slope']
    land = ~(hydro['sea'].astype(bool) | hydro['lake'].astype(bool))
    moisture=smooth_appearance(fields['moisture'],land,110/cell)
    organic=smooth_appearance(fields['organic'],land,85/cell)
    steep = ramp(8, 47, slope)
    alteration = np.clip(fields['weatherability'] * (.35 + moisture), 0, 1)
    # Effective cover is bounded jointly; soil and deposit depth are not blindly
    # subtracted, as they partly describe the same mantle.
    mantle = np.maximum(fields['soilDepth'], .45*fields['depositDepth'])
    exposed = np.clip((.12 + .82*steep + .22*fields['stoniness']) * np.exp(-mantle/1.1), .005, .96)
    rough = np.clip(.12 + .62*steep + .26*fields['stoniness'] + .1*ramp(0, 20, fields['tpi150']), 0, 1)
    loose = np.clip((.08 + .70*fields['stoniness'] + .28*fields['colluvialPotential']) * (1-exposed), 0, 1-exposed)
    matrix = 1-exposed-loose
    fluvial = np.clip(fields['alluvialPotential'], 0, 1)
    transported = np.stack([fields['upstream'+s] for s in ('Granite','Limestone','Sandstone','Marl','Basalt')], axis=-1)
    local = np.stack([fields[s] for s in ROCK_FIELDS], axis=-1)
    source = local*(1-fluvial[..., None])+transported*fluvial[..., None]
    source /= np.maximum(source.sum(axis=-1, keepdims=True), 1.e-6)
    sand_free = matrix * fields['sand'] * np.clip(.10+.85*fields['aeolianPotential']+.9*fluvial+.7*fields['coastalPotential'],0,1)
    rounded = ramp(.12, .8, fluvial) * np.exp(-slope/22)
    gravel_share = .35 + .5*(1-steep)
    stones_share = (1-gravel_share)*(.80-.35*steep)
    blocks_share = 1-gravel_share-stones_share
    sea, lake = hydro['sea'].astype(bool), hydro['lake'].astype(bool)
    river_mask = river>.02
    dr = distance(river_mask,cell,width,True)
    dl = distance(lake,cell,width,True)
    ds = distance(sea,cell,width,True)
    relative = np.nan_to_num(fields['hand'],nan=width)
    bank = np.exp(-np.maximum(dr,0)/65)*np.exp(-relative/5)*np.exp(-slope/12)*land*(1-river)
    temp = meta['temperature']-.006*np.maximum(height,0)
    stable = np.exp(-slope/28)
    # Explicit appearance potential, not an inferred exact canopy inventory.
    productive = ramp(.22,.66,moisture)*ramp(-7,10,temp)*stable
    forest = np.clip(productive*(.35+.65*ramp(.025,.12,organic)),0,.92)
    herb = np.clip((.18+.68*ramp(.13,.6,moisture))*ramp(-13,5,temp)*stable*(1-.45*forest),0,.96)
    moss = np.clip(ramp(.55,.9,moisture)*(.25+.75*stable)*ramp(-12,4,temp),0,.8)
    snow_retention = np.clip((1-.7*steep)*(.65+.35*ramp(-10,10,-fields['tpi150'])),0,1)
    wet = np.maximum(river, (sea|lake).astype(np.float32))
    cover_potential=1-(1-.95*forest)*(1-.98*herb)*(1-.85*moss)
    surface_cover=(.96*ramp(.08,.65,cover_potential)*(1-ramp(.16,.70,exposed))
                   *(1-.5*ramp(26,55,slope))*land*(1-river))
    f = dict(exposedRock=exposed, matrixCover=matrix, fragmentCover=loose, structuralRoughness=rough,
             looseSand=sand_free, looseFines=np.maximum(0,matrix-sand_free),
             looseGravel=loose*gravel_share, looseStones=loose*stones_share, looseBlocks=loose*blocks_share,
             grainSizeMm=2+90*rough+160*steep*fields['colluvialPotential'], roundness=rounded,
             distanceRiver=dr, distanceLake=dl, distanceSea=ds, riverFootprint=river,
             waterCoverage=wet, riverConnected=ramp(0,.8,fluvial)*(fields['handReferenceKind']==1),
             emergedBank=bank, temperatureLocal=temp, forestPotential=forest, herbPotential=herb,
             mossPotential=moss, snowRetention=snow_retention, meanWetness=moisture,
             alteration=alteration, ambientOcclusion=ambient_occlusion(height,cell), surfaceCover=surface_cover)
    for i,s in enumerate(('Granite','Limestone','Sandstone','Marl','Basalt')):
        f['depositSource'+s]=source[...,i]
    return {k:np.asarray(v,np.float32) for k,v in f.items()},land


def scores_for_chunk(g, f, state, climate, appearance=None):
    """Continuous zone recipes. Group normalization precedes support budgets."""
    shape=f['exposedRock'].shape
    scores=np.zeros((*shape,90),np.float32)
    wet=np.clip(f['meanWetness']+STATES[state],0,1)
    dry=1-wet
    t=f['temperatureLocal'];hot=ramp(17,29,t);cold=1-ramp(-4,10,t)
    rough=f['structuralRoughness'];alt=f['alteration'];slope=g['slope']
    fine=g['clay'];sand=g['sand'];organic=ramp(.02,.13,g['organic'])
    forest=f['forestPotential'];herb=f['herbPotential'];moss=f['mossPotential']
    # Typed supply supports physical recipes; no sand/rounded pebbles from
    # aridity alone. Surface contexts consume only their compatible support.
    def group(names, values, budget):
        a=np.stack([np.broadcast_to(v,shape) for v in values],axis=-1).astype(np.float32)
        a=np.maximum(a,0)
        if appearance is not None:a*=np.array([appearance[INDEX[name]] for name in names],np.float32)
        a/=np.maximum(a.sum(axis=-1,keepdims=True),1.e-9)
        for i,name in enumerate(names):scores[...,INDEX[name]]+=a[...,i]*budget
    rock=f['exposedRock'];fragments=f['fragmentCover'];matrix=f['matrixCover']
    colonized=np.clip(moss*.45,0,.4)
    exposure=ramp(18,48,slope)
    base_profiles=[(1-alt)*(1-rough),(1-alt)*rough*(1-exposure),(1-alt)*rough*exposure,alt]
    # R09/R10/R11/R12 are structured/compact/altered/fractured respectively;
    # R13--R16 and R17--R20 have their own corresponding ordering.
    orders=[[0,1,2,3],[0,1,2,3],[1,0,3,2],[0,1,2,3],[0,2,1,3]]
    for parent in range(5):
        group([f'R{parent*4+i+1:02}' for i in range(4)], [base_profiles[i] for i in orders[parent]],
              rock*g[ROCK_FIELDS[parent]]*(1-colonized))
    group(['R21','R22'],[wet,1-wet],rock*colonized)
    rounded=f['roundness'];size=f['grainSizeMm']
    group([f'G{i:02}' for i in range(1,7)],[(1-rounded)*(1-ramp(20,80,size)),(1-rounded)*ramp(20,80,size),rounded*(1-ramp(25,90,size)),rounded*ramp(25,90,size),.5*(1-rough),rough*.5],fragments)
    sandy=np.clip(f['looseSand']/np.maximum(matrix,.001),0,.9)
    group([f'S{i:02}' for i in range(1,7)],[dry*(1-hot),dry*hot,.4*g['stoniness'],wet*wet,dry*g['aeolianPotential'],.18*(1-rough)],matrix*sandy)
    available=matrix*(1-sandy)
    # Contexts compete on compatible matrix, rather than erasing exposed rock.
    cover=np.stack([.2+dry*.55,forest,herb,moss*.55],axis=-1)
    cover/=cover.sum(axis=-1,keepdims=True)
    bare,fb,pb,hb=[available*cover[...,i] for i in range(4)]
    group([f'B{i:02}' for i in range(1,13)],
          [.30*(1-organic),organic,.9*g['silt']*(1-fine),fine*(1-dry*.6),fine*dry**3*(1 if state=='dry' else 0),dry*(1-sand)*.3,.3*rough,.6*g['stoniness'],wet**4*1.5,fine*dry**3*(1 if state=='dry' else 0),hot*dry*.25,alt*.35],bare)
    conifer=np.clip(cold+.12,0,1);leaf=1-conifer;rocky=g['stoniness']
    group([f'F{i:02}' for i in range(1,13)],
          [leaf*dry,leaf*dry*.35,leaf*wet**2,conifer*.8,conifer*sand, .30,rocky*.6,moss*.8,rocky*rough*.25,(1-organic)*.2,hot*dry*.6,hot*wet*.6],fb)
    seasonal=hot*(1-ramp(.7,1.5,climate))
    group([f'P{i:02}' for i in range(1,17)],
          [wet*(1-cold)*(1-hot),.3*(1-rough)*wet,wet*.4,.3*wet*hot,wet**2*.3,dry**2,.4*dry*(1-rocky),dry**2*(1-hot),cold*dry*rocky,seasonal*wet,seasonal*dry,seasonal*dry*.4,seasonal*rocky,cold*(1-moss),cold*moss,(1-hot)*.2],pb)
    group([f'H{i:02}' for i in range(1,7)],
          [herb*wet,organic*wet,moss*wet,moss*forest,moss*rocky,f['emergedBank']*wet],hb)
    # Snow/ice are explicit runtime N4 overlays, not silently generated here.
    # Their rules and indices are shared with the viewer's declared presets.
    assert np.all(np.isfinite(scores))
    return scores


def quantize_simplex(probabilities,total=255):
    """Largest remainder, with either a scalar or a per-pixel integer total."""
    target=np.asarray(total)
    scaled=probabilities*(target[...,None] if target.ndim else target)
    quant=np.floor(scaled).astype(np.int16)
    for _ in range(probabilities.shape[-1]):
        missing=target-quant.sum(axis=-1)
        best=np.argmax(scaled-quant,axis=-1)
        yy,xx=np.indices(best.shape);quant[yy,xx,best]+=(missing>0)
    return quant


def classify(g,f,state,climate,appearance=None,cell=30.):
    n=f['exposedRock'].shape[0]
    ids=np.zeros((n,n,8),np.uint8);weights=np.zeros_like(ids)
    cover_ids=np.zeros((n,n,4),np.uint8);cover_weights=np.zeros_like(cover_ids)
    retained=[]
    sigma=75/cell
    halo=int(np.ceil(sigma*4))
    for start in range(0,n,64):
        stop=min(n,start+64)
        begin=max(0,start-halo);end=min(n,stop+halo)
        s=scores_for_chunk({k:v[begin:end] for k,v in g.items()}, {k:v[begin:end] for k,v in f.items()},state,climate,appearance)
        # Blend probabilities before reducing their rank. Never blur class IDs.
        # Only surface appearance is filtered; water footprints and N1 budgets
        # remain the original local authority.
        matrix_mask=np.ones(90,bool);matrix_mask[INDEX['G01']:INDEX['R22']+1]=False
        ms=s[...,matrix_mask]
        ms=gaussian_filter(ms,(sigma,sigma,0),mode='nearest')
        s[...,matrix_mask]=ms
        s=s[start-begin:stop-begin]
        rock_scores=s[...,INDEX['R01']:INDEX['R22']+1]
        rt=np.argsort(-rock_scores,axis=-1,kind='stable')[...,:2]+INDEX['R01']
        gt=np.argmax(s[...,INDEX['G01']:INDEX['G06']+1],axis=-1)+INDEX['G01']
        matrix_scores=s.copy();matrix_scores[...,INDEX['G01']:INDEX['R22']+1]=0
        matrix_scores[...,INDEX['F01']:]=0
        matrix_rank=np.argsort(-matrix_scores,axis=-1,kind='stable')[...,:4]
        mt=matrix_rank[...,:3]
        top=np.concatenate([rt,gt[...,None],mt],axis=-1)
        w=np.take_along_axis(s,top,axis=-1)
        retained.append(float(w.sum(axis=-1).mean()))
        rock_budget=f['exposedRock'][start:stop];fragment_budget=f['fragmentCover'][start:stop]
        w[...,:2]*=rock_budget[...,None]/np.maximum(w[...,:2].sum(axis=-1,keepdims=True),1.e-9)
        w[...,2]=fragment_budget
        cutoff=np.take_along_axis(matrix_scores,matrix_rank[...,3:4],axis=-1)
        tapered=np.maximum(w[...,3:]-cutoff,0)
        w[...,3:]=np.where(tapered.sum(axis=-1,keepdims=True)>1.e-9,tapered,w[...,3:])
        w[...,3:]*=f['matrixCover'][start:stop][...,None]/np.maximum(w[...,3:].sum(axis=-1,keepdims=True),1.e-9)
        w/=np.maximum(w.sum(axis=-1,keepdims=True),1.e-9)
        # Quantize the three support budgets first, then their internal slots.
        # Group errors stay below one byte even with three matrix recipes.
        group_budget=quantize_simplex(np.stack([rock_budget,fragment_budget,f['matrixCover'][start:stop]],axis=-1))
        quant=np.zeros_like(w,dtype=np.int16)
        quant[...,:2]=quantize_simplex(w[...,:2]/np.maximum(w[...,:2].sum(axis=-1,keepdims=True),1.e-9),group_budget[...,0])
        quant[...,2]=group_budget[...,1]
        quant[...,3:]=quantize_simplex(w[...,3:]/np.maximum(w[...,3:].sum(axis=-1,keepdims=True),1.e-9),group_budget[...,2])
        ids[start:stop,:,:6]=top;weights[start:stop,:,:6]=quant.astype(np.uint8)
        # Litter / low herb / moss are an upper surface, separate from support.
        # Keep the three context budgets, rather than making forest and grass
        # fight for a top-k slot. Rank changes must not recreate sharp biomes.
        context_ranges=[(INDEX['F01'],INDEX['F12']+1),(INDEX['P01'],INDEX['P16']+1),(INDEX['H01'],INDEX['H06']+1)]
        cr=np.stack([np.argmax(s[...,lo:hi],axis=-1)+lo for lo,hi in context_ranges],axis=-1)
        cw=np.stack([s[...,lo:hi].sum(axis=-1) for lo,hi in context_ranges],axis=-1)
        cover_possible=cw.sum(axis=-1)>1.e-9
        cw[...,0]+=~cover_possible
        cw/=np.maximum(cw.sum(axis=-1,keepdims=True),1.e-9)
        cq=quantize_simplex(cw)
        coverage=f.get('surfaceCover',np.zeros_like(f['matrixCover']))[start:stop]
        coverage=np.clip(coverage*(.82 if state=='dry' else (1.05 if state=='wet' else 1)),0,1)*cover_possible
        cover_ids[start:stop,:,:3]=cr
        cover_weights[start:stop,:,:3]=cq.astype(np.uint8)
        cover_weights[start:stop,:,3]=np.rint(coverage*255).astype(np.uint8)
    return ids,weights,float(np.mean(retained)),cover_ids,cover_weights


def save_archive(directory, fields):
    name='surface-grids.bin.gz';schema={};offset=0
    with gzip.GzipFile(filename=str(directory/name),mode='wb',compresslevel=2,mtime=0) as out:
        for key,value in fields.items():
            blob=np.asarray(value,dtype='<f4').tobytes();out.write(blob)
            schema[key]={'offset':offset,'bytes':len(blob),'type':'Float32Array'};offset+=len(blob)
    return {'file':name,'sha256':digest((directory/name).read_bytes()),'fields':schema,'endianness':'little'}


def render_diagnostics(directory,f,land):
    specs=[('n1-support','N1 · Support visible','Support : roche rouge, fragments ocre, matrice verte.',None),
           ('n1-roughness','N1 · Rugosité structurelle','Rugosité du support, indépendante des micro-normales PBR.','structuralRoughness'),
           ('n2-supply','N2 · Stocks meubles','Sable rouge, fines vertes, fragments bleus ; stocks distincts des fractions sable/limon/argile.',None),
           ('n2-roundness','N2 · Arrondi des fragments','Arrondi potentiel conditionné par la provenance fluviale et le relief.','roundness'),
           ('n3-river','N3 · Distance rivière','Distance signée aux polygones des rivières vectorielles ; saturation 1 km.','distanceRiver'),
           ('n3-lake','N3 · Distance lac','Distance signée au masque lacustre conservé ; saturation 1 km.','distanceLake'),
           ('n3-sea','N3 · Distance mer','Distance signée au masque marin conservé ; saturation 1 km.','distanceSea'),
           ('n3-banks','N3 · Berges émergées potentielles','Hors empreinte mouillée : proximité du tronçon, HAND faible et faible pente. Potentiel, pas banc observé.','emergedBank'),
           ('n4-wetness','N4 · Humidité moyenne','État moyen local ; la vue texturée propose aussi Sec et Humide.','meanWetness'),
           ('n4-snow','N4 · Rétention de neige','Rétention topographique ; active seulement avec un preset neige explicite.','snowRetention'),
           ('cover-forest','Sol visible · Contexte forestier','Préférence d’apparence dérivée du climat, du relief et de l’organique ; pas inventaire de canopée.','forestPotential'),
           ('surface-cover','Surface · Couverture du sol','Couverture au-dessus du support : litière, herbe et mousse. Les affleurements exposés et les eaux restent dégagés.','surfaceCover'),
           ('render-snow','Surface · Neige du Render','Couverture exportée directement du shader Render avant éclairage. Superposée par défaut au sol et à sa couverture.','renderSnow')]
    layers=[]
    for key,label,legend,field in specs:
        rgba=np.zeros((*land.shape,4),np.uint8)
        if key=='n1-support':
            rgb=np.stack([f['exposedRock']+.7*f['fragmentCover'],f['matrixCover']+.4*f['fragmentCover'],.15*f['fragmentCover']],axis=-1)
        elif key=='n2-supply':
            rgb=np.stack([f['looseSand'],f['looseFines'],f['fragmentCover']],axis=-1)
        else:
            v=f[field]
            if key.startswith('n3-') and key!='n3-banks':v=np.clip(v/1000,0,1)
            rgb=np.stack([.75-.5*v,.5+.15*v,.25+.55*v],axis=-1)
        rgba[...,:3]=np.clip(rgb*255,0,255).astype(np.uint8);rgba[...,3]=land*255
        # Keep previews in their own namespace, away from canonical masks.
        file='surface-info-'+key+'.png';Image.fromarray(rgba).save(directory/file,compress_level=2)
        layers.append({'id':key,'label':label,'legend':legend,'file':file,'sha256':digest((directory/file).read_bytes()),'filter':'linear','palette':[]})
    return layers


def compile_tile(root,entry,compiler,catalogue_hash,force=False):
    directory=(root/entry['file']).parent;meta=read_json(directory/'tile.json');n=meta['n']
    sources={'compiler':compiler,'catalogue':catalogue_hash,'ground':meta['ground']['grids']['sha256'],
             'height':meta['heightSha256'],'vectorWater':digest((directory/meta['hydrology']['svg']).read_bytes()),
             'riverMask':digest((directory/'surface-river-footprint.png').read_bytes()),
             'renderSnow':digest((directory/'surface-render-snow.png').read_bytes())}
    identity=digest(json.dumps(sources,sort_keys=True).encode())
    if not force and meta.get('groundSurface',{}).get('identity')==identity:
        files=meta['groundSurface']['files']
        if all((directory/v).exists() for v in files):return meta
    started=time.perf_counter();g=load_archive(directory,meta['ground']['grids'],n)
    hydro=load_hydrology(directory,meta)
    height=np.frombuffer((directory/meta['height']).read_bytes(),'<f4').reshape(n,n)
    with Image.open(directory/'surface-river-footprint.png') as im:
        river=np.asarray(im.getchannel('A').resize((n,n),Image.Resampling.BOX),np.float32)/255
    f,land=derive(g,hydro,height,meta,river)
    with Image.open(directory/'surface-render-snow.png') as image:
        f['renderSnow']=np.asarray(image.getchannel('R').resize((n,n),Image.Resampling.BOX),np.float32)/255
    layers=render_diagnostics(directory,f,land);archive=save_archive(directory,f)
    states={};files=[archive['file'],'surface-river-footprint.png','surface-render-snow.png','surface-render-snow.json']+[l['file'] for l in layers]
    # A single, saved appearance profile resolves unmeasured preferences such
    # as dense/rase litter or grass. It is independent of the texture reroll.
    appearance=[.55+1.45*int.from_bytes(hashlib.sha256((str(meta['seed'])+'|cover-profile-v1|'+key).encode()).digest()[:4],'little')/4294967295 for key in TYPE_IDS]
    for state in STATES:
        ids,w,retained,ci,cw=classify(g,f,state,meta['hydrology']['runoff']['aridity'],appearance,meta['width']/n)
        names={'indices':f'surface-{state}-indices.png','weights':f'surface-{state}-weights.png',
               'indicesExtra':f'surface-{state}-indices-extra.png','weightsExtra':f'surface-{state}-weights-extra.png',
               'coverIndices':f'surface-{state}-cover-indices.png','coverWeights':f'surface-{state}-cover-weights.png'}
        for key,values in [('indices',ids[...,:4]),('weights',w[...,:4]),('indicesExtra',ids[...,4:]),('weightsExtra',w[...,4:]),('coverIndices',ci),('coverWeights',cw)]:
            Image.fromarray(values).save(directory/names[key],compress_level=2)
        # RGBA channels here are numeric data, not sRGB colour.
        coverage=cw[...,3:4].astype(np.float32)/255
        combined_ids=np.concatenate([ids[...,:6],ci[...,:3],np.full((n,n,1),INDEX['N01'],np.uint8)],axis=-1)
        snow=f['renderSnow'][...,None]
        combined_weights=np.concatenate([w[...,:6].astype(np.float32)/255*(1-coverage)*(1-snow),cw[...,:3].astype(np.float32)/255*coverage*(1-snow),snow],axis=-1)
        dominant=np.take_along_axis(combined_ids,np.argmax(combined_weights,axis=-1)[...,None],axis=-1)[...,0]
        states[state]={**names,'retainedScoreMean':retained,
                       'hashes':{k:digest((directory/v).read_bytes()) for k,v in names.items()},
                       'typeCounts':{TYPE_IDS[i]:int(c) for i,c in enumerate(np.bincount(dominant[land].ravel(),minlength=90)) if c}}
        files+=list(names.values())
    attributes=np.stack([f['meanWetness'],np.clip((f['temperatureLocal']+30)/70,0,1),f['snowRetention'],np.mod(g['structureAzimuth'],180)/180],axis=-1)
    Image.fromarray(np.clip(attributes*255,0,255).astype(np.uint8)).save(directory/'surface-attributes.png',compress_level=2)
    files.append('surface-attributes.png')
    angle=np.radians(g['structureAzimuth']*2)
    structure=np.stack([.5+.5*np.cos(angle),.5+.5*np.sin(angle),f['ambientOcclusion']],axis=-1)
    Image.fromarray(np.clip(structure*255,0,255).astype(np.uint8)).save(directory/'surface-structure.png',compress_level=2)
    files.append('surface-structure.png')
    # Explicit water authority: R river coverage, G lake, B sea, A any water.
    water=np.stack([river,hydro['lake'],hydro['sea'],f['waterCoverage']],axis=-1)
    Image.fromarray(np.clip(water*255,0,255).astype(np.uint8)).save(directory/'surface-water.png',compress_level=2);files.append('surface-water.png')
    meta['groundSurface']={'version':VERSION,'identity':identity,'sources':sources,'n':n,'width':meta['width'],
        'grids':archive,'layers':layers,'states':states,'typeIds':TYPE_IDS,'attributes':'surface-attributes.png',
        'water':'surface-water.png','riverFootprint':'surface-river-footprint.png','files':files,
        'structure':'surface-structure.png',
        'renderSnow':'surface-render-snow.png','renderSnowSource':read_json(directory/'surface-render-snow.json'),
        'appearanceFilterMetres':{'wetness':110,'organic':85,'matrixScores':75},'materialSlots':6,
        'coverSlots':3,'compositionOrder':['mineral-support','litter-herb-moss-surface','render-snow-or-declared-state'],
        'statePresets':['mean','dry','wet','fresh-snow','rough-snow','compact-snow','old-snow','wind-snow','partial-snow','melt','ice-fine','ice-fractured'],
        'attributeChannels':['meanWetness','temperatureLocalEncodedMinus30To40C','snowRetention','structureAzimuthEncoded0To180Degrees'],
        'coverOrigin':'derived-appearance-potential-not-measured-canopy','supportQuantization':'two-rock-one-fragment-three-matrix-budget-preserved-largest-remainder-255',
        'appearanceProfile':dict(zip(TYPE_IDS,appearance)), 'dryPresetDeclaresDryingCycle':True,
        'limitations':['Synthetic support and material supply; no sediment mass balance.',
                        'Emergent bank potential, not an observed exposed-bar inventory.',
                        'Default snow is retained Render coverage; other snow/ice states are appearance presets, without glacial history.'],
        'generationSeconds':round(time.perf_counter()-started,2)}
    write_json(directory/'tile.json',meta)
    print(f'SURFACE {meta["id"]}: {meta["groundSurface"]["generationSeconds"]}s',flush=True)
    return meta


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,default=ROOT)
    parser.add_argument('--tile');parser.add_argument('--force',action='store_true');parser.add_argument('--workers',type=int,default=2);args=parser.parse_args()
    root=args.out.resolve();catalog=read_json(root/'catalog.json')
    compiler=digest(Path(__file__).read_bytes());ch=digest((Path(__file__).resolve().parents[1]/'ground_texture_catalogue.json').read_bytes())
    entries=[entry for entry in catalog['tiles'] if not args.tile or entry['id']==args.tile]
    if not entries:parser.error('Unknown tile: '+str(args.tile))
    if args.workers<1:parser.error('workers must be positive')
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        pending={pool.submit(compile_tile,root,entry,compiler,ch,args.force):entry for entry in entries}
        for future in as_completed(pending):
            pending[future].update(future.result());write_json(root/'catalog.json',catalog)


if __name__=='__main__':
    main()
