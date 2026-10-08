import os
import json
import urllib.request

env_file = r'F:\FIREBLADE_COMBINED_V3\Fireblade_Website\.env.local'

env = {}
with open(env_file, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

url = env.get('SUPABASE_URL', '')
key = env.get('SUPABASE_SECRET_KEY', '')

headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

def get(path):
    req = urllib.request.Request(f'{url}/rest/v1/{path}', headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

print('ASSIGNMENTS FOR MKT-001:')
print(json.dumps(get('fireblade_device_assignments?device_id=eq.MKT-001&order=assigned_from.desc'), indent=2))
