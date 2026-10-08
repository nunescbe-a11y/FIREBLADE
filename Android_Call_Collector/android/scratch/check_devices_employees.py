import os
import json
import urllib.request

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

def get(t):
    req = urllib.request.Request(f"{url}/rest/v1/{t}", headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

print("--- ACTIVE DEVICES ---")
devices = get("fireblade_devices?active=eq.true&order=device_id.asc")
for d in devices:
    print(f"Device: {d.get('device_id')} | Active: {d.get('active')} | Label: {d.get('phone_label')}")

print("\n--- ACTIVE ASSIGNMENTS ---")
assigns = get("fireblade_device_assignments?assigned_until=is.null&order=device_id.asc")
for a in assigns:
    print(f"Device: {a.get('device_id')} | Employee: {a.get('employee_id')} | From: {a.get('assigned_from')}")
