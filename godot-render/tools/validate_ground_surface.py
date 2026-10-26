"""Verify the generated N1--N4 inputs, support budgets and all local PBR assets."""
import argparse
from collections import Counter
import json
from pathlib import Path
import numpy as np
from PIL import Image
from ground_surface import ROOT, TYPE_IDS, INDEX, load_archive
from surface_context import read_json, digest, write_json, load_hydrology


def validate(root,only=None):
    project=Path(__file__).resolve().parents[1]
    catalogue=read_json(project/'ground_texture_catalogue.json')
    library=read_json(project/'materials/prepared/library.json')
    assert len(library['assets'])==142 and not library['errors'] and not library['missingTypes']
    assert library['catalogueSha256']==digest((project/'ground_texture_catalogue.json').read_bytes())
    refs={a['ref'] for a in library['assets']}
    assert len(refs)==142
    for asset in library['assets']:
        assert asset['normalConvention']=='OpenGL'
        for channel in ('color','normalRoughness','height'):
            path=project/'materials/prepared'/asset[channel]
            assert digest(path.read_bytes())==asset['preparedSha256'][channel]
            with Image.open(path) as image:assert image.size==(library['size'],library['size'])
        assert all(np.isfinite(asset['meanLinear']))
    assert all(set(t['candidates'])<=refs for t in catalogue['types'])
    compiler=digest((project/'tools/ground_surface.py').read_bytes())
    catalog=read_json(root/'catalog.json');report=[];all_types=Counter()
    for entry in catalog['tiles']:
        if only and entry['id']!=only:continue
        directory=(root/entry['file']).parent;meta=read_json(directory/'tile.json');s=meta['groundSurface']
        assert entry['groundSurface']==s,'Catalogue mismatch'
        assert s['version']==2 and s['materialSlots']==6 and s['coverSlots']==3 and s['typeIds']==TYPE_IDS and len(s['layers'])==13
        assert s['sources']['compiler']==compiler and s['sources']['catalogue']==library['catalogueSha256']
        assert digest((directory/meta['height']).read_bytes())==s['sources']['height']==meta['heightSha256']
        assert s['sources']['ground']==meta['ground']['grids']['sha256']
        assert s['sources']['vectorWater']==digest((directory/meta['hydrology']['svg']).read_bytes())
        assert s['sources']['riverMask']==digest((directory/s['riverFootprint']).read_bytes())
        assert s['sources']['renderSnow']==digest((directory/s['renderSnow']).read_bytes())==s['renderSnowSource']['sha256']
        assert s['renderSnowSource']['heightSha256']==meta['heightSha256']
        assert digest((directory/s['grids']['file']).read_bytes())==s['grids']['sha256']
        assert all((directory/file).exists() for file in s['files'])
        f=load_archive(directory,s['grids'],meta['n']);hydro=load_hydrology(directory,meta)
        for key,a in f.items():assert np.all(np.isfinite(a)),key
        np.testing.assert_allclose(f['exposedRock']+f['fragmentCover']+f['matrixCover'],1,atol=2.e-6)
        np.testing.assert_allclose(f['looseGravel']+f['looseStones']+f['looseBlocks'],f['fragmentCover'],atol=2.e-6)
        np.testing.assert_allclose(f['looseSand']+f['looseFines'],f['matrixCover'],atol=2.e-6)
        for key in ('exposedRock','matrixCover','fragmentCover','structuralRoughness','roundness','waterCoverage','snowRetention','riverConnected'):
            assert np.all((f[key]>=0)&(f[key]<=1)),key
        np.testing.assert_allclose(sum(f['depositSource'+key] for key in ('Granite','Limestone','Sandstone','Marl','Basalt')),1,atol=2.e-6)
        assert np.all(f['distanceSea'][hydro['sea'].astype(bool)]<0)
        assert np.all(f['distanceLake'][hydro['lake'].astype(bool)]<0)
        assert np.all(f['emergedBank'][hydro['sea'].astype(bool)|hydro['lake'].astype(bool)]==0)
        for state in ('mean','dry','wet'):
            recipe=s['states'][state]
            for channel in ('indices','weights','indicesExtra','weightsExtra','coverIndices','coverWeights'):assert digest((directory/recipe[channel]).read_bytes())==recipe['hashes'][channel]
            ids=np.concatenate([np.asarray(Image.open(directory/recipe[k])) for k in ('indices','indicesExtra')],axis=-1)
            w=np.concatenate([np.asarray(Image.open(directory/recipe[k])) for k in ('weights','weightsExtra')],axis=-1)
            ci=np.asarray(Image.open(directory/recipe['coverIndices']));cw=np.asarray(Image.open(directory/recipe['coverWeights']))
            assert ids.shape==(meta['n'],meta['n'],8) and int(ids.max())<80,'Snow is a separate overlay'
            np.testing.assert_equal(w.astype(int).sum(axis=-1),255)
            assert np.all((ids[...,:2]>=INDEX['R01'])&(ids[...,:2]<=INDEX['R22']))
            assert np.all((ids[...,2]>=INDEX['G01'])&(ids[...,2]<=INDEX['G06']))
            for values,field in [(w[...,:2].astype(float).sum(axis=-1),'exposedRock'),(w[...,2],'fragmentCover'),(w[...,3:6].astype(float).sum(axis=-1),'matrixCover')]:
                np.testing.assert_allclose(values/255,f[field],atol=1.01/255)
            assert np.all(ids[...,3:6]<INDEX['G01'])
            assert np.all((ci[...,:3]>=INDEX['F01'])&(ci[...,:3]<=INDEX['H06']))
            np.testing.assert_equal(cw[...,:3].astype(int).sum(axis=-1),255)
            all_types.update(recipe['typeCounts'])
        for layer in s['layers']:assert digest((directory/layer['file']).read_bytes())==layer['sha256']
        report.append({'id':meta['id'],'states':3,'layers':13});print('VALID SURFACE '+meta['id'],flush=True)
    assert len(report)==(1 if only else 42)
    result={'status':'passed','tiles':len(report),'types':90,'assets':142,'dominantTypesAcrossStates':dict(all_types),'report':report}
    write_json(root/('surface-validation-'+only+'.json' if only else 'surface-validation.json'),result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('report','dominantTypesAcrossStates')}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,default=ROOT);parser.add_argument('--tile')
    args=parser.parse_args();validate(args.out.resolve(),args.tile)
