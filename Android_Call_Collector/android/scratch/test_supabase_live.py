import os
import json
import urllib.request
import urllib.parse
import ssl

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
url = env.get('SUPABASE_URL')
key = env.get('SUPABASE_SECRET_KEY')

print(f"Testing Supabase connection to: {url}")

# 1. Test REST endpoint: query fireblade_app_releases
req = urllib.request.Request(
    f"{url}/rest/v1/fireblade_app_releases?select=*&order=version_code.desc&limit=5",
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    print(f"\nExisting releases in Supabase ({len(data)}):")
    for r in data:
        print(f"  v{r.get('version_name')} (code {r.get('version_code')}) | status: {r.get('status')} | target: {r.get('target_device_id')} | id: {r.get('id')} | path: {r.get('object_path')}")

# 2. Check storage bucket
req_storage = urllib.request.Request(
    f"{url}/storage/v1/bucket/fireblade-releases",
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}"
    }
)
with urllib.request.urlopen(req_storage) as resp:
    bdata = json.loads(resp.read().decode('utf-8'))
    print(f"\nBucket status: {bdata.get('name')} (id: {bdata.get('id')})")
