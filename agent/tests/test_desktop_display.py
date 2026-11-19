import unittest
from desktop_display import fit_window
class DisplayGeometryTests(unittest.TestCase):
    def test_low_height_and_dpi_remain_inside_work_area(self):
        for w,h,dpi in [(800,560,96),(1024,680,120),(1280,720,144),(1920,1040,96),(640,400,144)]:
            with self.subTest(w=w,h=h,dpi=dpi):
                g=fit_window(w,h,dpi);scale=dpi/96
                self.assertLessEqual((g['width']+32)*scale,w)
                self.assertLessEqual((g['height']+32)*scale,h)
                self.assertLessEqual(g['min_size'][0],g['width'])
                self.assertLessEqual(g['min_size'][1],g['height'])
    def test_large_monitor_keeps_preferred_size(self):
        self.assertEqual(fit_window(3840,2160,144),dict(width=1280,height=900,min_size=(800,600)))
