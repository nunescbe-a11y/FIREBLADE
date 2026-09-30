import json
import os
import urllib.error
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

app = FastAPI(title="Fireblade API", version="1.3.0")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")


class CallRow(BaseModel):
    source_call_id: str
    phone_number_raw: str = ""
    phone_number_normalized: str = ""
    contact_name: Optional[str] = None
    direction: str
    started_at_epoch_ms: int
    duration_seconds: int
    phone_account_id: Optional[str] = None
    phone_account_component: Optional[str] = None
    subscription_id: Optional[int] = None
    sim_slot_index: Optional[int] = None


class CallBatch(BaseModel):
    device_id: str
    employee_name: str = ""
    calls: List[CallRow]


class DeviceHealth(BaseModel):
    app_version_code: Optional[int] = None
    permission_state: Optional[dict[str, bool]] = None
    device_id: str
    employee_name: str = ""
    observed_at_epoch_ms: int
    event_type: str = "HEARTBEAT"
    mobile_data_state: str = "UNKNOWN"
    internet_available: Optional[bool] = None
    network_type: Optional[str] = None
    wifi_connected: Optional[bool] = None
    cellular_connected: Optional[bool] = None
    battery_percent: Optional[int] = None
    charging: Optional[bool] = None
    airplane_mode: Optional[bool] = None
    sim_count: Optional[int] = None
    sim1_state: Optional[str] = None
    sim2_state: Optional[str] = None
    default_data_sim_slot: Optional[int] = None
    apk_version: Optional[str] = None
    android_version: Optional[str] = None
    device_model: Optional[str] = None
    pending_uploads: Optional[int] = None
    last_call_sync_epoch_ms: Optional[int] = None
    boot_epoch_ms: Optional[int] = None
    collector_state: Optional[str] = None
    collector_message: Optional[str] = None


def _supabase(method: str, path: str, payload=None, prefer: Optional[str] = None):
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SECRET_KEY are not configured")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", data=data, method=method)
    req.add_header("apikey", SUPABASE_SECRET_KEY)
    if SUPABASE_SECRET_KEY.startswith("eyJ"):
        req.add_header("Authorization", f"Bearer {SUPABASE_SECRET_KEY}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Supabase HTTP {exc.code}: {detail}")


def _iso_from_epoch_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc).isoformat()


@app.get("/health")
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "version": "1.3.0",
        "storage_ready": bool(SUPABASE_URL and SUPABASE_SECRET_KEY),
        "dual_sim_metadata": True,
        "device_health": True,
        "product_intelligence_v5": True,
    }


@app.post("/api/v1/calls/batch")
def calls_batch(batch: CallBatch):
    device_id = batch.device_id.strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id is required")
    if not batch.calls:
        return {"ok": True, "accepted_source_call_ids": [], "message": "Nothing to upload"}

    records = []
    accepted = []
    for call in batch.calls:
        accepted.append(call.source_call_id)
        records.append({
            "device_id": device_id,
            "employee_name": batch.employee_name.strip(),
            "source_call_id": call.source_call_id,
            "phone_number_raw": call.phone_number_raw,
            "phone_number_normalized": call.phone_number_normalized,
            "contact_name": call.contact_name,
            "direction": call.direction,
            "started_at_epoch_ms": call.started_at_epoch_ms,
            "duration_seconds": call.duration_seconds,
            "phone_account_id": call.phone_account_id,
            "phone_account_component": call.phone_account_component,
            "subscription_id": call.subscription_id,
            "sim_slot_index": call.sim_slot_index,
        })

    _supabase(
        "POST",
        "phase0_calls?on_conflict=device_id,source_call_id",
        records,
        "resolution=merge-duplicates,return=minimal",
    )
    return {
        "ok": True,
        "received": len(records),
        "accepted_source_call_ids": accepted,
        "message": f"Uploaded {len(records)} call record(s)",
    }


from api.fireblade_v3 import health_report, install_routes

@app.post("/api/v1/device-health")
def device_health(report: DeviceHealth, x_fireblade_token: Optional[str] = Header(default=None)):
    return health_report(_supabase, report, x_fireblade_token)

install_routes(app, lambda *args, **kwargs: _supabase(*args, **kwargs), DeviceHealth)

# V5 published Fireblade Products search/detail. Additive; V1/V3 device routes remain unchanged.
from api.v5_product_routes import install_v5_product_routes
install_v5_product_routes(app, lambda *args, **kwargs: _supabase(*args, **kwargs))

# V5 WhatsApp Preview V1. Provider sending remains disabled.
from api.v5_whatsapp_routes import install_v5_whatsapp_routes
install_v5_whatsapp_routes(app, lambda *args, **kwargs: _supabase(*args, **kwargs))
