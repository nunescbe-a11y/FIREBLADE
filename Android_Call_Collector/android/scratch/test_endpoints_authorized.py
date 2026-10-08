import os
import json
import urllib.request
import urllib.parse
import hmac
import hashlib

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

# Fetch token for MKT-019 and MKT-001 from fireblade_devices
def get_device_token(device_id):
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/fireblade_devices?select=device_id,device_token,enrollment_secret,active,employee_name&device_id=eq.{device_id}&limit=1",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
    )
    with urllib.request.urlopen(req) as resp:
        rows = json.loads(resp.read().decode('utf-8'))
        return rows[0] if rows else None

mkt019 = get_device_token('MKT-019')
mkt001 = get_device_token('MKT-001')

print("MKT-019 info:", mkt019.get('device_id'), mkt019.get('employee_name'), "active:", mkt019.get('active'))
print("MKT-001 info:", mkt001.get('device_id'), mkt001.get('employee_name'), "active:", mkt001.get('active'))

token_019 = mkt019.get('device_token')
token_001 = mkt001.get('device_token')

# Test Release Check for MKT-019 (version_code=28)
backend_base = "https://nunes-call-collector-phase0-cloud.vercel.app"

req_019 = urllib.request.Request(
    f"{backend_base}/api/v3/devices/MKT-019/release?version_code=28",
    headers={"X-Fireblade-Token": token_019}
)
with urllib.request.urlopen(req_019) as resp:
    res_019 = json.loads(resp.read().decode('utf-8'))
    print("\n[MKT-019] Release Check (current code 28):")
    print(json.dumps(res_019, indent=2))

# Test Download endpoint for MKT-019
if res_019.get('available'):
    rel_id = res_019['release']['id']
    req_dl = urllib.request.Request(
        f"{backend_base}/api/v3/devices/MKT-019/releases/{rel_id}/download",
        headers={"X-Fireblade-Token": token_019}
    )
    with urllib.request.urlopen(req_dl) as resp:
        res_dl = json.loads(resp.read().decode('utf-8'))
        print(f"\n[MKT-019] Download URL obtained successfully: {res_dl.get('url')[:80]}...")

# Test Release Check for MKT-001 (code 28) - to verify release is NOT available to MKT-001
req_001 = urllib.request.Request(
    f"{backend_base}/api/v3/devices/MKT-001/release?version_code=28",
    headers={"X-Fireblade-Token": token_001}
)
with urllib.request.urlopen(req_001) as resp:
    res_001 = json.loads(resp.read().decode('utf-8'))
    print("\n[MKT-001] Release Check (current code 28) [Should be available: False]:")
    print(json.dumps(res_001, indent=2))

# Test Marketing Recipient endpoint for MKT-019
req_mkt = urllib.request.Request(
    f"{backend_base}/api/v3/devices/MKT-019/shane/marketing-recipients",
    headers={"X-Fireblade-Token": token_019}
)
try:
    with urllib.request.urlopen(req_mkt) as resp:
        res_mkt = json.loads(resp.read().decode('utf-8'))
        print("\n[MKT-019] GET /api/v3/devices/MKT-019/shane/marketing-recipients:")
        print(f"Status: {resp.status}")
        print(json.dumps(res_mkt, indent=2))
except urllib.error.HTTPError as e:
    print(f"\n[MKT-019] Marketing recipients HTTP Error {e.code}: {e.read().decode('utf-8')}")
except Exception as e:
    print(f"\n[MKT-019] Marketing recipients error: {e}")
