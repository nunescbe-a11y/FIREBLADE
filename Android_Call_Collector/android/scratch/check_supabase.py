import os
import json
import urllib.request
import urllib.parse
import ssl

env_file = r'F:\FIREBLADE_GITHUB\Fireblade_Website\.env.production.local'
env = {}
with open(env_file, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"\'')

url = env.get('SUPABASE_URL')
key = env.get('SUPABASE_SECRET_KEY')

print(f"SUPABASE_URL: {url}")
print(f"SUPABASE_SECRET_KEY length: {len(key) if key else 0}")

# Query fireblade_app_releases
req = urllib.request.Request(
    f"{url}/rest/v1/fireblade_app_releases?select=*&order=version_code.desc&limit=10",
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
)

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"\nExisting releases in DB ({len(data)}):")
        for r in data:
            print(f"- v{r.get('version_name')} (code {r.get('version_code')}) | status: {r.get('status')} | target: {r.get('target_device_id')} | id: {r.get('id')} | path: {r.get('object_path')}")
except Exception as e:
    print(f"Error querying releases: {e}")

# Check storage bucket fireblade-releases
req_storage = urllib.request.Request(
    f"{url}/storage/v1/bucket/fireblade-releases",
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}"
    }
)
try:
    with urllib.request.urlopen(req_storage) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"\nBucket fireblade-releases status: {data.get('id')} (public: {data.get('public')})")
except Exception as e:
    print(f"\nError querying bucket: {e}")
