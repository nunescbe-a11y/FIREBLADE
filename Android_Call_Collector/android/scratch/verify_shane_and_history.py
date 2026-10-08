import os
import sys
import json
import time
import subprocess
import xml.etree.ElementTree as ET

DEVICE = "SSTST8LVZPWGHEQO"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def run_adb(args):
    cmd = ["adb", "-s", DEVICE] + args
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout.strip()

def tap(x, y):
    run_adb(["shell", "input", "tap", str(x), str(y)])
    time.sleep(0.5)

def swipe(x1, y1, x2, y2, duration=300):
    run_adb(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)])
    time.sleep(0.5)

def keyevent(code):
    run_adb(["shell", "input", "keyevent", str(code)])

def dump_ui(name):
    os.makedirs("scratch", exist_ok=True)
    xml_path = f"/data/local/tmp/{name}"
    run_adb(["shell", "uiautomator", "dump", xml_path])
    local_path = os.path.join("scratch", name)
    subprocess.run(["adb", "-s", DEVICE, "pull", xml_path, local_path], capture_output=True)
    if os.path.exists(local_path):
        with open(local_path, "r", encoding="utf-8") as f:
            return f.read()
    return ""

def find_node_bounds(filename, resource_id=None, text_contains=None):
    local_path = os.path.join("scratch", filename)
    if not os.path.exists(local_path):
        return None
    tree = ET.parse(local_path)
    for node in tree.iter("node"):
        matched = True
        if resource_id and resource_id not in node.attrib.get("resource-id", ""):
            matched = False
        if text_contains and text_contains not in node.attrib.get("text", ""):
            matched = False
        if matched:
            bounds = node.attrib.get("bounds", "")
            import re
            m = re.findall(r"\[(\d+),(\d+)\]", bounds)
            if len(m) == 2:
                x1, y1 = int(m[0][0]), int(m[0][1])
                x2, y2 = int(m[1][0]), int(m[1][1])
                return ((x1 + x2) // 2, (y1 + y2) // 2)
    return None

def main():
    log("==========================================================")
    log("  TEST SHANE REGRESSION & HISTORY ON LIVE DEVICE")
    log("==========================================================")

    # Wake screen
    keyevent(224)
    keyevent(82)

    # Launch Shane Call Detail
    shane_test_phone = "9444012345"
    run_adb([
        "shell", "am", "start", "-n", "com.nunes.callcollector/.ShaneCallDetailActivity",
        "--es", "phone_raw", shane_test_phone,
        "--es", "phone_normalized", f"+91{shane_test_phone}",
        "--el", "call_started_at_epoch_ms", str(int(time.time() * 1000))
    ])
    time.sleep(3.0)
    keyevent(111)
    time.sleep(0.5)

    swipe(360, 1200, 360, 600)
    ui_shane = dump_ui("shane_regression_live.xml")

    assert "ALAGUPRIYA" in ui_shane, "ALAGUPRIYA must appear in recipient list!"
    log("PASS: ALAGUPRIYA is visible in recipient list.")
    assert "Choose one or more people" in ui_shane, "Recipient instruction text must appear!"
    log("PASS: Shane recipient picker rendered with all active recipients.")

    # Select ALAGUPRIYA
    pt_alag = find_node_bounds("shane_regression_live.xml", text_contains="ALAGUPRIYA")
    if pt_alag:
        tap(pt_alag[0], pt_alag[1])
        log(f"Selected ALAGUPRIYA at {pt_alag}.")
        time.sleep(0.5)

    # Swipe down past the recipient list
    swipe(360, 1300, 360, 300, 400)
    time.sleep(0.5)
    swipe(360, 1300, 360, 300, 400)
    time.sleep(0.5)
    dump_ui("shane_regression_bottom.xml")

    tree_sb = ET.parse("scratch/shane_regression_bottom.xml")
    shane_btn_text = ""
    for n in tree_sb.iter("node"):
        if "btnSaveSend" in n.attrib.get("resource-id", ""):
            shane_btn_text = n.attrib.get("text", "")
    log(f"Shane Save button text: '{shane_btn_text}'")
    assert "1 selected" in shane_btn_text, f"Expected button to show '1 selected', got '{shane_btn_text}'"
    log("PASS: Button text shows 'Save & Send on WhatsApp • 1 selected'.")

    # Test History Filters
    log("\n--- TEST HISTORY SCREEN ---")
    run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity", "--ez", "open_history", "true"])
    time.sleep(2.5)
    ui_hist = dump_ui("history_regression_live.xml")
    assert "Supported Calls" in ui_hist, "History filter default must be 'Supported Calls'!"
    log("PASS: History default filter is 'Supported Calls'.")

    log("\n==========================================================")
    log("  SHANE MODE & HISTORY REGRESSION TEST PASSED!")
    log("==========================================================")

if __name__ == "__main__":
    main()
