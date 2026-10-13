"""Resize only the private native UI QA window with real X11 pointer events."""
import ctypes
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ready = json.loads(Path(sys.argv[1]).read_text())
root = ready["root"]

def execute(script):
    url = f'{ready["endpoint"]}/session/{ready["session"]}/execute/sync'
    request = urllib.request.Request(url, data=json.dumps({"script": script, "args": []}).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(request, timeout=20))["value"]

window_id = None
for line in subprocess.check_output(["wmctrl", "-lp"], text=True).splitlines():
    fields = line.split(None, 4)
    if len(fields) < 3:
        continue
    try:
        # Match the test's isolated data directory rather than a title shared
        # with the user's daily app. Never print any environment values.
        environment = Path(f"/proc/{fields[2]}/environ").read_bytes().split(b"\0")
        if f"XDG_DATA_HOME={root}/data".encode() in environment:
            window_id = fields[0]
            break
    except (FileNotFoundError, PermissionError):
        continue
assert window_id, "Private QA window not found; refusing to move the pointer"
subprocess.run(["wmctrl", "-ia", window_id], check=True)
subprocess.run(["wmctrl", "-ir", window_id, "-b", "add,above"], check=True)
time.sleep(0.5)
before = execute("return {width:innerWidth,height:innerHeight,x:screenX,y:screenY}")
x11 = ctypes.CDLL("libX11.so.6")
xtest = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint)]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
x11.XGetGeometry.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
x11.XTranslateCoordinates.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong)]
xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
display = x11.XOpenDisplay(None)
assert display, "No X11 display"
root_return, child = ctypes.c_ulong(), ctypes.c_ulong()
px, py, wx, wy, mask = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_uint()
x11.XQueryPointer(display, x11.XDefaultRootWindow(display), ctypes.byref(root_return), ctypes.byref(child), ctypes.byref(px), ctypes.byref(py), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask))
assert mask.value & (256 | 512 | 1024) == 0, "User is holding a pointer button; do not interfere"
gx, gy, gw, gh, border, depth = ctypes.c_int(), ctypes.c_int(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
native_id = int(window_id, 16)
x11.XGetGeometry(display, native_id, ctypes.byref(root_return), ctypes.byref(gx), ctypes.byref(gy), ctypes.byref(gw), ctypes.byref(gh), ctypes.byref(border), ctypes.byref(depth))
x11.XTranslateCoordinates(display, native_id, x11.XDefaultRootWindow(display), 0, 0, ctypes.byref(gx), ctypes.byref(gy), ctypes.byref(child))
native_geometry = {"x": gx.value, "y": gy.value, "width": gw.value, "height": gh.value}

def move(x, y):
    xtest.XTestFakeMotionEvent(display, -1, round(x), round(y), 0)
    x11.XFlush(display)

try:
    # Some focus policies consume the first click after programmatic activation.
    # Focus via a static caption before starting the actual resize gesture.
    focus_point = execute("const box=document.querySelector('.personal-home-kicker').getBoundingClientRect();return {x:box.left+10,y:box.top+5}")
    move(native_geometry["x"] + focus_point["x"], native_geometry["y"] + focus_point["y"])
    xtest.XTestFakeButtonEvent(display, 1, 1, 0)
    x11.XFlush(display)
    time.sleep(0.12)
    xtest.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
    time.sleep(0.3)
    x = native_geometry["x"] + native_geometry["width"] - 8
    y = native_geometry["y"] + native_geometry["height"] - 8
    hit = None
    for attempt in range(15):
        move(x - (attempt % 2), y)
        time.sleep(0.1)
        hit = execute("return window.__resizePointer || null")
        if hit and "edge-SouthEast" in str(hit.get("target")):
            break
    assert hit and "edge-SouthEast" in str(hit.get("target")), "Pointer did not reach the private window resize handle"
    xtest.XTestFakeButtonEvent(display, 1, 1, 0)
    x11.XFlush(display)
    time.sleep(0.15)
    for step in range(1, 13):
        move(x + 80 * step / 12, y + 50 * step / 12)
        time.sleep(0.02)
finally:
    xtest.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
    move(px.value, py.value)
    x11.XCloseDisplay(display)
    subprocess.run(["wmctrl", "-ir", window_id, "-b", "remove,above"], check=False)
time.sleep(0.35)
after = execute("return {width:innerWidth,height:innerHeight,x:screenX,y:screenY}")
events = execute("return {events:window.__resizeEvents,resizeFailure:document.body.textContent.includes('窗口缩放未开始'),dpr:devicePixelRatio}")
result = {"privateWindow": window_id, "direction": "SouthEast", "before": before, "after": after, "nativeGeometry": native_geometry, "observed": events, "pointerRestored": True}
Path("output/playwright/personal-desktop-ui-native-resize-done.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
