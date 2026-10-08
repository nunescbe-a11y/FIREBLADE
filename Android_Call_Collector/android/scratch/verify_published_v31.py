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

# Query fireblade_app_releases directly from Supabase
req_rel = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_app_releases?select=*&status=eq.PUBLISHED&or=(target_device_id.is.null,target_device_id.eq.MKT-019)&order=version_code.desc&limit=1",
    headers={
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
)
with urllib.request.urlopen(req_rel) as resp:
    latest_rows = json.loads(resp.read().decode('utf-8'))
    print("Latest release record matching MKT-019 query:")
    print(json.dumps(latest_rows, indent=2))

latest = latest_rows[0]
version_code_query = 30
available = bool(latest and latest["version_code"] > version_code_query)
print(f"\nEvaluating /api/v3/devices/MKT-019/release?version_code=30 logic:")
print(f"Latest version_code: {latest['version_code']}, Requested: {version_code_query}")
print(f"available: {available}")
if available:
    print("release object returned:")
    print(json.dumps({
        "id": latest["id"],
        "version_code": latest["version_code"],
        "version_name": latest["version_name"],
        "sha256": latest["sha256"],
        "size_bytes": latest["size_bytes"],
        "package_name": latest["package_name"],
        "notes": latest["notes"]
    }, indent=2))

# Also check for global/null-target releases to ensure none exists
req_global = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_app_releases?select=*&target_device_id=is.null&version_code=eq.31",
    headers={
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
)
with urllib.request.urlopen(req_global) as resp:
    globals_found = json.loads(resp.read().decode('utf-8'))
    print(f"\nGlobal release count for code 31: {len(globals_found)} (must be 0)")
