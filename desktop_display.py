"""Per-process window geometry; does not alter Windows settings."""
from __future__ import annotations
import ctypes
from ctypes import wintypes
def fit_window(work_width,work_height,dpi=96):
    scale=max(1,float(dpi)/96)
    available=(max(1,int(work_width/scale)-32),max(1,int(work_height/scale)-32))
    width,height=min(1280,available[0]),min(900,available[1])
    return dict(width=width,height=height,min_size=(min(800,width),min(600,height)))
def initial_window_geometry():
    try:
        user=ctypes.WinDLL('user32',use_last_error=True)
        class MI(ctypes.Structure):
            _fields_=[('cbSize',wintypes.DWORD),('rcMonitor',wintypes.RECT),('rcWork',wintypes.RECT),('dwFlags',wintypes.DWORD)]
        user.MonitorFromPoint.restype=wintypes.HANDLE
        user.GetMonitorInfoW.argtypes=[wintypes.HANDLE,ctypes.POINTER(MI)]
        monitor=user.MonitorFromPoint(wintypes.POINT(0,0),1)
        info=MI();info.cbSize=ctypes.sizeof(info)
        if not user.GetMonitorInfoW(monitor,ctypes.byref(info)):raise OSError('Work area unavailable')
        x=wintypes.UINT(96);y=wintypes.UINT(96)
        try:
            shcore=ctypes.WinDLL('shcore');shcore.GetDpiForMonitor.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.POINTER(wintypes.UINT),ctypes.POINTER(wintypes.UINT)]
            shcore.GetDpiForMonitor(monitor,0,ctypes.byref(x),ctypes.byref(y))
        except (OSError,AttributeError):pass
        geometry=fit_window(info.rcWork.right-info.rcWork.left,info.rcWork.bottom-info.rcWork.top,x.value)
        scale=max(1,x.value/96)
        geometry.update(x=int(info.rcWork.left/scale+(info.rcWork.right-info.rcWork.left)/scale/2-geometry['width']/2),y=int(info.rcWork.top/scale+(info.rcWork.bottom-info.rcWork.top)/scale/2-geometry['height']/2))
        return geometry
    except (OSError,AttributeError):return dict(width=960,height=600,min_size=(800,480))
