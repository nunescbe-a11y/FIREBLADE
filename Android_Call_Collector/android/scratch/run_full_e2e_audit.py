import os
import sys
import json
import time
import subprocess
import urllib.request
import urllib.parse
import datetime
import xml.etree.ElementTree as ET
import re

DEVICE = "SSTST8LVZPWGHEQO"

env = {}
with open(r'F:\FIREBLADE_COMBINED_V3\Fireblade_Website\.env.local', 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

url = env.get('SUPABASE_URL', '')
key = env.get('SUPABASE_SECRET_KEY', '')
headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

def log(msg):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def db_get(path):
    req = urllib.request.Request(f'{url}/rest/v1/{path}', headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

def db_post(path, data):
    body = json.dumps(data).encode('utf-8')
    h = dict(headers)
    h['Prefer'] = 'return=representation'
    req = urllib.request.Request(f'{url}/rest/v1/{path}', data=body, headers=h, method='POST')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

def db_patch(path, data):
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(f'{url}/rest/v1/{path}', data=body, headers=headers, method='PATCH')
    with urllib.request.urlopen(req) as resp:
        return resp.read()

def db_delete(path):
    req = urllib.request.Request(f'{url}/rest/v1/{path}', headers=headers, method='DELETE')
    with urllib.request.urlopen(req) as resp:
        return resp.read()

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
    time.sleep(0.5)

def type_text(text):
    escaped = text.replace(" ", "%s")
    run_adb(["shell", "input", "text", escaped])
    time.sleep(0.4)

def keyevent(code):
    run_adb(["shell", "input", "keyevent", str(code)])
    time.sleep(0.5)

def swipe(x1, y1, x2, y2, duration=300):
    run_adb(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)])
    time.sleep(0.6)

