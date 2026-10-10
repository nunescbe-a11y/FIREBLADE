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


# Employee workspace: the Android client calls this endpoint when refreshing
# Fireblade configuration. Keep this separate from Shane's customer inbox.
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, time as _time
from zoneinfo import ZoneInfo as _ZoneInfo
from urllib.parse import quote as _quote
from api.fireblade_v3 import authorize as _authorize_device


@app.get("/api/v3/devices/{device_id}/employee-workspace")
def employee_workspace(
    device_id: str,
    date: Optional[str] = None,
    x_fireblade_token: Optional[str] = Header(default=None)
):
    device_id = device_id.strip().upper()
    _authorize_device(_supabase, device_id, x_fireblade_token)
    if date:
        try:
            selected = _date.fromisoformat(date)
            if selected.isoformat() != date:
                raise ValueError("invalid format")
        except ValueError:
            raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
    else:
        selected = _datetime.now(_ZoneInfo("Asia/Kolkata")).date()

    start = _datetime.combine(selected, _time.min, tzinfo=_ZoneInfo("Asia/Kolkata"))
    start_ms = int(start.timestamp() * 1000)
    end_ms = int((start + _timedelta(days=1)).timestamp() * 1000)

    _, active_assignments = _supabase(
        "GET", "fireblade_device_assignments?select=employee_id,device_id,assigned_from"
        f"&device_id=eq.{_quote(device_id, safe='')}&assigned_until=is.null&limit=2"
    )
    if not active_assignments or len(active_assignments) != 1:
        raise HTTPException(status_code=409, detail="Device requires exactly one active employee assignment")
    employee_id = str(active_assignments[0]["employee_id"])
    _, employee_rows = _supabase(
        "GET", "fireblade_employees?select=employee_id,employee_name,department_id,profile_photo_updated_at"
        f"&employee_id=eq.{_quote(employee_id, safe='')}&active=eq.true&limit=1"
    )
    if not employee_rows:
        raise HTTPException(status_code=409, detail="Assigned employee is inactive or missing")
    employee = employee_rows[0]
    department_name = ""
    if employee.get("department_id"):
        _, depts = _supabase(
            "GET", "fireblade_departments?select=name"
            f"&id=eq.{_quote(str(employee['department_id']), safe='')}&active=eq.true&limit=1"
        )
        if depts:
            department_name = str(depts[0].get("name") or "")

    _, assignments = _supabase(
        "GET", "fireblade_device_assignments?select=device_id"
        f"&employee_id=eq.{_quote(employee_id, safe='')}&assigned_until=is.null&limit=100"
    )
    device_ids = sorted({str(row.get("device_id") or "") for row in (assignments or []) if row.get("device_id")})
    if device_id not in device_ids:
        raise HTTPException(status_code=409, detail="Current device assignment changed")

    device_filter = ",".join(_quote(d, safe="") for d in device_ids)
    _, devices = _supabase(
        "GET", "fireblade_devices?select=device_id,device_name,phone_label"
        f"&device_id=in.({device_filter})&active=eq.true&limit=100"
    )
    _, lines = _supabase(
        "GET", "fireblade_device_lines?select=id,device_id,sim_slot_index,phone_number,line_label,carrier_name"
        f"&device_id=in.({device_filter})&active=eq.true&order=device_id.asc,sim_slot_index.asc&limit=200"
    )

    # Constrain the response by employee, date, and row count to keep phone
    # refresh traffic small. Pending callbacks may span several days.
    _, rows = _supabase(
        "GET",
        "fireblade_incoming_calls?"
        "select=call_id,device_id,phone_number_raw,phone_number_normalized,phone_contact_name,"
        "direction,started_at_epoch_ms,duration_seconds,resolved_line_id,company_phone_number,"
        "resolved_line_label,resolved_line_carrier,resolved_sim_slot_index"
        f"&registered_employee_id=eq.{_quote(employee_id, safe='')}"
        f"&started_at_epoch_ms=gte.{start_ms}&started_at_epoch_ms=lt.{end_ms}"
        "&order=started_at_epoch_ms.desc&limit=201"
    )
    rows = rows or []
    limited = len(rows) > 200
    calls = [{
        "call_id": row["call_id"],
        "device_id": row["device_id"],
        "phone_number_raw": row.get("phone_number_raw") or "",
        "phone_number_normalized": row.get("phone_number_normalized") or "",
        "contact_name": row.get("phone_contact_name"),
        "direction": row.get("direction") or "",
        "started_at_epoch_ms": row.get("started_at_epoch_ms") or 0,
        "duration_seconds": row.get("duration_seconds") or 0,
        "line_id": row.get("resolved_line_id"),
        "company_phone_number": row.get("company_phone_number"),
        "line_label": row.get("resolved_line_label"),
        "carrier_name": row.get("resolved_line_carrier"),
        "sim_slot_index": row.get("resolved_sim_slot_index"),
    } for row in rows[:200]]

    _, pending_rows = _supabase(
        "GET", "fireblade_missed_call_tasks?"
        "select=missed_call_id,missed_device_id,phone_number_raw,phone_number_normalized,missed_at_epoch_ms"
        f"&employee_id=eq.{_quote(employee_id, safe='')}&callback_status=eq.PENDING"
        "&order=missed_at_epoch_ms.desc&limit=100"
    )
    pending_rows = pending_rows or []
    pending_callbacks = [{
        "customer_key": str(row.get("missed_call_id") or ""),
        "phone_number_raw": row.get("phone_number_raw") or "",
        "phone_number_normalized": row.get("phone_number_normalized") or "",
        "first_miss_at_epoch_ms": row.get("missed_at_epoch_ms") or 0,
        "latest_miss_at_epoch_ms": row.get("missed_at_epoch_ms") or 0,
        "missed_count": 1,
        "ring_seconds": 0,
        "sim_slot_index": None,
    } for row in pending_rows]
    return {
        "ok": True,
        "date": selected.isoformat(),
        "employee": {
            "employee_id": employee_id,
            "employee_name": employee.get("employee_name") or "",
            "department_name": department_name,
            "profile_photo_updated_at": employee.get("profile_photo_updated_at"),
            "profile_photo_url": None,
        },
        "identity": {
            "current_device_id": device_id,
            "revision": str(active_assignments[0].get("assigned_from") or ""),
            "device_count": len(devices or []),
            "sim_count": len(lines or []),
            "devices": devices or [],
            "lines": lines or [],
        },
        "metrics": {
            "total_incoming": len(calls),
            "answered_calls": sum(1 for c in calls if c["direction"] == "INCOMING_ANSWERED"),
            "missed_calls": sum(1 for c in calls if c["direction"] == "INCOMING_MISSED"),
            "resolved_callbacks": 0,
        },
        "pending_callbacks": pending_callbacks,
        "calls": calls,
        "history_limit_reached": limited,
    }


# V5 published Fireblade Products search/detail. Additive; V1/V3 device routes remain unchanged.
from api.v5_product_routes import install_v5_product_routes
install_v5_product_routes(app, lambda *args, **kwargs: _supabase(*args, **kwargs))

# V5 WhatsApp Preview V1. Provider sending remains disabled.
from api.v5_whatsapp_routes import install_v5_whatsapp_routes
install_v5_whatsapp_routes(app, lambda *args, **kwargs: _supabase(*args, **kwargs))
