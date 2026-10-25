import unittest
import numpy as np
from prepare_surface_water import wave_texture, water_field, shoreline_field, shore_reference
from scipy.ndimage import map_coordinates


class SurfaceWaterTest(unittest.TestCase):
    def test_subcell_coast_uses_dem_level_crossings(self):
        y,x=np.mgrid[:32,:32];height=(x+.2*y-18.3).astype(np.float32)*.08;sea=height<0
        packed=shoreline_field({'sea':sea,'lake':sea*0},30,height).astype(np.int32)
        coefficients=(packed[...,0]*256+packed[...,1]-32768)/32
        yy=np.linspace(5,26,85);xx=18.3-.2*yy
        distance=map_coordinates(coefficients,[yy,xx],order=3,prefilter=False,mode='nearest')
        self.assertLess(float(np.abs(distance).max()),2.0)

    def test_shore_interpolation_preserves_small_islands_lakes_and_thin_passages(self):
        n=24;sea=np.zeros((n,n),np.uint8);lake=sea.copy()
        sea[:,:10]=1;sea[12,5]=0  # one-cell island
        sea[5:19,10:16]=1;sea[12,10:16]=0  # one-cell isthmus
        lake[4,20]=1  # one-cell lake
        lake[14:19,18:20]=1;lake[14:19,21:23]=1  # one-cell dry barrier
        packed=shoreline_field({'sea':sea,'lake':lake},30).astype(np.int32)
        yy,xx=np.mgrid[:n,:n]
        for pair,mask in [(0,sea),(2,lake)]:
            coefficients=(packed[...,pair]*256+packed[...,pair+1]-32768)/32
            centres=map_coordinates(coefficients,[yy,xx],order=3,prefilter=False,mode='nearest')
            self.assertTrue((centres[mask>0]<0).all());self.assertTrue((centres[mask==0]>0).all())
            if pair==0:
                x=np.linspace(10,15,81);values=map_coordinates(coefficients,[x*0+12,x],order=3,prefilter=False,mode='nearest')
                self.assertTrue((values>0).all(),'Thin land connection stays continuous')
        # The dry separation between the two lakes stays connected.
        coefficients=(packed[...,2]*256+packed[...,3]-32768)/32
        y=np.linspace(14,18,81);values=map_coordinates(coefficients,[y,y*0+20],order=3,prefilter=False,mode='nearest')
        self.assertTrue((values>0).all())
        narrow=np.zeros((n,n),np.uint8);narrow[7,3:18]=1;narrow[7:19,17]=1
        packed=shoreline_field({'sea':narrow,'lake':narrow*0},30).astype(np.int32)
        coefficients=(packed[...,0]*256+packed[...,1]-32768)/32
        xx=np.linspace(3,17,113);values=map_coordinates(coefficients,[xx*0+7,xx],order=3,prefilter=False,mode='nearest')
        self.assertTrue((values<0).all(),'Thin water channel stays connected')

    def test_reference_donors_do_not_cross_small_components(self):
        n=24;sea=np.zeros((n,n),np.uint8);lake=sea.copy();sea[:,:8]=1;sea[12,4]=0
        lake[3:5,17:19]=1;lake[10:16,17:23]=1
        color=np.full((n,n,3),130,np.uint8);color[sea>0]=[10,50,80];color[12,4]=[220,180,90]
        color[3:5,17:19]=[180,30,20];color[10:16,17:23]=[20,30,180]
        dry,wet=shore_reference({'sea':sea,'lake':lake},color,30)
        np.testing.assert_array_equal(dry[12,4],[220,180,90])
        np.testing.assert_array_equal(wet[3,17],[180,30,20]);np.testing.assert_array_equal(wet[12,20],[20,30,180])

    def test_wave_channels_are_deterministic_and_not_flat(self):
        a = wave_texture(n=64)
        np.testing.assert_array_equal(a, wave_texture(n=64))
        self.assertFalse(np.array_equal(a, wave_texture(seed=81913, n=64)))
        self.assertGreater(float(a[:, :, :2].std()), 20)
        self.assertTrue((a[:, :, 3] == 255).all())

    def test_flow_banks_and_real_optical_depth(self):
        n = 8
        index = np.arange(n*n).reshape(n, n)
        h = np.full((n, n), -10, np.float32)
        sea = np.zeros((n, n), np.uint8)
        sea[:, 4:] = 1
        hydro = {'receiver': np.minimum(index+1, n*n-1), 'sea': sea,
                 'lake': sea*0, 'lakeLevel': h*0}
        image = water_field(h, hydro, 30)
        self.assertEqual(int(image[3, 2, 0]), 255)
        self.assertEqual(int(image[3, 2, 1]), 128)
        self.assertGreater(int(image[3, 7, 2]), int(image[3, 4, 2]))
        self.assertEqual(int(image[3, 7, 3]), 51)
        self.assertEqual(int(image[3, 2, 3]), 0)
        hydro['sea'][:] = 0
        hydro['lake'][:, 4:] = 1
        hydro['lakeLevel'][:] = -5
        image = water_field(h, hydro, 30)
        self.assertEqual(int(image[3, 7, 3]), 26)


if __name__ == '__main__':
    unittest.main()