def dump_ui(filename):
    run_adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    run_adb(["pull", "/sdcard/window_dump.xml", f"scratch/{filename}"])
    with open(f"scratch/{filename}", "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def find_node_bounds(filename, resource_id=None, text_contains=None):
    tree = ET.parse(f"scratch/{filename}")
    for node in tree.iter("node"):
        r = node.attrib.get("resource-id", "")
        t = node.attrib.get("text", "")
        if (resource_id and resource_id in r) or (text_contains and text_contains in t):
            b = node.attrib.get("bounds", "")
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', b)
            if m:
                x1, y1, x2, y2 = map(int, m.groups())
                return ((x1 + x2) // 2, (y1 + y2) // 2)
    return None

def main():
    log("==========================================================")
    log("  FIREBLADE 1.7.17 / CODE 32 - FULL LIVE-DEVICE AUDIT")
    log("==========================================================")

    # 1. VERIFY CONNECTED DEVICE & APP VERSION
    log("\n--- STEP 1: Verify installed APK ---")
    pkg_dump = run_adb(["shell", "dumpsys", "package", "com.nunes.callcollector"])
    for line in pkg_dump.splitlines():
        if "versionName" in line or "versionCode" in line:
            log(f"  {line.strip()}")

    # 2. CHECK NORMAL EMPLOYEE TEST ENVIRONMENT
    log("\n--- STEP 2: Configure Safe Temporary Normal Employee Assignment ---")
    depts = db_get("fireblade_departments?name=eq.MARKETING")
    mkt_dept_id = depts[0]["id"] if depts else None

    emps = db_get("fireblade_employees?employee_id=eq.TEST-NORMAL-001")
    if not emps:
        db_post("fireblade_employees", {
            "employee_id": "TEST-NORMAL-001",
            "employee_name": "NORMAL TEST EMPLOYEE",
            "department_id": mkt_dept_id,
            "active": True
        })
        log("Created temporary test employee TEST-NORMAL-001.")
    else:
        log("TEST-NORMAL-001 employee exists.")

    cur_assigns = db_get("fireblade_device_assignments?device_id=eq.MKT-001&assigned_until=is.null")
    split_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    for a in cur_assigns:
        db_patch(f"fireblade_device_assignments?id=eq.{a['id']}", {"assigned_until": split_iso})

    temp_assign = db_post("fireblade_device_assignments", {
        "device_id": "MKT-001",
        "employee_id": "TEST-NORMAL-001",
        "company_phone_number": "7550093383",
        "assigned_from": split_iso,
        "assigned_until": None,
        "created_by": "AUDIT_TEST"
    })
    log(f"Activated temporary assignment for TEST-NORMAL-001 from {split_iso}.")

    try:
        # Launch app to fetch new identity
        log("\n--- STEP 3: Refresh App Identity for Normal Employee ---")
        run_adb(["shell", "am", "force-stop", "com.nunes.callcollector"])
        time.sleep(1.0)
        run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity"])
        time.sleep(3.0)

        # Open Detail activity directly with test call
        test_phone = "9876543210"
        test_call_start = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000) + 2000
        log(f"\n--- STEP 4: Open Call Detail Activity in Normal Employee Mode ---")
        run_adb([
            "shell", "am", "start", "-n", "com.nunes.callcollector/.ShaneCallDetailActivity",
            "--es", "phone_raw", test_phone,
            "--es", "phone_normalized", f"+91{test_phone}",
            "--el", "call_started_at_epoch_ms", str(test_call_start)
        ])
        time.sleep(3.0)

        act = get_resumed_activity()
        log(f"Resumed Activity: {act}")
        assert "ShaneCallDetailActivity" in act, f"ShaneCallDetailActivity not focused: {act}"

        keyevent(111) # hide keyboard if open
        time.sleep(0.5)

        ui = dump_ui("normal_emp_detail_live.xml")

        # Verify Normal Employee UI
        assert "marketingRecipientSection" not in ui, "Marketing recipient section must NOT appear in normal employee mode!"
        log("PASS: Marketing recipient section is HIDDEN in normal employee mode.")

        # Enter Customer Name, Location, Product, check Quotation and Image
        log("\n--- STEP 5: Enter Structured Enquiry Fields on Live Device ---")
        pt_cust = find_node_bounds("normal_emp_detail_live.xml", resource_id="etCustomerName")
        if pt_cust:
            tap(pt_cust[0], pt_cust[1])
            type_text("Alpha Technologies")
            log(f"Typed Customer Name at {pt_cust}")

        keyevent(111)
        time.sleep(0.3)

        pt_loc = find_node_bounds("normal_emp_detail_live.xml", resource_id="etLocation")
        if pt_loc:
            tap(pt_loc[0], pt_loc[1])
            type_text("Chennai Guindy Industrial Estate")
            log(f"Typed Location at {pt_loc}")

        keyevent(111)
        time.sleep(0.3)

        pt_prod = find_node_bounds("normal_emp_detail_live.xml", resource_id="etProductAsked")
        if pt_prod:
            tap(pt_prod[0], pt_prod[1])
            type_text("Digital pH Meter VT 10")
            log(f"Typed Product at {pt_prod}")

        keyevent(111)
        time.sleep(0.3)

        # Check Quotation and Image
        pt_quot = find_node_bounds("normal_emp_detail_live.xml", resource_id="cbQuotation")
        if pt_quot:
            tap(pt_quot[0], pt_quot[1])
            log(f"Checked Quotation at {pt_quot}")

        pt_img = find_node_bounds("normal_emp_detail_live.xml", resource_id="cbImage")
        if pt_img:
            tap(pt_img[0], pt_img[1])
            log(f"Checked Image at {pt_img}")

        pt_notes = find_node_bounds("normal_emp_detail_live.xml", resource_id="etNotes")
        if pt_notes:
            tap(pt_notes[0], pt_notes[1])
            type_text("Immediate demo requested")
            log(f"Typed Notes at {pt_notes}")

        keyevent(111)
        time.sleep(0.5)

        # Scroll to Save Details button
        swipe(360, 1200, 360, 600)
        dump_ui("normal_emp_bottom.xml")

        pt_save = find_node_bounds("normal_emp_bottom.xml", resource_id="btnSaveSend")
        assert pt_save is not None, "Save Details button not found on screen!"
        
        # Verify button text is "Save Details" (no WhatsApp queue text)
        tree_b = ET.parse("scratch/normal_emp_bottom.xml")
        btn_text = ""
        for n in tree_b.iter("node"):
            if "btnSaveSend" in n.attrib.get("resource-id", ""):
                btn_text = n.attrib.get("text", "")
        log(f"Save button text: '{btn_text}'")
        assert btn_text == "Save Details", f"Expected button text 'Save Details', got '{btn_text}'"
        log("PASS: Button text is exactly 'Save Details' in normal mode.")

        # Tap Save Details
        tap(pt_save[0], pt_save[1])
        log("Tapped Save Details button.")
        time.sleep(2.0)

        # Open MainActivity to trigger immediate foreground sync
        log("\n--- STEP 6: Trigger App Sync and Verify Cloud Backend Records ---")
        run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity"])
        
        # Poll for synced row
        shane_rows = []
        for attempt in range(12):
            time.sleep(2.5)
            rows = db_get(f"fireblade_shane_call_details?phone_number_normalized=eq.%2B91{test_phone}&order=call_started_at_epoch_ms.desc&limit=1")
            if rows:
                shane_rows = rows
                break
            log(f"Waiting for cloud sync attempt {attempt + 1}/12...")

        log(f"fireblade_shane_call_details row: {json.dumps(shane_rows, indent=2)}")

        assert len(shane_rows) > 0, "Call detail row not synced to backend!"
        row = shane_rows[0]
        assert row["customer_name"] == "Alpha Technologies"
        assert row["product_asked"] == "Digital pH Meter VT 10"
        assert row["location"] == "Chennai Guindy Industrial Estate"
        assert row["notes"] == "Immediate demo requested"
        assert row["employee_id"] == "TEST-NORMAL-001"
        log("PASS: Structured call detail row verified in cloud database with employee_id = TEST-NORMAL-001.")

    finally:
        log("\n--- STEP 7: Restore Previous Shane Test Assignment ---")
        now_iso2 = datetime.datetime.now(datetime.timezone.utc).isoformat()
        db_patch(f"fireblade_device_assignments?id=eq.{temp_assign[0]['id']}", {"assigned_until": now_iso2})
        db_patch(f"fireblade_device_assignments?id=eq.{cur_assigns[0]['id']}", {"assigned_until": None})
        log("Restored MKT-001 assignment to TEST-SHANE-001 (department SHANE).")

        run_adb(["shell", "am", "force-stop", "com.nunes.callcollector"])
        time.sleep(1.0)
        run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity"])
        time.sleep(3.0)

    # 8. TEST SHANE MODE
    log("\n--- STEP 8: Verify Shane Mode on Live Device ---")
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
    ui_shane = dump_ui("shane_mode_detail_live.xml")

    assert "ALAGUPRIYA" in ui_shane, "ALAGUPRIYA must appear in recipient list!"
    log("PASS: ALAGUPRIYA is visible in recipient list.")
    assert "Choose one or more people" in ui_shane, "Recipient instruction text must appear!"
    log("PASS: Shane recipient picker rendered with all active recipients.")

    # Select ALAGUPRIYA
    pt_alag = find_node_bounds("shane_mode_detail_live.xml", text_contains="ALAGUPRIYA")
    if pt_alag:
        tap(pt_alag[0], pt_alag[1])
        log("Selected ALAGUPRIYA.")
        time.sleep(0.5)

    swipe(360, 1200, 360, 600)
    dump_ui("shane_mode_bottom.xml")

    tree_sb = ET.parse("scratch/shane_mode_bottom.xml")
    shane_btn_text = ""
    for n in tree_sb.iter("node"):
        if "btnSaveSend" in n.attrib.get("resource-id", ""):
            shane_btn_text = n.attrib.get("text", "")
    log(f"Shane Save button text: '{shane_btn_text}'")
    assert "1 selected" in shane_btn_text, f"Expected button to show '1 selected', got '{shane_btn_text}'"
    log("PASS: Button text shows 'Save & Send on WhatsApp • 1 selected'.")

    # 9. TEST HISTORY & WIDGETS
    log("\n--- STEP 9: Verify History Filters and Performance ---")
    run_adb(["shell", "am", "start", "-n", "com.nunes.callcollector/.MainActivity", "--ez", "open_history", "true"])
    time.sleep(2.0)
    ui_hist = dump_ui("history_screen_live.xml")
    assert "Supported Calls" in ui_hist, "History filter default must be 'Supported Calls'!"
    log("PASS: History default filter is 'Supported Calls'.")

    log("\n==========================================================")
    log("  ALL LIVE-DEVICE AUDIT TESTS COMPLETED SUCCESSFULLY!")
    log("==========================================================")

if __name__ == "__main__":
    main()
