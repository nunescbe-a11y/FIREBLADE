import os
import json
import uuid
import time
from datetime import datetime, timezone, timedelta
import urllib.request
import urllib.parse

def get_env():
    env_file = r'F:\FIREBLADE_COMBINED_V3\Fireblade_Website\.env.local'
    env = {}
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"\'')
    return env

env = get_env()
url = env['SUPABASE_URL']
key = env['SUPABASE_SECRET_KEY']

# Live cloud backend V3 base URL
BACKEND_BASE = "https://nunes-call-collector-phase0-cloud.vercel.app"

def fetch_db(path):
    req = urllib.request.Request(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

token = "test-mkt001-token-secret-12345678901234567890"
print(f"Using active MKT-001 device token: {token[:12]}...")

def api_post(endpoint, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f"{BACKEND_BASE}{endpoint}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-fireblade-token": token
        },
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))

def api_get(endpoint):
    req = urllib.request.Request(
        f"{BACKEND_BASE}{endpoint}",
        headers={"x-fireblade-token": token}
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))

print("\n--- 1. Testing Marketing Recipients Endpoint for MKT-001 ---")
status, rec_data = api_get("/api/v3/devices/MKT-001/shane/marketing-recipients")
print(f"Status: {status}, Total Recipients: {len(rec_data.get('employees', []))}")
employees = rec_data.get("employees", [])
for emp in employees:
    print(f"  - {emp.get('employee_name')} ({emp.get('employee_id')}): phone={emp.get('phone_number')}, available={emp.get('available')}")

# Check Alagupriya in marketing recipients
alagupriya = next((e for e in employees if e.get("employee_id") == "EMP-008"), None)
print(f"\nAlagupriya (EMP-008, SERVICE) present in recipients list: {alagupriya is not None}")

now_ms = int(time.time() * 1000)

print("\n--- 2. Executing TEST A: Single Recipient Assignment ---")
detail_id_a = str(uuid.uuid4())
event_id_a = str(uuid.uuid4())

detail_a_payload = {
    "device_id": "MKT-001",
    "detail_id": detail_id_a,
    "source_call_id": f"call-single-{now_ms}",
    "phone_number_raw": "9876543210",
    "phone_number_normalized": "+919876543210",
    "call_started_at_epoch_ms": now_ms,
    "customer_name": "TEST-CUST-SINGLE-901",
    "product_asked": "Digital pH Meter QA-01",
    "location": "Chennai",
    "notes": "Test A Single Recipient Assignment",
    "very_urgent": True,
    "updated_at_epoch_ms": now_ms
}

status_d_a, res_d_a = api_post("/api/v3/shane/call-details", detail_a_payload)
print(f"Save Call Detail A Status: {status_d_a}, Response: {res_d_a}")

event_a_payload = {
    "device_id": "MKT-001",
    "event_id": event_id_a,
    "detail_id": detail_id_a,
    "assigned_to_employee_id": "EMP-001", # GAYATHRI
    "event_type": "ASSIGNED",
    "occurred_at_epoch_ms": now_ms,
    "whatsapp_recipient_number": "+917550093383",
    "form_snapshot": {
        "customer_name": "TEST-CUST-SINGLE-901",
        "product_asked": "Digital pH Meter QA-01",
        "selected_employee_ids": ["EMP-001"]
    }
}

status_e_a, res_e_a = api_post("/api/v3/shane/assignment-events", event_a_payload)
print(f"Save Assignment Event A Status: {status_e_a}, Response: {res_e_a}")

print("\n--- 3. Executing TEST B: Multiple Recipients Assignment ---")
detail_id_b = str(uuid.uuid4())
event_id_b1 = str(uuid.uuid4())
event_id_b2 = str(uuid.uuid4())

detail_b_payload = {
    "device_id": "MKT-001",
    "detail_id": detail_id_b,
    "source_call_id": f"call-multi-{now_ms}",
    "phone_number_raw": "9876543211",
    "phone_number_normalized": "+919876543211",
    "call_started_at_epoch_ms": now_ms,
    "customer_name": "TEST-CUST-MULTI-902",
    "product_asked": "Industrial Water Sensor QA-02",
    "location": "Coimbatore",
    "notes": "Test B Multiple Recipients Assignment",
    "very_urgent": False,
    "updated_at_epoch_ms": now_ms
}

status_d_b, res_d_b = api_post("/api/v3/shane/call-details", detail_b_payload)
print(f"Save Call Detail B Status: {status_d_b}, Response: {res_d_b}")

