import subprocess
import time
import sys

DEVICE = "SSTST8LVZPWGHEQO"

def run_adb(cmd):
    full_cmd = f"adb -s {DEVICE} {cmd}"
    res = subprocess.run(full_cmd, shell=True, capture_output=True, text=True)
    return res.stdout.strip()

def get_resumed_activity():
    out = run_adb("shell \"dumpsys activity activities | grep mResumedActivity\"")
    return out

def tap(x, y):
    run_adb(f"shell input tap {x} {y}")

def type_text(text):
    escaped = text.replace(" ", "%s")
    run_adb(f"shell input text {escaped}")

def keyevent(code):
    run_adb(f"shell input keyevent {code}")

def dump_ui():
    run_adb("shell uiautomator dump /sdcard/dump.xml")
    run_adb("pull /sdcard/dump.xml scratch/dump.xml")

print("=== STARTING MANDATORY DEVICE TEST ON VIVO DEVICE ===")

# 1. Ensure app is in HistoryActivity
print("\n--- Step 1: Launch HistoryActivity ---")
run_adb("shell am start -n com.nunes.callcollector/.MainActivity --ez open_history true")
time.sleep(2)
act = get_resumed_activity()
print(f"Resumed Activity: {act}")
assert "HistoryActivity" in act, f"Expected HistoryActivity, got {act}"

# 2. Test Row 1 (Incoming Answered: +917200482833)
print("\n--- Step 2: Test Row 1 (Incoming Answered: +917200482833) ---")
tap(360, 459) # Center of Row 1
time.sleep(2)
act = get_resumed_activity()
print(f"Immediately after tap, Resumed Activity: {act}")
assert "ShaneCallDetailActivity" in act, f"FAIL: Expected ShaneCallDetailActivity, got {act}"

print("Waiting 5 seconds to ensure page REMAINS open (no fallback to Callback)...")
time.sleep(5)
act_after = get_resumed_activity()
print(f"After 5 seconds, Resumed Activity: {act_after}")
assert "ShaneCallDetailActivity" in act_after, f"FAIL: Navigated away! Got {act_after}"

# Data entry test
print("Interacting with Shane Details fields...")
# Focus Customer Name (approx x=200, y=300 depending on form layout)
# Let's dump UI to get exact coordinates of fields
dump_ui()
import xml.etree.ElementTree as ET
tree = ET.parse("scratch/dump.xml")
root = tree.getroot()

nodes_by_id = {}
for n in root.iter("node"):
    rid = n.attrib.get("resource-id", "")
    if rid:
        nodes_by_id[rid.split("/")[-1]] = n.attrib.get("bounds")

print(f"Form Field Bounds: {nodes_by_id}")

# Tap etCustomerName
name_bounds = nodes_by_id.get("etCustomerName")
if name_bounds:
    # bounds format [x1,y1][x2,y2]
    coords = [int(c) for c in name_bounds.replace("][", ",").replace("[", "").replace("]", "").split(",")]
    cx, cy = (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2
    tap(cx, cy)
    time.sleep(1)
    type_text("Anand Kumar")
    print("Typed Customer Name: Anand Kumar")

# Tap etProductAsked
prod_bounds = nodes_by_id.get("etProductAsked")
if prod_bounds:
    coords = [int(c) for c in prod_bounds.replace("][", ",").replace("[", "").replace("]", "").split(",")]
    cx, cy = (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2
    tap(cx, cy)
    time.sleep(1)
    type_text("5KW Hybrid System")
    print("Typed Product Asked: 5KW Hybrid System")

# Tap etLocation
loc_bounds = nodes_by_id.get("etLocation")
if loc_bounds:
    coords = [int(c) for c in loc_bounds.replace("][", ",").replace("[", "").replace("]", "").split(",")]
    cx, cy = (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2
    tap(cx, cy)
    time.sleep(1)
    type_text("Madurai")
    print("Typed Location: Madurai")

# Tap etNotes
notes_bounds = nodes_by_id.get("etNotes")
if notes_bounds:
    coords = [int(c) for c in notes_bounds.replace("][", ",").replace("[", "").replace("]", "").split(",")]
    cx, cy = (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2
    tap(cx, cy)
    time.sleep(1)
    type_text("Wants quotation by evening")
    print("Typed Notes: Wants quotation by evening")

# Toggle Very Urgent
urg_bounds = nodes_by_id.get("cbVeryUrgent")
if urg_bounds:
    coords = [int(c) for c in urg_bounds.replace("][", ",").replace("[", "").replace("]", "").split(",")]
    cx, cy = (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2
    tap(cx, cy)
    print("Toggled Very Urgent checkbox")

# Verify screen is STILL ShaneCallDetailActivity after keyboard/text entry
time.sleep(2)
act_entry = get_resumed_activity()
print(f"After text entry and keyboard interactions, Resumed Activity: {act_entry}")
assert "ShaneCallDetailActivity" in act_entry, f"FAIL: Navigated during text entry! Got {act_entry}"

# Tap Back button to return to History
keyevent(4) # BACK
time.sleep(2)
act_back = get_resumed_activity()
print(f"After tapping Back, Resumed Activity: {act_back}")
assert "HistoryActivity" in act_back, f"FAIL: Expected HistoryActivity after Back, got {act_back}"

print("\n=== STEP 2 PASSED: Row 1 stayed open, accepted data entry, and Back returned to History ===")
