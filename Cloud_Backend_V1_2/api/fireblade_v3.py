"""Authenticated device control. The V1 call ingestion endpoint remains independent."""
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional, Literal
from urllib.parse import quote
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field


def utcnow():
    return datetime.now(timezone.utc)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def authorize(db, device_id, token):
    if not token or not 20 <= len(token) <= 256:
        raise HTTPException(401, "Device enrollment required")
    _, rows = db("GET", f"fireblade_device_credentials?select=token_hash,revoked_at&device_id=eq.{quote(device_id, safe='')}&limit=1")
    if not rows or rows[0].get("revoked_at") or not secrets.compare_digest(rows[0]["token_hash"], digest(token)):
        raise HTTPException(401, "Invalid device credential")
    _, active = db("GET", f"fireblade_devices?select=device_id&device_id=eq.{quote(device_id, safe='')}&active=eq.true&limit=1")
    if not active:
        raise HTTPException(403, "Device is inactive")


def health_report(db, report, token=None):
    device_id = report.device_id.strip().upper()
    if not device_id:
        raise HTTPException(400, "Device ID required")
    verified = bool(token)
    if verified:
        authorize(db, device_id, token)
    else:
        _, rows = db("GET", f"fireblade_devices?select=device_id&device_id=eq.{quote(device_id, safe='')}&active=eq.true&limit=1")
        if not rows:
            raise HTTPException(404, "Unknown or inactive device")
        # An enrolled phone can no longer be impersonated through the legacy health route.
        _, creds = db("GET", f"fireblade_device_credentials?select=device_id&device_id=eq.{quote(device_id, safe='')}&limit=1")
        if creds:
            raise HTTPException(401, "Device credential required")
    now = utcnow()
    observed = report.observed_at_epoch_ms
    if observed <= 0:
        raise HTTPException(400, "Invalid observation time")
    current = report.model_dump()
    current.pop("observed_at_epoch_ms", None)
    current["device_id"] = device_id
    current["observed_at_epoch_ms"] = observed
    current["received_at"] = now.isoformat()
    current["heartbeat_at"] = now.isoformat()
    current["updated_at"] = now.isoformat()
    current["source_verified"] = verified
    current["event_type"] = report.event_type.strip().upper()
    current["mobile_data_state"] = report.mobile_data_state if report.mobile_data_state in {"ON", "OFF", "UNKNOWN"} else "UNKNOWN"
    # A shutdown broadcast can only support a short-lived, authenticated observation.
    shutdown_recent = abs(now.timestamp() * 1000 - observed) <= 120_000
    current["shutdown_confirmed_at"] = now.isoformat() if verified and shutdown_recent and current["event_type"] == "SHUTDOWN" else None
    _, result = db("POST", "rpc/fireblade_accept_health", {"p_report": current})
    return {"ok": True, "device_id": device_id, "accepted": result, "message": "Device status received"}


class Enrollment(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=20, max_length=128)


class PushToken(BaseModel):
    token: str = Field(min_length=20, max_length=4096)


class UpdateReport(BaseModel):
    release_id: Optional[str] = None
    stage: Literal["CURRENT", "AVAILABLE", "DOWNLOADING", "AWAITING_INSTALL", "FAILED"]
    app_version_code: int = Field(ge=1)
    message: str = Field(default="", max_length=300)


