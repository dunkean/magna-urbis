import unittest
import numpy as np
from forest_placement import classify

def fixture():
    n=32;one=np.ones((n,n),np.float32);zero=one*0
    g={'slope':zero.copy(),'geomorphon150':one.copy()}
    f={'forestPotential':one.copy(),'exposedRock':zero.copy(),'distanceSea':one*1000,'waterCoverage':zero.copy()}
    cover=np.stack((one,zero,one,one),-1)
    field=np.stack((one,one*.4,zero,one*.5),-1)
    return g,f,cover,zero.copy(),field,zero.copy()

class ForestPlacementTest(unittest.TestCase):
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
