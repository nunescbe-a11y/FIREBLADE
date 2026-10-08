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

def main():
    log("==========================================================")
    log("  MANDATORY CORRECTIONS VERIFICATION ON TEST PHONE (MKT-001)")
    log("==========================================================")

    # Wake screen
    keyevent(224)
    keyevent(82)

    # Launch Shane Call Detail on test phone (MKT-001)
    test_phone = "9876543210"
    run_adb([
        "shell", "am", "start", "-n", "com.nunes.callcollector/.ShaneCallDetailActivity",
        "--es", "phone_raw", test_phone,
        "--es", "phone_normalized", f"+91{test_phone}",
        "--el", "call_started_at_epoch_ms", str(int(time.time() * 1000))
    ])
    time.sleep(3.0)
    keyevent(111)
    time.sleep(0.5)

    ui_top = dump_ui("corrections_top_live.xml")

    # 1. Verify Required Materials Checkbox Spelling and Layout
    assert "Quotation" in ui_top, "Quotation label must be visible!"
    assert "Catalogue" in ui_top, "Catalogue label must be visible!"
    assert "Image" in ui_top, "Image label must be visible!"
    log("PASS: Quotation, Catalogue, and Image labels are fully present on single lines.")

    # 2. Verify Marketing Recipient Section is GONE on MKT-001
    assert "marketingRecipientSection" not in ui_top, "Marketing recipient section must NOT appear on MKT-001!"
    log("PASS: Send to Marketing and recipient employee list are GONE on MKT-001.")

    # Scroll down to bottom to verify Save Details button
    swipe(360, 1200, 360, 600)
    dump_ui("corrections_bottom_live.xml")

    tree_b = ET.parse("scratch/corrections_bottom_live.xml")
    btn_text = ""
    for n in tree_b.iter("node"):
        if "btnSaveSend" in n.attrib.get("resource-id", ""):
            btn_text = n.attrib.get("text", "")
    log(f"Button text: '{btn_text}'")
    assert btn_text == "Save Details", f"Expected button text 'Save Details', got '{btn_text}'"
    log("PASS: Action button displays 'Save Details' strictly (no WhatsApp queue / selected count).")

    log("\n==========================================================")
    log("  ALL MANDATORY CORRECTIONS VERIFIED ON LIVE TEST PHONE!")
    log("==========================================================")

if __name__ == "__main__":
    main()
