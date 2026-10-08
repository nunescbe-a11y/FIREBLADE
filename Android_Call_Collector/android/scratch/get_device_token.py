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

req = urllib.request.Request(f"{url}/rest/v1/fireblade_device_enrollments?device_id=eq.MKT-001", headers=headers)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    print("MKT-001 enrollments:", json.dumps(data, indent=2))
