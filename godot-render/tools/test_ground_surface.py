"""Support conservation, admissibility and display-state checks."""
import json
from pathlib import Path
import unittest
import tempfile
import numpy as np
from PIL import Image
from ground_surface import TYPE_IDS, INDEX, ROCK_FIELDS, scores_for_chunk, classify, ramp, smooth_appearance, render_diagnostics


def fixture(n=8):
    def a(v):return np.full((n,n),v,np.float32)
    g={k:a(v) for k,v in {'slope':20,'clay':.25,'sand':.45,'silt':.30,'organic':.08,
                         'stoniness':.25,'aeolianPotential':.05}.items()}
    for k in ROCK_FIELDS:g[k]=a(.2)
    f={k:a(v) for k,v in {'meanWetness':.60,'temperatureLocal':12,'structuralRoughness':.5,
                         'alteration':.3,'forestPotential':.5,'herbPotential':.4,'mossPotential':.2,
                         'exposedRock':.35,'fragmentCover':.20,'matrixCover':.45,
                         'roundness':0,'grainSizeMm':40,'looseSand':.05,'emergedBank':.2}.items()}
    return g,f


class SurfaceTests(unittest.TestCase):
    def test_rules_share_catalogue_order(self):
        c=json.loads((Path(__file__).parents[1]/'ground_texture_catalogue.json').read_text(encoding='utf-8'))
        self.assertEqual(TYPE_IDS,[t['id'] for t in c['types']])
        self.assertEqual(len(TYPE_IDS),90)

    def test_continuous_scores_preserve_full_support(self):
        g,f=fixture()
        s=scores_for_chunk(g,f,'mean',.8)
        np.testing.assert_allclose(s.sum(axis=-1),1,atol=1.e-6)
        np.testing.assert_allclose(s[...,INDEX['R01']:INDEX['R22']+1].sum(axis=-1),.35,atol=1.e-6)
        np.testing.assert_allclose(s[...,INDEX['G01']:INDEX['G06']+1].sum(axis=-1),.20,atol=1.e-6)
        self.assertTrue(np.all(s>=0))

    def test_quantized_gpu_slots_keep_rock_fragment_matrix_budgets(self):
        g,f=fixture();ids,w,*_=classify(g,f,'mean',.8)
        np.testing.assert_equal(w.astype(int).sum(axis=-1),255)
        np.testing.assert_allclose(w[...,:2].astype(float).sum(axis=-1)/255,.35,atol=1/255)
        np.testing.assert_allclose(w[...,2]/255,.20,atol=1/255)
        np.testing.assert_allclose(w[...,3:6].astype(float).sum(axis=-1)/255,.45,atol=1/255)
        self.assertTrue(np.all((ids[...,:2]>=INDEX['R01'])&(ids[...,:2]<=INDEX['R22'])))
        self.assertTrue(np.all((ids[...,2]>=INDEX['G01'])&(ids[...,2]<=INDEX['G06'])))

    def test_no_rounded_stock_or_undeclared_snow(self):
        g,f=fixture();s=scores_for_chunk(g,f,'mean',.8)
        self.assertTrue(np.all(s[...,INDEX['G03']:INDEX['G04']+1]==0))
        self.assertTrue(np.all(s[...,INDEX['N01']:]==0))
        f['roundness'][:]=1
        s=scores_for_chunk(g,f,'mean',.8)
        self.assertTrue(np.all(s[...,INDEX['G03']:INDEX['G04']+1].sum(axis=-1)>0))

    def test_dessiccation_needs_declared_cycle_and_wet_changes_rules(self):
        g,f=fixture();mean=scores_for_chunk(g,f,'mean',.8);dry=scores_for_chunk(g,f,'dry',.8);wet=scores_for_chunk(g,f,'wet',.8)
        self.assertTrue(np.all(mean[...,INDEX['B05']]==0))
        self.assertTrue(np.all(dry[...,INDEX['B05']]>0))
        self.assertGreater(float(wet[...,INDEX['B09']].mean()),float(mean[...,INDEX['B09']].mean()))
        self.assertGreater(float(dry[...,INDEX['P06']].mean()),float(wet[...,INDEX['P06']].mean()))

    def test_no_rock_erasure_when_context_is_productive(self):
        g,f=fixture();f['exposedRock'][:]=.8;f['fragmentCover'][:]=.1;f['matrixCover'][:]=.1
        f['forestPotential'][:]=1;f['herbPotential'][:]=1
        ids,w,*_=classify(g,f,'wet',1.5)
        np.testing.assert_allclose(w[...,:2].astype(float).sum(axis=-1)/255,.8,atol=1/255)

    def test_upper_cover_is_separate_from_mineral_support(self):
        g,f=fixture();f['surfaceCover']=np.full((8,8),.9,np.float32)
        ids,w,_,ci,cw=classify(g,f,'mean',.8)
        self.assertTrue(np.all(ids[...,3:6]<INDEX['G01']))
        self.assertTrue(np.all((ci[...,:3]>=INDEX['F01'])&(ci[...,:3]<=INDEX['H06'])))
        np.testing.assert_equal(cw[...,:3].astype(int).sum(axis=-1),255)
        np.testing.assert_allclose(cw[...,3]/255,.9,atol=1/255)
        coverage=cw[...,3]/255
        np.testing.assert_allclose(w.astype(float).sum(axis=-1)/255*(1-coverage)+cw[...,:3].astype(float).sum(axis=-1)/255*coverage,1,atol=1.e-6)

    def test_checkerboard_wetness_is_filtered_without_water_donors(self):
        checker=np.indices((65,65)).sum(axis=0)%2
        result=smooth_appearance(checker,np.ones_like(checker),3)
        self.assertLess(float(np.std(result[12:-12,12:-12])),.005)
        a=np.full((65,65),.2,np.float32);a[:,32:]=1
        mask=np.ones_like(a);mask[:,32:]=0
        result=smooth_appearance(a,mask,3)
        np.testing.assert_allclose(result[:,:32],.2,atol=1.e-6)

    def test_cover_boundary_has_blended_recipes(self):
        g,f=fixture(65);f['surfaceCover']=np.full((65,65),.9,np.float32)
        f['forestPotential'][:,:32]=1;f['forestPotential'][:,32:]=.05
        f['herbPotential'][:,:32]=.05;f['herbPotential'][:,32:]=1
        _,_,_,ci,cw=classify(g,f,'mean',.8)
        forest_share=((ci[...,:3]<INDEX['P01'])*cw[...,:3].astype(float)/255).sum(axis=-1)[32]
        self.assertGreater(forest_share[15],forest_share[50])
        self.assertTrue(np.any((forest_share[25:39]>.05)&(forest_share[25:39]<.95)))
        self.assertLess(float(np.abs(np.diff(forest_share)).max()),.35)

    def test_previews_cannot_overwrite_canonical_snow(self):
        g,f=fixture()
        for key in ('looseFines','distanceRiver','distanceLake','distanceSea','snowRetention','surfaceCover','renderSnow'):
            f[key]=np.zeros((8,8),np.float32)
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);canonical=p/'surface-render-snow.png'
            Image.new('L',(32,32),230).save(canonical);before=canonical.read_bytes()
            layers=render_diagnostics(p,f,np.ones((8,8),bool))
            self.assertEqual(canonical.read_bytes(),before)
            self.assertEqual(len(layers),13)
            self.assertTrue(all(l['file'].startswith('surface-info-') for l in layers))

    def test_random_supports_keep_each_integer_budget(self):
        g,f=fixture(32);parts=np.random.default_rng(37).uniform(.01,1,(32,32,3)).astype(np.float32)
        parts/=parts.sum(axis=-1,keepdims=True)
        f['exposedRock']=parts[...,0];f['fragmentCover']=parts[...,1];f['matrixCover']=parts[...,2]
        f['looseSand']=parts[...,2]*.12
        _,w,*_=classify(g,f,'mean',.8)
        for values,target in [(w[...,:2].astype(float).sum(axis=-1),parts[...,0]),(w[...,2],parts[...,1]),(w[...,3:6].astype(float).sum(axis=-1),parts[...,2])]:
            np.testing.assert_allclose(values/255,target,atol=1/255)


if __name__=='__main__':unittest.main()
