import unittest
import numpy as np
from prepare_mesoscale import conservative_water,context,support_profiles,presence_envelope

class MesoscaleTest(unittest.TestCase):
    def test_profiles_are_convex_continuous_supply_budgets(self):
        f=self.fields(8);one=np.ones((8,8),np.float32)
        f.update(alteration=one*.2,roundness=one*.1)
        g={k:one*v for k,v in [('bedrockGranite',.4),('bedrockBasalt',.1),('bedrockLimestone',.2),('bedrockSandstone',.3),('colluvialPotential',.7)]}
        p=support_profiles(g,f)
        self.assertTrue((p.astype(np.int16).sum(-1)==255).all())
        self.assertTrue((p[...,:3]>0).all())
        f['exposedRock'][:]=0;f['fragmentCover'][:]=0
        p=support_profiles(g,f)
        self.assertTrue((p[...,:3]==0).all());self.assertTrue((p[...,3]==255).all())

    def test_presence_changes_amplitude_smoothly_without_thresholded_regions(self):
        a=presence_envelope(128,4000,8123)
        np.testing.assert_array_equal(a,presence_envelope(128,4000,8123))
        self.assertGreaterEqual(float(a.min()),.76-1.e-7);self.assertLessEqual(float(a.max()),1)
        self.assertLess(float(np.abs(np.diff(a,axis=0)).max()),.12)
        self.assertGreater(float(a.std()),.02)

    def fields(self,n=64):
        one=np.ones((n,n),np.float32);zero=one*0
        return {'exposedRock':one*.4,'fragmentCover':one*.3,'matrixCover':one*.3,
                'structuralRoughness':one*.8,'looseSand':zero.copy(),'renderSnow':zero.copy(),'surfaceCover':one*.8}
    def test_unseen_subpixel_river_is_strictly_protected(self):
        native=np.zeros((64,64),np.float32);river=np.zeros((256,256),np.uint8);river[128,128]=1
        wet=conservative_water(native,river)
        self.assertTrue(wet[32,32]);self.assertTrue(wet[31,32]);self.assertTrue(wet[32,31])
        a=context(self.fields(),np.zeros((64,64,4),np.float32),wet,30)
        self.assertTrue((a[wet,:2]==0).all())
        self.assertTrue((a[31:33,31:33,:2]==0).all())
        self.assertGreater(float(a[0,0,0]),0)
    def test_context_is_bounded_and_conditioned(self):
        f=self.fields();p=np.zeros((64,64,4),np.float32);wet=np.zeros((64,64),bool)
        a=context(f,p,wet,30)
        self.assertLessEqual(float(a[...,0].max()),2.4);self.assertLessEqual(float(a[...,1].max()),.6)
        f['looseSand'][:]=f['matrixCover'];b=context(f,p,wet,30)
        self.assertLess(float(b[...,0].mean()),float(a[...,0].mean()))
        f['renderSnow'][:]=1;c=context(f,p,wet,30)
        self.assertLess(float(c[...,1].mean()),float(b[...,1].mean()))
    def test_cache_support_is_not_repeating_water_noise(self):
        f=self.fields();p=np.zeros((64,64,4),np.float32);water=np.zeros((64,64),bool);water[:,30:34]=True
        a=context(f,p,water,30)
        self.assertEqual(float(a[:,30:34,:2].max()),0)
        self.assertLess(float(a[:,35,0].mean()),float(a[:,42,0].mean()))
        self.assertEqual(a.dtype,np.dtype('<f4'))
if __name__=='__main__':unittest.main()
