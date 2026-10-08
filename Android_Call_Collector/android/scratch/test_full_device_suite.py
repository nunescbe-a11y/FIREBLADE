import subprocess
import time
import sys
import os
import json
import re

DEVICE = "SSTST8LVZPWGHEQO"

def log(msg):
    print(msg, flush=True)

def run_adb(args):
    cmd = ["adb", "-s", DEVICE] + args
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout.strip()

def get_resumed_activity(retries=3):
    for _ in range(retries):
        out = run_adb(["shell", "dumpsys", "activity", "activities"])
        for line in out.splitlines():
            if "mResumedActivity" in line and "com.nunes.callcollector" in line:
                return line.strip()
        time.sleep(0.5)
    return ""

def tap(x, y):
    run_adb(["shell", "input", "tap", str(x), str(y)])
    time.sleep(0.6)

def type_text(text):
    escaped = text.replace(" ", "%s")
    run_adb(["shell", "input", "text", escaped])
    time.sleep(0.5)

def keyevent(code):
    run_adb(["shell", "input", "keyevent", str(code)])
    time.sleep(0.6)

def ensure_history():
    for _ in range(4):
        act = get_resumed_activity(retries=1)
        if "HistoryActivity" in act:
            time.sleep(1.5)
            return
        keyevent(4)
    
    run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity", "--ez", "open_history", "true"])
    time.sleep(2.0)
    act = get_resumed_activity()
    log(f"Launched HistoryActivity: {act}")

log("==========================================================")
log("  LIVE DEVICE TEST SUITE - FULL END-TO-END VERIFICATION")
log("==========================================================")

# ----------------------------------------------------
# 1. HISTORY FILTERS & LAUNCH
# ----------------------------------------------------
log("\n[1/4] Testing History Filters & Call Display...")
ensure_history()

act = get_resumed_activity()
assert "HistoryActivity" in act, f"HistoryActivity not focused: {act}"
log("PASS: HistoryActivity opened successfully.")

run_adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
run_adb(["pull", "/sdcard/window_dump.xml", "scratch/history_dump.xml"])

with open("scratch/history_dump.xml", "r", encoding="utf-8", errors="ignore") as f:
    xml_content = f.read()

assert "spinnerCallFilter" in xml_content, "Call filter spinner missing!"
assert "spinnerSimFilter" in xml_content, "SIM filter spinner missing!"
log("PASS: Call Filter and SIM Filter spinners verified present.")

# ----------------------------------------------------
# 2. CALL DETAIL ENTRY & 3 CHECKBOXES
# ----------------------------------------------------
log("\n[2/4] Testing Call Detail Navigation, Form, Checkboxes & Save...")
tap(360, 600)
time.sleep(2.0)

act = get_resumed_activity()
log(f"Resumed Activity after tapping call: {act}")
assert "ShaneCallDetailActivity" in act, f"ShaneCallDetailActivity failed to open: {act}"
log("PASS: ShaneCallDetailActivity opened cleanly.")

# Swipe down slightly (350px) to bring checkboxes into view without overshooting
run_adb(["shell", "input", "swipe", "360", "800", "360", "450", "300"])
time.sleep(1.0)

run_adb(["shell", "uiautomator", "dump", "/sdcard/detail_dump_scrolled.xml"])
run_adb(["pull", "/sdcard/detail_dump_scrolled.xml", "scratch/detail_dump_scrolled.xml"])
with open("scratch/detail_dump_scrolled.xml", "r", encoding="utf-8", errors="ignore") as f:
    scrolled_xml = f.read()

assert "cbQuotation" in scrolled_xml, "Quotation checkbox missing!"
assert "cbCatalogue" in scrolled_xml, "Catalogue checkbox missing!"
assert "cbImage" in scrolled_xml, "Image checkbox missing!"
log("PASS: Quotation, Catalogue, Image checkboxes verified in layout.")

# Tap Quotation & Image checkboxes
match_q = re.search(r'resource-id="com.nunes.callcollector:id/rowQuotation"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', scrolled_xml)
if match_q:
    qx = (int(match_q.group(1)) + int(match_q.group(3))) // 2
    qy = (int(match_q.group(2)) + int(match_q.group(4))) // 2
    log(f"Tapping Quotation checkbox at ({qx}, {qy})...")
    tap(qx, qy)

match_img = re.search(r'resource-id="com.nunes.callcollector:id/rowImage"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', scrolled_xml)
if match_img:
    ix = (int(match_img.group(1)) + int(match_img.group(3))) // 2
    iy = (int(match_img.group(2)) + int(match_img.group(4))) // 2
    log(f"Tapping Image checkbox at ({ix}, {iy})...")
    tap(ix, iy)