event_b1_payload = {
    "device_id": "MKT-001",
    "event_id": event_id_b1,
    "detail_id": detail_id_b,
    "assigned_to_employee_id": "EMP-001", # GAYATHRI
    "event_type": "ASSIGNED",
    "occurred_at_epoch_ms": now_ms,
    "whatsapp_recipient_number": "+917550093383",
    "form_snapshot": {
        "customer_name": "TEST-CUST-MULTI-902",
        "selected_employee_ids": ["EMP-001", "EMP-003"]
    }
}
status_e_b1, res_e_b1 = api_post("/api/v3/shane/assignment-events", event_b1_payload)
print(f"Save Assignment Event B1 Status: {status_e_b1}, Response: {res_e_b1}")

event_b2_payload = {
    "device_id": "MKT-001",
    "event_id": event_id_b2,
    "detail_id": detail_id_b,
    "assigned_to_employee_id": "EMP-003", # MERCY
    "event_type": "ASSIGNED",
    "occurred_at_epoch_ms": now_ms + 50,
    "whatsapp_recipient_number": "+917550093384",
    "form_snapshot": {
        "customer_name": "TEST-CUST-MULTI-902",
        "selected_employee_ids": ["EMP-001", "EMP-003"]
    }
}
status_e_b2, res_e_b2 = api_post("/api/v3/shane/assignment-events", event_b2_payload)
print(f"Save Assignment Event B2 Status: {status_e_b2}, Response: {res_e_b2}")

print("\n--- 4. Executing TEST C: Alagupriya (EMP-008, SERVICE) Assignment ---")
detail_id_c = str(uuid.uuid4())
event_id_c = str(uuid.uuid4())

detail_c_payload = {
    "device_id": "MKT-001",
    "detail_id": detail_id_c,
    "source_call_id": f"call-alagupriya-{now_ms}",
    "phone_number_raw": "9876543212",
    "phone_number_normalized": "+919876543212",
    "call_started_at_epoch_ms": now_ms,
    "customer_name": "TEST-CUST-ALAGUPRIYA-903",
    "product_asked": "Service Calibration QA-03",
    "location": "Madurai",
    "notes": "Test C Alagupriya Service Assignment",
    "very_urgent": True,
    "updated_at_epoch_ms": now_ms
}
status_d_c, res_d_c = api_post("/api/v3/shane/call-details", detail_c_payload)
print(f"Save Call Detail C Status: {status_d_c}, Response: {res_d_c}")

event_c_payload = {
    "device_id": "MKT-001",
    "event_id": event_id_c,
    "detail_id": detail_id_c,
    "assigned_to_employee_id": "EMP-008", # ALAGUPRIYA
    "event_type": "ASSIGNED",
    "occurred_at_epoch_ms": now_ms,
    "whatsapp_recipient_number": "+917550093385",
    "form_snapshot": {
        "customer_name": "TEST-CUST-ALAGUPRIYA-903",
        "selected_employee_ids": ["EMP-008"]
    }
}
status_e_c, res_e_c = api_post("/api/v3/shane/assignment-events", event_c_payload)
print(f"Save Assignment Event C Status: {status_e_c}, Response: {res_e_c}")

print("\n--- 5. Executing TEST D: Idempotent Retry of Assignment Event ---")
status_e_a_retry, res_e_a_retry = api_post("/api/v3/shane/assignment-events", event_a_payload)
print(f"Idempotent Retry Status: {status_e_a_retry}, Response: {res_e_a_retry}")

print("\n--- 6. Verifying Recorded Events in Database ---")
db_events = fetch_db("fireblade_shane_assignment_events?select=*&order=recorded_at.desc&limit=10")
print(f"Total recorded events in database: {len(db_events)}")
for evt in db_events:
    dt_utc = datetime.fromtimestamp(evt.get("occurred_at_epoch_ms") / 1000.0, tz=timezone.utc)
    # Convert to IST (UTC+5:30)
    ist_tz = timezone(timedelta(hours=5, minutes=30))
    dt_ist = datetime.fromtimestamp(evt.get("occurred_at_epoch_ms") / 1000.0, tz=ist_tz)
    print(f"  * Event ID: {evt.get('event_id')}")
    print(f"    Detail ID: {evt.get('detail_id')}")
    print(f"    Assigned To: {evt.get('assigned_to_employee_id')}")
    print(f"    Type: {evt.get('event_type')}")
    print(f"    Occurred UTC: {dt_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"    Occurred IST: {dt_ist.strftime('%d %b %Y, %I:%M %p IST')}")
