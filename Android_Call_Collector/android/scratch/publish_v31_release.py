import os
import sys
import hashlib
import json
import urllib.request
import urllib.parse
import uuid
import datetime

APK_PATH = r'F:\FIREBLADE_GITHUB\Android_Call_Collector\android\app\build\outputs\apk\release\app-release.apk'
TARGET_DEVICE_ID = 'MKT-019'
VERSION_CODE = 31
VERSION_NAME = '1.7.16'
PACKAGE_NAME = 'com.nunes.callcollector'
OBJECT_PATH = 'android/1.7.16/code31/Fireblade-App-1.7.16-code31.apk'

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

def main():
    print("=== STEP 1: VERIFY LOCAL APK ===")
    if not os.path.exists(APK_PATH):
        raise FileNotFoundError(f"APK not found at {APK_PATH}")
    
    with open(APK_PATH, 'rb') as f:
        apk_bytes = f.read()
    
    actual_sha256 = hashlib.sha256(apk_bytes).hexdigest().upper()
    actual_size = len(apk_bytes)
    
    print(f"APK Size: {actual_size} bytes")
    print(f"APK SHA-256: {actual_sha256}")
    print(f"Version: {VERSION_NAME} (code {VERSION_CODE})")

    env = get_env()
    supabase_url = env['SUPABASE_URL']
    supabase_key = env['SUPABASE_SECRET_KEY']
    print(f"\nSupabase URL: {supabase_url}")

    print("\n=== STEP 2: UPLOAD APK TO SUPABASE STORAGE fireblade-releases ===")
    encoded_path = "/".join(urllib.parse.quote(p, safe='') for p in OBJECT_PATH.split('/'))
    upload_url = f"{supabase_url}/storage/v1/object/fireblade-releases/{encoded_path}"
    
    req_upload = urllib.request.Request(
        upload_url,
        data=apk_bytes,
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/vnd.android.package-archive",
            "x-upsert": "true"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req_upload) as resp:
            upload_resp = resp.read().decode('utf-8')
            print(f"Storage upload successful! Status: {resp.status}, Response: {upload_resp}")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"Upload HTTP error {e.code}: {err_body}")
        raise

    print("\n=== STEP 3: CREATE RELEASE RECORD IN fireblade_app_releases ===")
    release_id = str(uuid.uuid4())
    published_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    record = {
        "id": release_id,
        "version_code": VERSION_CODE,
        "version_name": VERSION_NAME,
        "package_name": PACKAGE_NAME,
        "sha256": actual_sha256.lower(),
        "size_bytes": actual_size,
        "object_path": OBJECT_PATH,
        "status": "PUBLISHED",
        "published_at": published_at,
        "target_device_id": TARGET_DEVICE_ID,
        "notes": "Prevent stale sync worker from blocking call uploads (v1.7.16 code 31)",
        "created_by": "admin"
    }
    
    req_insert = urllib.request.Request(
        f"{supabase_url}/rest/v1/fireblade_app_releases",
        data=json.dumps(record).encode('utf-8'),
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req_insert) as resp:
            insert_resp = json.loads(resp.read().decode('utf-8'))
            print(f"Release record inserted successfully! ID: {release_id}")
            print(json.dumps(insert_resp, indent=2))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"Insert HTTP error {e.code}: {err_body}")
        raise

    print("\n=== STEP 4: VERIFY VIA RELEASE ENDPOINTS ===")
    # 1. Fetch token for MKT-019
    req_token = urllib.request.Request(
        f"{supabase_url}/rest/v1/fireblade_devices?select=device_id,device_token&device_id=eq.MKT-019&limit=1",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
    )
    with urllib.request.urlopen(req_token) as resp:
        dev_rows = json.loads(resp.read().decode('utf-8'))
        token_019 = dev_rows[0].get('device_token')
    
    # 2. Test Cloud Backend release check for MKT-019 (simulating version_code=30)
    backend_url = f"https://nunes-call-collector-phase0-cloud.vercel.app/api/v3/devices/MKT-019/release?version_code=30"
    req_backend = urllib.request.Request(
        backend_url,
        headers={"X-Fireblade-Token": token_019}
    )
    with urllib.request.urlopen(req_backend) as resp:
        backend_resp = json.loads(resp.read().decode('utf-8'))
        print(f"\nLive Backend /api/v3/devices/MKT-019/release?version_code=30:")
        print(json.dumps(backend_resp, indent=2))

    # 3. Isolation check for MKT-001 (code 30) - should return available: False
    req_token_001 = urllib.request.Request(
        f"{supabase_url}/rest/v1/fireblade_devices?select=device_id,device_token&device_id=eq.MKT-001&limit=1",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
    )
    with urllib.request.urlopen(req_token_001) as resp:
        dev_001 = json.loads(resp.read().decode('utf-8'))
        token_001 = dev_001[0].get('device_token')

    req_other = urllib.request.Request(
        f"https://nunes-call-collector-phase0-cloud.vercel.app/api/v3/devices/MKT-001/release?version_code=30",
        headers={"X-Fireblade-Token": token_001}
    )
    with urllib.request.urlopen(req_other) as resp:
        other_resp = json.loads(resp.read().decode('utf-8'))
        print(f"\nLive Backend /api/v3/devices/MKT-001/release?version_code=30 (isolation check):")
        print(json.dumps(other_resp, indent=2))

if __name__ == '__main__':
    main()
