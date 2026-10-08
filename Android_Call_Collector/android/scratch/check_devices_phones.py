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

def fetch(path):
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/{path}",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

devices = fetch("fireblade_devices?select=*&order=device_id.asc")
print(f"Total devices in fireblade_devices: {len(devices)}")
for d in devices:
    if d.get('company_phone_number') or d.get('device_id') in ['MKT-001', 'MKT-002', 'MKT-003', 'MKT-004', 'MKT-005', 'MKT-006', 'MKT-007', 'MKT-008', 'MKT-019']:
        print(f"  - {d.get('device_id')}: phone={d.get('company_phone_number')}, name={d.get('device_name')}, active={d.get('active')}")