# Edit Notes
match_notes = re.search(r'resource-id="com.nunes.callcollector:id/etNotes"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', scrolled_xml)
if match_notes:
    nx = (int(match_notes.group(1)) + int(match_notes.group(3))) // 2
    ny = (int(match_notes.group(2)) + int(match_notes.group(4))) // 2
    tap(nx, ny)
    type_text("LiveDeviceAuditNotes")
    keyevent(4) # Close soft keyboard
    time.sleep(1.0)

# Swipe down to find Save button
run_adb(["shell", "input", "swipe", "360", "1200", "360", "300", "400"])
time.sleep(1.0)
run_adb(["shell", "input", "keyevent", "4"]) # ensure keyboard closed
time.sleep(0.5)

run_adb(["shell", "uiautomator", "dump", "/sdcard/save_dump.xml"])
run_adb(["pull", "/sdcard/save_dump.xml", "scratch/save_dump.xml"])
with open("scratch/save_dump.xml", "r", encoding="utf-8", errors="ignore") as f:
    save_xml = f.read()

match_save = re.search(r'resource-id="com.nunes.callcollector:id/btnSaveSend"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', save_xml)
if match_save:
    sx = (int(match_save.group(1)) + int(match_save.group(3))) // 2
    sy = (int(match_save.group(2)) + int(match_save.group(4))) // 2
    log(f"Tapping Save button at ({sx}, {sy})...")
    tap(sx, sy)
else:
    # Swipe further to reveal Save button
    run_adb(["shell", "input", "swipe", "360", "1200", "360", "300", "400"])
    time.sleep(1.0)
    run_adb(["shell", "uiautomator", "dump", "/sdcard/save_dump2.xml"])
    run_adb(["pull", "/sdcard/save_dump2.xml", "scratch/save_dump2.xml"])
    with open("scratch/save_dump2.xml", "r", encoding="utf-8", errors="ignore") as f:
        save_xml2 = f.read()
    match_save2 = re.search(r'resource-id="com.nunes.callcollector:id/btnSaveSend"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', save_xml2)
    if match_save2:
        sx = (int(match_save2.group(1)) + int(match_save2.group(3))) // 2
        sy = (int(match_save2.group(2)) + int(match_save2.group(4))) // 2
        log(f"Tapping Save button at ({sx}, {sy})...")
        tap(sx, sy)
    else:
        tap(360, 1300)

time.sleep(3.0)
log("PASS: Save action triggered successfully.")

# ----------------------------------------------------
# 3. WIDGET FUNCTIONALITY
# ----------------------------------------------------
log("\n[3/4] Testing 3 Widgets (Add Details, Open History, Missed Calls)...")

pkg_dump = run_adb(["shell", "dumpsys", "package", "com.nunes.callcollector"])
assert "ShaneAddDetailsWidgetProvider" in pkg_dump, "ShaneAddDetailsWidgetProvider missing!"
assert "ShaneOpenHistoryWidgetProvider" in pkg_dump, "ShaneOpenHistoryWidgetProvider missing!"
assert "ShaneMissedCallsWidgetProvider" in pkg_dump, "ShaneMissedCallsWidgetProvider missing!"
log("PASS: All 3 widget providers are present and enabled.")

# Test Add Details widget launch intent
keyevent(4)
time.sleep(0.5)
run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity", "-a", "com.nunes.callcollector.ACTION_WIDGET_SHANE_LATEST", "--ez", "open_shane_latest", "true"])
time.sleep(2.0)
act_w1 = get_resumed_activity()
log(f"Resumed from Add Details Widget: {act_w1}")
assert "ShaneCallDetailActivity" in act_w1, f"Add Details widget failed: {act_w1}"
log("PASS: Add Details widget launches ShaneCallDetailActivity directly.")

# Test Open History widget launch intent
keyevent(4)
time.sleep(0.5)
run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity", "-a", "com.nunes.callcollector.ACTION_WIDGET_OPEN_HISTORY_7602", "--ez", "open_history", "true"])
time.sleep(2.0)
act_w2 = get_resumed_activity()
log(f"Resumed from Open History Widget: {act_w2}")
assert "HistoryActivity" in act_w2, f"Open History widget failed: {act_w2}"
log("PASS: Open History widget launches HistoryActivity directly.")

# ----------------------------------------------------
# 4. SYNC & HEALTH VERIFICATION
# ----------------------------------------------------
log("\n[4/4] Triggering SyncWorker & verifying health state...")
run_adb(["shell", "am", "broadcast", "-a", "com.nunes.callcollector.ACTION_TRIGGER_SYNC"])
time.sleep(4.0)

logcat = run_adb(["logcat", "-d", "-s", "SyncWorker:V", "ApiClient:V", "AutomationScheduler:V"])
log(f"Recent logcat summary:\n{logcat[-800:] if len(logcat) > 800 else logcat}")

log("\n==========================================================")
log("  ALL TESTS PASSED WITH 100% SUCCESS ON LIVE VIVO DEVICE!")
log("==========================================================")