def install_routes(app, db, health_model):
    @app.post("/api/v3/enroll")
    def enroll(body: Enrollment):
        token = secrets.token_urlsafe(32)
        _, accepted = db("POST", "rpc/fireblade_enroll_device", {
            "p_device_id": body.device_id.strip().upper(), "p_code_hash": digest(body.code), "p_token_hash": digest(token)
        })
        if not accepted:
            raise HTTPException(401, "Enrollment code is invalid, expired or already used")
        return {"device_token": token}

    @app.post("/api/v3/devices/{device_id}/push-token")
    def push_token(device_id: str, body: PushToken, x_fireblade_token: Optional[str] = Header(default=None)):
        authorize(db, device_id, x_fireblade_token)
        db("POST", "fireblade_push_tokens?on_conflict=device_id", {"device_id": device_id, "token": body.token, "updated_at": utcnow().isoformat()}, "resolution=merge-duplicates,return=minimal")
        return {"ok": True}

    @app.get("/api/v3/devices/{device_id}/commands")
    def commands(device_id: str, x_fireblade_token: Optional[str] = Header(default=None)):
        authorize(db, device_id, x_fireblade_token)
        now = utcnow().isoformat()
        _, rows = db("GET", f"fireblade_device_checks?select=request_id,expires_at&device_id=eq.{quote(device_id,safe='')}&status=eq.PENDING&expires_at=gt.{quote(now,safe='')}&order=requested_at.desc&limit=5")
        return {"commands": [{"command": "CHECK_NOW", **r} for r in (rows or [])]}

    @app.post("/api/v3/devices/{device_id}/checks/{request_id}")
    def respond(device_id: str, request_id: str, report: health_model, x_fireblade_token: Optional[str] = Header(default=None)):
        authorize(db, device_id, x_fireblade_token)
        if report.device_id.strip().upper() != device_id:
            raise HTTPException(400, "Snapshot device does not match request")
        from uuid import UUID
        try:
            UUID(request_id)
        except ValueError:
            raise HTTPException(400, "Invalid request ID")
        snapshot = report.model_dump()
        # Database atomically matches request/device/deadline and accepts only the first response.
        _, accepted = db("POST", "rpc/fireblade_respond_check", {"p_request_id": request_id, "p_device_id": device_id, "p_snapshot": snapshot})
        if not accepted:
            raise HTTPException(409, "Request expired, already answered or does not belong to this device")
        return {"ok": True, "request_id": request_id}

    @app.get("/api/v3/devices/{device_id}/release")
    def release(device_id: str, version_code: int, x_fireblade_token: Optional[str] = Header(default=None)):
        authorize(db, device_id, x_fireblade_token)
        _, rows = db("GET", f"fireblade_app_releases?select=*&status=eq.PUBLISHED&or=(target_device_id.is.null,target_device_id.eq.{quote(device_id, safe='')})&order=version_code.desc&limit=1")
        latest = rows[0] if rows else None
        available = bool(latest and latest["version_code"] > version_code)
        db("POST", "fireblade_update_status?on_conflict=device_id", {
            "device_id": device_id, "release_id": latest["id"] if latest else None,
            "stage": "AVAILABLE" if available else "CURRENT", "app_version_code": version_code,
            "last_checked_at": utcnow().isoformat(), "message": ""
        }, "resolution=merge-duplicates,return=minimal")
        if not available:
            return {"available": False}
        return {"available": True, "release": {k: latest[k] for k in ["id", "version_code", "version_name", "sha256", "size_bytes", "package_name", "notes"]}}

    @app.get("/api/v3/devices/{device_id}/releases/{release_id}/download")
    def download(device_id: str, release_id: str, x_fireblade_token: Optional[str] = Header(default=None)):
        authorize(db, device_id, x_fireblade_token)
        from uuid import UUID
        try:
            UUID(release_id)
        except ValueError:
            raise HTTPException(400, "Invalid release")
        _, rows = db("GET", f"fireblade_app_releases?select=object_path&status=eq.PUBLISHED&id=eq.{release_id}&or=(target_device_id.is.null,target_device_id.eq.{quote(device_id, safe='')})&limit=1")
        if not rows:
            raise HTTPException(404, "Release not available")
        import json, os, urllib.request
        base = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SECRET_KEY"]
        path = quote(rows[0]["object_path"], safe="/")
        req = urllib.request.Request(f"{base}/storage/v1/object/sign/fireblade-releases/{path}", data=json.dumps({"expiresIn": 600}).encode(), method="POST", headers={"apikey": key, "Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key.startswith("eyJ") else {})})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                result = json.load(response)
            signed = result["signedURL"]
            return {"url": f"{base}/storage/v1{signed}"}
        except Exception:
            raise HTTPException(502, "Could not prepare app download")

    @app.post("/api/v3/devices/{device_id}/update-status")
    def update_status(device_id: str, body: UpdateReport, x_fireblade_token: Optional[str] = Header(default=None)):
        authorize(db, device_id, x_fireblade_token)
        if body.release_id:
            from uuid import UUID
            try:
                UUID(body.release_id)
            except ValueError:
                raise HTTPException(400, "Invalid release")
        db("POST", "fireblade_update_status?on_conflict=device_id", {"device_id": device_id, **body.model_dump(), "last_checked_at": utcnow().isoformat()}, "resolution=merge-duplicates,return=minimal")
        return {"ok": True}
