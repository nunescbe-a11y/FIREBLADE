import os
import json
from datetime import datetime, timezone, timedelta
import urllib.request

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

def fetch(path):
    req = urllib.request.Request(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

details = fetch("fireblade_shane_call_details?select=*&order=created_at.desc&limit=10")
events = fetch("fireblade_shane_assignment_events?select=*&order=recorded_at.desc&limit=20")
employees = fetch("fireblade_employees?select=employee_id,employee_name")

emp_map = {e["employee_id"]: e["employee_name"] for e in employees if "employee_id" in e and "employee_name" in e}

print(f"Loaded {len(details)} call details and {len(events)} assignment events.\n")

# Group events by detail_id
events_by_detail = {}
for evt in events:
    did = evt.get("detail_id")
    events_by_detail.setdefault(did, []).append(evt)

ist_tz = timezone(timedelta(hours=5, minutes=30))

print("==========================================================================================================")
print(f"{'CUSTOMER NAME':<26} | {'ASSIGNED TO':<30} | {'ASSIGNED DATE / TIME (IST)':<28} | {'EVENT ID'}")
print("==========================================================================================================")

for d in details:
    did = d.get("detail_id")
    c_name = d.get("customer_name") or "Unknown"
    dev_id = d.get("device_id")
    evts = events_by_detail.get(did, [])
    
    assigned_names = []
    assigned_times_ist = []
    
    for e in evts:
        emp_id = e.get("assigned_to_employee_id")
        emp_name = emp_map.get(emp_id, emp_id)
        assigned_names.append(f"{emp_name} ({emp_id})")
        
        epoch_ms = e.get("occurred_at_epoch_ms")
        if epoch_ms:
            dt_ist = datetime.fromtimestamp(epoch_ms / 1000.0, tz=ist_tz)
            assigned_times_ist.append(dt_ist.strftime("%d %b %Y, %I:%M:%S %p IST"))
    
    names_str = ", ".join(assigned_names) if assigned_names else "None"
    times_str = assigned_times_ist[0] if assigned_times_ist else "N/A"
    evt_ids = ", ".join([e.get("event_id")[:8] + "..." for e in evts]) if evts else "None"
    
    print(f"{c_name:<26} | {names_str:<30} | {times_str:<28} | {evt_ids}")

print("==========================================================================================================")
