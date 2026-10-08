import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone

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

def fetch(path):
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/{path}",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

# Send a CHECK_NOW command for MKT-019 so it triggers an update check / health report next time it syncs
req_id = str(urllib.parse.quote('CHECK_NOW_SHANE_UPDATE', safe=''))
now = datetime.now(timezone.utc).isoformat()
expires = "2026-10-07T12:00:00+00:00"

print("Checking existing device checks for MKT-019...")
checks = fetch("fireblade_device_checks?device_id=eq.MKT-019&status=eq.PENDING")
print("Pending checks:", checks)

if not checks:
    import uuid
    check_id = str(uuid.uuid4())
    req_insert = urllib.request.Request(
        f"{supabase_url}/rest/v1/fireblade_device_checks",
        data=json.dumps({
            "request_id": check_id,
            "device_id": "MKT-019",
            "requested_at": now,
            "expires_at": expires,
            "status": "PENDING",
            "requested_by": "admin"
        }).encode('utf-8'),
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req_insert) as resp:
            print("Successfully requested CHECK_NOW command for MKT-019:", check_id)
    except Exception as e:
        print("Error inserting check:", e)
