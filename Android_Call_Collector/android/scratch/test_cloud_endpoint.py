import json
import urllib.request
import datetime

now_epoch = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)

payload = {
    "detail_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "device_id": "MKT-001",
    "call_started_at_epoch_ms": now_epoch,
    "phone_number_raw": "9876543210",
    "phone_number_normalized": "+919876543210",
    "customer_name": "Test Customer",
    "product_asked": "Test Product",
    "location": "Test Location",
    "notes": "Test Notes",
    "quotation": True,
    "catalogue": False,
    "image": True,
    "very_urgent": False,
    "updated_at_epoch_ms": now_epoch
}

req = urllib.request.Request(
    "https://nunes-call-collector-phase0-cloud.vercel.app/api/v3/shane/call-details",
    data=json.dumps(payload).encode('utf-8'),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as resp:
        print("Response:", resp.status, resp.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code, e.read().decode())
except Exception as e:
    print("Error:", e)
