import os
import json
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
supabase_url = env['SUPABASE_URL']
supabase_key = env['SUPABASE_SECRET_KEY']

print("Querying fireblade_devices...")
req = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_devices?select=*&device_id=in.(MKT-019,MKT-001)",
    headers={
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
)
try:
    with urllib.request.urlopen(req) as resp:
        rows = json.loads(resp.read().decode('utf-8'))
        print(f"fireblade_devices results ({len(rows)}):")
        for r in rows:
            print(f"- device_id: {r.get('device_id')}, employee_name: {r.get('employee_name')}, department: {r.get('department')}, active: {r.get('active')}")
except Exception as e:
    print(f"Error: {e}")

print("\nQuerying fireblade_device_health...")
req_health = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_device_health?select=*&device_id=in.(MKT-019,MKT-001)",
    headers={
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
)
with urllib.request.urlopen(req_health) as resp:
    hrows = json.loads(resp.read().decode('utf-8'))
    for h in hrows:
        print(f"- {h.get('device_id')}: apk_version={h.get('apk_version')}, code={h.get('app_version_code')}, collector_state={h.get('collector_state')}, received_at={h.get('received_at')}, msg={h.get('collector_state_message')}")

print("\nQuerying fireblade_update_status...")
req_update = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_update_status?select=*&device_id=in.(MKT-019,MKT-001)",
    headers={
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
)
with urllib.request.urlopen(req_update) as resp:
    urows = json.loads(resp.read().decode('utf-8'))
    for u in urows:
        print(f"- {u.get('device_id')}: stage={u.get('stage')}, release_id={u.get('release_id')}, app_version_code={u.get('app_version_code')}, last_checked_at={u.get('last_checked_at')}")

# Query marketing recipients directly from DB to verify what MKT-019 will see
print("\nQuerying active MARKETING employees in fireblade_devices...")
req_mkt = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_devices?select=device_id,employee_name,employee_phone,department,active&department=eq.MARKETING&active=eq.true&order=employee_name.asc",
    headers={
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
)
with urllib.request.urlopen(req_mkt) as resp:
    mkt_rows = json.loads(resp.read().decode('utf-8'))
    print(f"Active MARKETING employees ({len(mkt_rows)}):")
    for m in mkt_rows:
        print(f"  * {m.get('employee_name')} ({m.get('device_id')}): phone={m.get('employee_phone')}")
