"""Inspect only document-picker controls; never print personal file listings."""
import argparse
import re
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("--serial", required=True)
parser.add_argument("--resource")
parser.add_argument("--text")
parser.add_argument("--class", dest="widget_class")
parser.add_argument("--tap", action="store_true")
args = parser.parse_args()
assert args.serial in {"58181JEBF13112", "emulator-5580", "emulator-5590"}
adb = "/home/gellar/Android/Sdk/platform-tools/adb"

def run(*command):
    return subprocess.run([adb, "-s", args.serial, *command], check=True, capture_output=True, text=True).stdout

resumed = run("shell", "dumpsys", "activity", "activities")
assert any("topResumedActivity=" in line and "com.google.android.documentsui/" in line for line in resumed.splitlines()), "Document picker is not foreground"
raw = run("exec-out", "uiautomator", "dump", "/dev/tty")
start = raw.find("<?xml")
end = raw.find("</hierarchy>", start) + len("</hierarchy>")
assert start >= 0 and end > start, "UI XML missing"
root = ET.fromstring(raw[start:end])
matches = []
for node in root.iter("node"):
    attributes = node.attrib
    if args.widget_class and attributes.get("class") != args.widget_class:
        continue
    if args.resource and attributes.get("resource-id") != args.resource:
        continue
    if args.text and attributes.get("text") != args.text and attributes.get("content-desc") != args.text:
        continue
    if not args.resource and not args.text:
        if attributes.get("class") != "android.widget.EditText" and attributes.get("resource-id") not in ["android:id/button1", "com.google.android.documentsui:id/container_save"]:
            continue
    matches.append(attributes)
assert matches, "Requested picker control not found"
if args.tap:
    assert len(matches) == 1, "Picker target is ambiguous"
    assert matches[0].get("enabled") == "true", "Picker target is disabled"
    coordinates = list(map(int, re.findall(r"\d+", matches[0]["bounds"])))
    run("shell", "input", "tap", str((coordinates[0] + coordinates[2]) // 2), str((coordinates[1] + coordinates[3]) // 2))
for attributes in matches:
    print({key: attributes.get(key) for key in ["resource-id", "class", "bounds", "enabled"]})
