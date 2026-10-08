import os
import json
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

print("--- DEPARTMENTS ---")
print(json.dumps(fetch("fireblade_departments?select=*"), indent=2))

print("\n--- MKT-019 DEVICE ASSIGNMENT ---")
print(json.dumps(fetch("fireblade_device_assignments?select=*&device_id=eq.MKT-019"), indent=2))

print("\n--- MKT-001 DEVICE ASSIGNMENT ---")
print(json.dumps(fetch("fireblade_device_assignments?select=*&device_id=eq.MKT-001"), indent=2))

print("\n--- EMPLOYEES ---")
print(json.dumps(fetch("fireblade_employees?select=*&limit=30"), indent=2))

print("\n--- SHANE ASSIGNMENT EVENTS ---")
print(json.dumps(fetch("fireblade_shane_assignment_events?select=*&limit=10"), indent=2))
