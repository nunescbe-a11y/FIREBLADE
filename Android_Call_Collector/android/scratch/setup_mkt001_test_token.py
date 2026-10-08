import os
import json
import hashlib
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

TEST_TOKEN = "test-mkt001-token-secret-12345678901234567890"
token_hash = hashlib.sha256(TEST_TOKEN.encode()).hexdigest()

print(f"Test token: {TEST_TOKEN}")
print(f"Token SHA256: {token_hash}")

# Update or insert into fireblade_device_credentials for MKT-001
record = {
    "device_id": "MKT-001",
    "token_hash": token_hash,
    "enrolled_at": "2026-10-08T00:00:00.000Z",
    "revoked_at": None
}

data = json.dumps(record).encode('utf-8')
req = urllib.request.Request(
    f"{url}/rest/v1/fireblade_device_credentials?on_conflict=device_id",
    data=data,
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        print("Updated fireblade_device_credentials:", resp.read().decode('utf-8'))
except Exception as e:
    print("Error updating credentials:", e)
