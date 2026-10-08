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

def fetch_schema():
    req = urllib.request.Request(f"{url}/rest/v1/?apikey={key}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

schema = fetch_schema()
tables = schema.get("definitions", {})
print("fireblade_shane_assignment_events definition:")
print(json.dumps(tables.get("fireblade_shane_assignment_events"), indent=2))
