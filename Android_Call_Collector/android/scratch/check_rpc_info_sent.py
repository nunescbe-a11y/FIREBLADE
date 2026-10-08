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

# Call RPC with p_start_date and p_end_date
data = json.dumps({"p_start_date": "2026-10-01", "p_end_date": "2026-10-10"}).encode('utf-8')
req = urllib.request.Request(
    f"{url}/rest/v1/rpc/fireblade_information_sent_report",
    data=data,
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        rows = json.loads(resp.read().decode('utf-8'))
        print(f"fireblade_information_sent_report rows count: {len(rows)}")
        if rows:
            print("First row sample:")
            print(json.dumps(rows[0], indent=2))
except Exception as e:
    print("Error calling RPC:", e)
