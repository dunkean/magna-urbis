import unittest
import numpy as np
from forest_placement import classify, montane, merge_fields, reduce_supplement

def fixture():
    n=32;one=np.ones((n,n),np.float32);zero=one*0
    g={'slope':zero.copy(),'geomorphon150':one.copy()}
    f={'forestPotential':one.copy(),'exposedRock':zero.copy(),'distanceSea':one*1000,'waterCoverage':zero.copy()}
    cover=np.stack((one,zero,one,one),-1)
    field=np.stack((one,one*.4,zero,one*.5),-1)
    return g,f,cover,zero.copy(),field,zero.copy()

class ForestPlacementTest(unittest.TestCase):
    def test_sparse_field_reduction_does_not_turn_edge_conifers_into_shrubs(self):
        a=np.zeros((32,32,4),np.float32);a[8:24,8:24]=[.04,.15,.97,.5]
        small=reduce_supplement(a,19,np.ones((19,19),np.float32));live=small[...,0]>0
        self.assertTrue(live.any())
        self.assertGreaterEqual(int(small[...,1][live].min()),38)
        self.assertGreaterEqual(int(small[...,2][live].min()),247)

    def montane_fixture(self):
        g,f,c,o,field,h=fixture();one=np.ones_like(h)
        g['soilDepth']=one*.6;g['geomorphon150'][:]=8
        f.update(fragmentCover=one*.1,matrixCover=one*.8,meanWetness=one*.65,renderSnow=one*0)
        return g,f,h,field*0,np.zeros_like(h,dtype=bool)

    def test_sparse_cold_woodland_and_deterministic_field(self):
        g,f,h,b,wet=self.montane_fixture()
        a,eligible,_=montane(g,f,h,b,wet,1,550,30,123)
        again,_,_=montane(g,f,h,b,wet,1,550,30,123)
        np.testing.assert_array_equal(a,again)
        self.assertGreater(float(a[...,0].mean()),.01)
        self.assertLessEqual(float(a[...,0].max()),.06)
        self.assertGreater(float(a[...,2].min()),.95)

    def test_montane_exclusions_override_climate(self):
        for case in ['snow','water','ridge','rock','original_outcrop','scree','thinsoil','cliff','desert','too_cold','warm_lowland','existing']:
            with self.subTest(case=case):
                g,f,h,b,wet=self.montane_fixture();temp=1;rain=550
                if case=='snow':f['renderSnow'][:]=1
                if case=='water':wet[:]=True
                if case=='ridge':g['geomorphon150'][:]=3
                if case=='rock':f['exposedRock'][:]=.7
                if case=='original_outcrop':f['originalOutcrop']=np.ones_like(h)*.7
                if case=='scree':f['fragmentCover'][:]=.8
                if case=='thinsoil':g['soilDepth'][:]=.05
                if case=='cliff':g['slope'][:]=40
                if case=='desert':rain=150
                if case=='too_cold':temp=-20
                if case=='warm_lowland':temp=18
                if case=='existing':b[...,0]=.1
                a,_,_=montane(g,f,h,b,wet,temp,rain,30,123)
                self.assertEqual(float(a[...,0].max()),0)

    def test_merged_attributes_only_follow_contributing_canopy(self):
        base=np.array([[[.5,.6,.1,.8],[0,.0,.0,.0]]],np.float32)
        extra=np.array([[[0,.1,.97,.4],[.04,.15,.97,.4]]],np.float32)
        merged=merge_fields(base,extra)
        np.testing.assert_array_equal(merged[0,0],base[0,0])
        np.testing.assert_allclose(merged[0,1],extra[0,1])
        base[0,0,0]=1e-12
        np.testing.assert_array_equal(merge_fields(base,extra)[0,0],base[0,0])

    def test_forest_is_not_just_any_tree_density(self):
        g,f,c,o,field,h=fixture()
        forest=classify(g,f,c,o,field,h,18,1000,30)
        self.assertGreater(float(forest[...,0].min()),.99)
        c[...,2]=.1
        meadow=classify(g,f,c,o,field,h,18,1000,30)
        self.assertEqual(float(meadow[...,0].max()),0)
        self.assertGreater(float(meadow[...,1].min()),.99)

    def test_desert_cannot_create_green_crowns(self):
        g,f,c,o,field,h=fixture()
        desert=classify(g,f,c,o,field,h,23,150,30)
        self.assertEqual(float(desert[...,0].max()),0)
        self.assertGreater(float(desert[...,3].min()),.99)

    def test_exposed_ridges_beaches_and_water_stay_clear(self):
        for case in ['ridge','outcrop','cliff','beach','water']:
            with self.subTest(case=case):
                g,f,c,o,field,h=fixture()
                if case=='ridge':g['geomorphon150'][:]=3
                if case=='outcrop':o[:]=.8
                if case=='cliff':g['slope'][:]=45
                if case=='beach':f['distanceSea'][:]=20;c[...,1]=.8
                if case=='water':f['waterCoverage'][:]=1
                result=classify(g,f,c,o,field,h,18,1000,30)
                self.assertEqual(float(result[...,0].max()),0)
                self.assertEqual(float(result[...,1].max()),0)

    def test_small_potential_shrubs_are_not_drawn_as_trees(self):
        g,f,c,o,field,h=fixture();field[...,1]=.07
        self.assertEqual(float(classify(g,f,c,o,field,h,18,1000,30)[...,0].max()),0)

if __name__=='__main__':unittest.main()
