import os
import json
import urllib.request
import hashlib

env = {}
with open(r'F:\FIREBLADE_COMBINED_V3\Fireblade_Website\.env.local', 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

url = env.get('SUPABASE_URL', '')
key = env.get('SUPABASE_SECRET_KEY', '')
headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

def log(msg):
    print(f"[ROLLOUT] {msg}", flush=True)

# Target device allowlist (EXCLUDING MKT-019, MKT-001, MKT-016)
TARGET_DEVICES = [
    "MKT-002", "MKT-003", "MKT-004", "MKT-005", "MKT-006", "MKT-007",
    "MKT-008", "MKT-009", "MKT-010", "MKT-011", "MKT-012", "MKT-013",
    "MKT-014", "MKT-017", "MKT-18"
]

EXCLUDED_DEVICES = ["MKT-019", "MKT-001", "MKT-016"]

apk_path = r'F:\FIREBLADE_GITHUB\Android_Call_Collector\android\app\build\outputs\apk\release\app-release.apk'
with open(apk_path, 'rb') as f:
    apk_data = f.read()

apk_hash = hashlib.sha256(apk_data).hexdigest().lower()
apk_size = len(apk_data)

log(f"Verified APK SHA256: {apk_hash}")
log(f"Verified APK Size: {apk_size} bytes")

# 1. Upload APK to fireblade-releases bucket
storage_path = "android/1.7.17/code32/Fireblade-App-1.7.17-code32.apk"
upload_url = f"{url}/storage/v1/object/fireblade-releases/{storage_path}"

upload_headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
    'Content-Type': 'application/vnd.android.package-archive',
    'x-upsert': 'true'
}

log(f"Uploading APK to storage bucket fireblade-releases: {storage_path}...")
req = urllib.request.Request(upload_url, data=apk_data, headers=upload_headers, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        log(f"Storage upload response: {resp.status} {resp.read().decode('utf-8')}")
except Exception as e:
    log(f"Storage upload warning/error: {e}")

# 2. Publish targeted release records for each device in allowlist
results = []
for dev_id in TARGET_DEVICES:
    payload = {
        "target_device_id": dev_id,
        "version_name": "1.7.17",
        "version_code": 32,
        "package_name": "com.nunes.callcollector",
        "object_path": storage_path,
        "sha256": apk_hash,
        "size_bytes": apk_size,
        "notes": "Fireblade 1.7.17 code32 performance & structured enquiry sync release",
        "status": "PUBLISHED",
        "created_by": "admin"
    }
    
    h = dict(headers)
    h['Prefer'] = 'return=representation'
    req = urllib.request.Request(f"{url}/rest/v1/fireblade_app_releases", data=json.dumps(payload).encode('utf-8'), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            rel_id = data[0]['id'] if data else 'N/A'
            log(f"Published targeted release for {dev_id} -> Release ID: {rel_id}")
            results.append({"device_id": dev_id, "release_id": rel_id, "status": "PUBLISHED"})
    except Exception as e:
        log(f"Failed to publish for {dev_id}: {e}")
        results.append({"device_id": dev_id, "error": str(e), "status": "FAILED"})

# 3. Verify API update check endpoint via Supabase query directly
log("\n--- VERIFYING TARGETED RELEASES IN SUPABASE ---")
req = urllib.request.Request(f"{url}/rest/v1/fireblade_app_releases?version_code=eq.32&order=created_at.desc", headers=headers)
with urllib.request.urlopen(req) as resp:
    rel_rows = json.loads(resp.read().decode('utf-8'))
    log(f"Total targeted release records published for code 32: {len(rel_rows)}")
    published_target_devices = [r.get("target_device_id") for r in rel_rows]
    log(f"Targeted device IDs in DB: {published_target_devices}")
    
    assert "MKT-019" not in published_target_devices, "CRITICAL ERROR: MKT-019 was published!"
    assert "MKT-001" not in published_target_devices, "CRITICAL ERROR: MKT-001 was published!"
    assert "MKT-016" not in published_target_devices, "CRITICAL ERROR: MKT-016 was published!"
    log("CONFIRMED: MKT-019, MKT-001, and MKT-016 are STRICTLY EXCLUDED from targeted release records.")

# 4. Check device update statuses / installed versions
log("\n--- CHECKING DEVICE UPDATE STATUSES & INSTALLED VERSIONS ---")
req = urllib.request.Request(f"{url}/rest/v1/fireblade_update_status?select=device_id,stage,app_version_code,last_checked_at", headers=headers)
with urllib.request.urlopen(req) as resp:
    up_rows = json.loads(resp.read().decode('utf-8'))
    print(json.dumps(up_rows, indent=2))

log("\nSummary of targeted release publication:")
print(json.dumps(results, indent=2))
