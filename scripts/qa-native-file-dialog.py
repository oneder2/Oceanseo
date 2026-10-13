"""Operate only a fixture process's GTK file chooser via accessibility."""
import argparse
import time

import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

parser = argparse.ArgumentParser()
parser.add_argument("pid", type=int)
parser.add_argument("title")
parser.add_argument("path")
parser.add_argument("--dump", action="store_true")
args = parser.parse_args()

def walk(node, depth=0):
    if depth > 16:
        return
    yield node
    for index in range(min(node.get_child_count(), 300)):
        child = node.get_child_at_index(index)
        if child is not None:
            yield from walk(child, depth + 1)

dialog = None
deadline = time.monotonic() + 8
while time.monotonic() < deadline and dialog is None:
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        application = desktop.get_child_at_index(index)
        if application.get_process_id() != args.pid:
            continue
        dialog = next((node for node in walk(application) if args.title in (node.get_name() or "")
                       and node.get_role() in (Atspi.Role.DIALOG, Atspi.Role.FILE_CHOOSER)), None)
        if dialog is not None:
            break
    if dialog is None:
        time.sleep(0.1)
if dialog is None:
    raise SystemExit("Fixture-owned accessible dialog not found")

nodes = list(walk(dialog))
if args.dump:
    for node in nodes:
        print(node.get_role_name(), repr(node.get_name()))
    raise SystemExit(0)

saving = any(node.get_role() == Atspi.Role.PUSH_BUTTON
             and (node.get_name() or "").strip() in ("Save", "保存") for node in nodes)

entries = [node for node in nodes if node.get_role() in (Atspi.Role.TEXT, Atspi.Role.ENTRY)
           and node.get_editable_text_iface() is not None]
entry = next((node for node in entries if (node.get_name() or "").rstrip(":").strip() in ("Name", "File name", "名称", "文件名", "Location", "位置")), None)
if entry is None:
    for candidate in entries:
        parent = candidate.get_parent()
        siblings = [parent.get_child_at_index(i) for i in range(parent.get_child_count())]
        if any(sibling is not None and sibling.get_role() == Atspi.Role.LABEL
               and (sibling.get_name() or "").rstrip(":").strip() in ("Name", "名称", "文件名", "Location", "位置")
               for sibling in siblings):
            entry = candidate
            break
if entry is None and len(entries) == 1:
    entry = entries[0]
if entry is None and saving:
    raise SystemExit("No named editable path field in fixture dialog: " + repr([(n.get_role_name(), n.get_name()) for n in nodes[:40]]))
if saving and not entry.get_editable_text_iface().set_text_contents(args.path):
    raise SystemExit("Fixture path input rejected")

buttons = ("Save", "保存") if saving else ("Open", "打开")
button = next((node for node in nodes if node.get_role() == Atspi.Role.PUSH_BUTTON
               and (node.get_name() or "").strip() in buttons), None)
if button is None or not button.get_action_iface().do_action(0):
    raise SystemExit("Fixture dialog confirmation failed")
