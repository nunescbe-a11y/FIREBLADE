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

req = urllib.request.Request(f"{url}/rest/v1/fireblade_app_releases?version_code=eq.32&order=target_device_id.asc", headers=headers)
with urllib.request.urlopen(req) as resp:
    rows = json.loads(resp.read().decode('utf-8'))
    print(f"Total Code 32 Releases: {len(rows)}")
    for r in rows:
        print(f"Device: {r.get('target_device_id')} | Release ID: {r.get('id')} | Status: {r.get('status')} | Object: {r.get('object_path')}")
