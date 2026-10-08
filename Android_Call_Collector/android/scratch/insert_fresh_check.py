import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
import uuid

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

now = datetime.now(timezone.utc)
now_iso = now.isoformat()
expires_iso = (now + timedelta(hours=12)).isoformat()

check_id = str(uuid.uuid4())
req_insert = urllib.request.Request(
    f"{supabase_url}/rest/v1/fireblade_device_checks",
    data=json.dumps({
        "request_id": check_id,
        "device_id": "MKT-019",
        "requested_at": now_iso,
        "expires_at": expires_iso,
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

with urllib.request.urlopen(req_insert) as resp:
    print(f"Created fresh valid check for MKT-019: {check_id}, expires: {expires_iso}")
