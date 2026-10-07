"""Authenticated device control. The V1 call ingestion endpoint remains independent."""
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional, Literal
from urllib.parse import quote
from fastapi import Header, HTTPException, UploadFile, File, Form
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


class ShaneCallDetail(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    detail_id: str = Field(min_length=36, max_length=36)
    source_call_id: Optional[str] = Field(default=None, max_length=128)
    phone_number_raw: str = Field(default="", max_length=100)
    phone_number_normalized: str = Field(default="", max_length=100)
    call_started_at_epoch_ms: int = Field(gt=0)
    customer_name: str = Field(default="", max_length=200)
    product_asked: str = Field(default="", max_length=300)
    location: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=4000)
    quotation: bool = False
    catalogue: bool = False
    image: bool = False
    very_urgent: bool = False
    updated_at_epoch_ms: int = Field(gt=0)


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

    @app.get("/api/v3/devices/{device_id}/identity")
    def device_identity(device_id: str, x_fireblade_token: Optional[str] = Header(default=None)):
        device_id = device_id.strip().upper()
        authorize(db, device_id, x_fireblade_token)

        _, assignments = db(
            "GET",
            "fireblade_device_assignments?"
            "select=employee_id&device_id=eq." + quote(device_id, safe="") +
            "&assigned_until=is.null&limit=2"
        )
        if not assignments:
            raise HTTPException(409, "Device has no active employee assignment")
        if len(assignments) != 1:
            raise HTTPException(409, "Device has multiple active employee assignments")

        employee_id = assignments[0].get("employee_id")
        _, employees = db(
            "GET",
            "fireblade_employees?select=employee_id,employee_name,department_id"
            "&employee_id=eq." + quote(str(employee_id), safe="") +
            "&active=eq.true&limit=1"
        )
        if not employees:
            raise HTTPException(409, "Assigned employee is inactive or missing")

        employee = employees[0]
        department_name = ""
        department_id = employee.get("department_id")
        if department_id:
            _, departments = db(
                "GET",
                "fireblade_departments?select=name&id=eq." +
                quote(str(department_id), safe="") +
                "&active=eq.true&limit=1"
            )
            if departments:
                department_name = str(departments[0].get("name", "")).strip()

        return {
            "device_id": device_id,
            "employee": {
                "employee_id": employee.get("employee_id") or "",
                "employee_name": employee.get("employee_name") or "",
                "department_name": department_name
            }
        }

    @app.get("/api/v3/devices/{device_id}/shane/marketing-recipients")
    def shane_marketing_recipients(
        device_id: str,
        x_fireblade_token: Optional[str] = Header(default=None)
    ):
        device_id = device_id.strip().upper()
        authorize(db, device_id, x_fireblade_token)

        _, assignments = db(
            "GET",
            "fireblade_device_assignments?"
            "select=employee_id&device_id=eq." + quote(device_id, safe="") +
            "&assigned_until=is.null&limit=2"
        )
        if not assignments or len(assignments) != 1:
            raise HTTPException(409, "Shane recipient list requires one active employee assignment")

        employee_id = str(assignments[0].get("employee_id") or "")
        _, employees = db(
            "GET",
            "fireblade_employees?select=employee_id,department_id"
            "&employee_id=eq." + quote(employee_id, safe="") +
            "&active=eq.true&limit=1"
        )
        if not employees or not employees[0].get("department_id"):
            raise HTTPException(403, "Employee department is not configured")

        _, current_departments = db(
            "GET",
            "fireblade_departments?select=name&id=eq." +
            quote(str(employees[0]["department_id"]), safe="") +
            "&active=eq.true&limit=1"
        )
        current_department_name = (
            str(current_departments[0].get("name", "")).strip().upper()
            if current_departments else ""
        )
        if current_department_name != "SHANE":
            raise HTTPException(403, "Marketing recipients are restricted to the SHANE department")

        _, active_departments = db(
            "GET",
            "fireblade_departments?select=id,name&active=eq.true"
        )
        marketing_department_ids = {
            str(row.get("id"))
            for row in (active_departments or [])
            if str(row.get("name", "")).strip().upper() == "MARKETING" and row.get("id")
        }
        service_department_ids = {
            str(row.get("id"))
            for row in (active_departments or [])
            if str(row.get("name", "")).strip().upper() == "SERVICE" and row.get("id")
        }
        # Shane may also route enquiries to Alagupriya in SERVICE.
        # Keep this explicit so we do not expose every SERVICE employee.
        special_service_recipient_ids = {"EMP-008"}

        _, recipient_employees = db(
            "GET",
            "fireblade_employees?select=employee_id,employee_name,department_id"
            "&active=eq.true&order=employee_name.asc"
        )
        recipient_employees = [
            row for row in (recipient_employees or [])
            if (
                str(row.get("department_id")) in marketing_department_ids
                or (
                    str(row.get("employee_id") or "").strip() in special_service_recipient_ids
                    and str(row.get("department_id")) in service_department_ids
                )
            )
        ]

        _, active_assignments = db(
            "GET",
            "fireblade_device_assignments?"
            "select=employee_id,device_id,company_phone_number,assigned_from"
            "&assigned_until=is.null&order=assigned_from.desc"
        )
        _, active_devices = db(
            "GET",
            "fireblade_devices?select=device_id,company_phone_number&active=eq.true"
        )
        device_phones = {
            str(row.get("device_id") or "").strip().upper():
                str(row.get("company_phone_number") or "").strip()
            for row in (active_devices or [])
            if str(row.get("device_id") or "").strip()
        }

        assignments_by_employee = {}
        for row in (active_assignments or []):
            assigned_employee_id = str(row.get("employee_id") or "").strip()
            if assigned_employee_id:
                assignments_by_employee.setdefault(assigned_employee_id, []).append(row)

        recipients = []
        for employee in recipient_employees:
            recipient_employee_id = str(employee.get("employee_id") or "").strip()
            phone_number = ""
            employee_assignments = assignments_by_employee.get(recipient_employee_id, [])

            for row in employee_assignments:
                candidate = str(row.get("company_phone_number") or "").strip()
                if candidate:
                    phone_number = candidate
                    break

            if not phone_number:
                for row in employee_assignments:
                    assigned_device_id = str(row.get("device_id") or "").strip().upper()
                    candidate = device_phones.get(assigned_device_id, "")
                    if candidate:
                        phone_number = candidate
                        break

            recipients.append({
                "employee_id": recipient_employee_id,
                "employee_name": str(employee.get("employee_name") or "").strip(),
                "phone_number": phone_number,
                "available": bool(phone_number)
            })

        return {"department": "MARKETING", "employees": recipients}

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

    @app.post("/api/v3/shane/call-details")
    @app.post("/api/v3/call-details")
    def save_shane_call_details(
        body: ShaneCallDetail,
        x_fireblade_token: Optional[str] = Header(default=None)
    ):
        device_id = body.device_id.strip().upper()
        authorize(db, device_id, x_fireblade_token)

        import uuid
        try:
            detail_id = str(uuid.UUID(body.detail_id))
        except ValueError:
            raise HTTPException(400, "Invalid detail_id format")

        source_call_id = body.source_call_id.strip() if body.source_call_id else None
        if source_call_id == "":
            source_call_id = None

        started_iso = datetime.fromtimestamp(
            body.call_started_at_epoch_ms / 1000.0,
            tz=timezone.utc
        ).isoformat()
        _, assignments = db(
            "GET",
            "fireblade_device_assignments?"
            "select=employee_id&device_id=eq." + quote(device_id, safe="") +
            "&assigned_from=lte." + quote(started_iso, safe="") +
            "&or=(assigned_until.is.null,assigned_until.gte." + quote(started_iso, safe="") + ")"
        )
        if not assignments or len(assignments) != 1:
            raise HTTPException(409, "Call details require one active employee assignment")

        employee_id = assignments[0].get("employee_id")

        call_id = None
        if source_call_id:
            _, calls = db(
                "GET",
                "phase0_calls?select=id&device_id=eq." + quote(device_id, safe="") +
                "&source_call_id=eq." + quote(source_call_id, safe="") +
                "&limit=1"
            )
            if calls:
                call_id = calls[0]["id"]
        if not call_id and body.phone_number_normalized:
            _, calls = db(
                "GET",
                "phase0_calls?select=id&device_id=eq." + quote(device_id, safe="") +
                "&phone_number_normalized=eq." + quote(body.phone_number_normalized, safe="") +
                f"&started_at_epoch_ms=gte.{body.call_started_at_epoch_ms - 90000}" +
                f"&started_at_epoch_ms=lte.{body.call_started_at_epoch_ms + 90000}" +
                "&order=started_at_epoch_ms.desc&limit=1"
            )
            if calls:
                call_id = calls[0]["id"]

        # Structured enquiry sync to contacts, enquiries, and information sent
        if call_id:
            try:
                contact_id = None
                norm_phone = body.phone_number_normalized.strip()
                if norm_phone:
                    _, contacts = db(
                        "GET",
                        "fireblade_contacts?select=id&phone_number_normalized=eq." + quote(norm_phone, safe="") + "&limit=1"
                    )
                    if contacts:
                        contact_id = contacts[0]["id"]
                        patch_contact = {}
                        if body.customer_name.strip():
                            patch_contact["person_name"] = body.customer_name.strip()
                        if body.location.strip():
                            patch_contact["location"] = body.location.strip()
                        if patch_contact:
                            db("PATCH", f"fireblade_contacts?id=eq.{quote(str(contact_id), safe='')}", patch_contact)
                    else:
                        _, created_c = db("POST", "fireblade_contacts", {
                            "phone_number_raw": body.phone_number_raw.strip(),
                            "phone_number_normalized": norm_phone,
                            "person_name": body.customer_name.strip(),
                            "location": body.location.strip(),
                            "created_by": employee_id
                        }, "return=representation")
                        if created_c and len(created_c) > 0:
                            contact_id = created_c[0].get("id")

                if contact_id:
                    _, enq_existing = db("GET", f"fireblade_call_enquiries?select=id&call_id=eq.{call_id}&limit=1")
                    enquiry_id = None
                    if enq_existing:
                        enquiry_id = enq_existing[0]["id"]
                        db("PATCH", f"fireblade_call_enquiries?id=eq.{quote(str(enquiry_id), safe='')}", {
                            "contact_id": contact_id,
                            "product_name": body.product_asked.strip(),
                            "location": body.location.strip(),
                            "notes": body.notes.strip(),
                            "status": "COMPLETED",
                            "resolution_outcome": "DETAILS_ENTERED",
                            "updated_by": employee_id,
                            "updated_at": utcnow().isoformat()
                        })
                    else:
                        _, created_e = db("POST", "fireblade_call_enquiries", {
                            "call_id": call_id,
                            "contact_id": contact_id,
                            "product_name": body.product_asked.strip(),
                            "location": body.location.strip(),
                            "notes": body.notes.strip(),
                            "status": "COMPLETED",
                            "entered_by": employee_id,
                            "resolution_outcome": "DETAILS_ENTERED",
                            "resolution_at": utcnow().isoformat(),
                            "resolution_by": employee_id,
                            "created_at": utcnow().isoformat(),
                            "updated_at": utcnow().isoformat()
                        }, "return=representation")
                        if created_e and len(created_e) > 0:
                            enquiry_id = created_e[0].get("id")

                    if enquiry_id:
                        _, info_types = db("GET", "fireblade_information_types?select=id,code&active=eq.true")
                        if info_types:
                            type_map = {t["code"].upper(): t["id"] for t in info_types if "code" in t and "id" in t}
                            bool_map = {
                                "QUOTATION": bool(body.quotation),
                                "CATALOGUE": bool(body.catalogue),
                                "IMAGE": bool(body.image)
                            }
                            for code, is_sent in bool_map.items():
                                if code in type_map:
                                    type_id = type_map[code]
                                    db("POST", "fireblade_enquiry_information_sent?on_conflict=enquiry_id,information_type_id", {
                                        "enquiry_id": enquiry_id,
                                        "information_type_id": type_id,
                                        "sent": is_sent,
                                        "answered_by": employee_id,
                                        "updated_at": utcnow().isoformat()
                                    }, "resolution=merge-duplicates,return=minimal")
            except Exception:
                pass

        _, existing = db(
            "GET",
            "fireblade_shane_call_details?"
            "select=device_id,client_updated_at_epoch_ms"
            "&detail_id=eq." + quote(detail_id, safe="") +
            "&limit=1"
        )
        if existing:
            row = existing[0]
            if row.get("device_id") != device_id:
                raise HTTPException(409, "Duplicate detail ID with different device")
            if int(row.get("client_updated_at_epoch_ms") or 0) > body.updated_at_epoch_ms:
                return {"ok": True, "detail_id": detail_id, "stale_ignored": True}

        record = {
            "detail_id": detail_id,
            "call_id": call_id,
            "source_call_id": source_call_id,
            "device_id": device_id,
            "employee_id": employee_id,
            "phone_number_raw": body.phone_number_raw.strip(),
            "phone_number_normalized": body.phone_number_normalized.strip(),
            "call_started_at_epoch_ms": body.call_started_at_epoch_ms,
            "customer_name": body.customer_name.strip(),
            "product_asked": body.product_asked.strip(),
            "location": body.location.strip(),
            "notes": body.notes.strip(),
            "very_urgent": body.very_urgent,
            "client_updated_at_epoch_ms": body.updated_at_epoch_ms,
            "updated_at": utcnow().isoformat()
        }

        if existing:
            db(
                "PATCH",
                "fireblade_shane_call_details?detail_id=eq." + quote(detail_id, safe=""),
                record
            )
        else:
            record["created_at"] = utcnow().isoformat()
            db("POST", "fireblade_shane_call_details", record)

        return {"ok": True, "detail_id": detail_id}

    @app.post("/api/v3/recordings")
    def upload_recording(
        device_id: str = Form(...),
        recording_id: str = Form(...),
        source_call_id: Optional[str] = Form(None),
        sha256: Optional[str] = Form(None),
        recording_source: str = Form(...),
        audio_scope: str = Form(...),
        capability: str = Form(...),
        employee_notice_status: str = Form(...),
        customer_consent_status: str = Form(...),
        consent_basis: str = Form(...),
        duration_ms: int = Form(...),
        started_at_epoch_ms: int = Form(...),
        ended_at_epoch_ms: int = Form(...),
        mime_type: str = Form(...),
        phone_number: Optional[str] = Form(None),
        direction: Optional[str] = Form(None),
        file: Optional[UploadFile] = File(None),
        x_fireblade_token: Optional[str] = Header(default=None)
    ):
        authorize(db, device_id, x_fireblade_token)
        
        import uuid
        try:
            recording_id = str(uuid.UUID(recording_id))
        except ValueError:
            raise HTTPException(400, "Invalid recording_id format")

        
        if source_call_id is not None and source_call_id.strip() == "":
            source_call_id = None
        if phone_number is not None and phone_number.strip() == "":
            phone_number = None
        if direction is not None and direction.strip() == "":
            direction = None
            
        is_metadata_only = recording_source in ("OS_BLOCKED", "UNSUPPORTED", "FAILED_BLOCKED_BY_OS", "FAILED_UNSUPPORTED", "FAILED_DURING_STOP")
        
        content = None
        if not is_metadata_only:
            if mime_type != "audio/mp4":
                raise HTTPException(400, "Unsupported MIME type")
            if not file:
                raise HTTPException(400, "Audio file is required for this recording source")
            if not sha256:
                raise HTTPException(400, "sha256 is required for audio uploads")
            
            content = file.file.read()
            if not content:
                raise HTTPException(400, "Audio file payload is empty")
            if len(content) > 50 * 1024 * 1024:
                raise HTTPException(413, "File too large")
            
            actual_sha = hashlib.sha256(content).hexdigest()
            if actual_sha != sha256:
                raise HTTPException(400, "Checksum mismatch")
            
        # Resolve call_id
        call_id = None
        if source_call_id:
            _, calls = db("GET", f"phase0_calls?select=id&device_id=eq.{quote(device_id, safe='')}&source_call_id=eq.{quote(source_call_id, safe='')}&limit=1")
            if calls:
                call_id = calls[0]["id"]
                
        # Resolve employee_id unambiguously using recording_started_at_epoch_ms
        employee_id = None
        started_iso = datetime.fromtimestamp(started_at_epoch_ms / 1000.0, tz=timezone.utc).isoformat()
        _, assignments = db("GET", f"fireblade_device_assignments?select=employee_id&device_id=eq.{quote(device_id, safe='')}&assigned_from=lte.{quote(started_iso, safe='')}&or=(assigned_until.is.null,assigned_until.gte.{quote(started_iso, safe='')})")
        if assignments and len(assignments) == 1:
            employee_id = assignments[0].get("employee_id")
            
        # Idempotency pre-check
        _, existing = db("GET", f"fireblade_call_recordings?select=device_id,sha256,upload_status&recording_id=eq.{quote(recording_id, safe='')}&limit=1")
        if existing:
            row = existing[0]
            if row.get("device_id") != device_id:
                raise HTTPException(409, "Duplicate recording ID with different device")
            if not is_metadata_only and row.get("sha256") != sha256:
                raise HTTPException(409, "Duplicate recording ID with different checksum")
            if row.get("upload_status") == "SUCCESS":
                return {"ok": True, "recording_id": recording_id}
        else:
            # Create reserved row
            record = {
                "recording_id": recording_id,
                "call_id": call_id,
                "employee_id": employee_id,
                "device_id": device_id,
                "source_call_id": source_call_id,
                "phone_number": phone_number,
                "direction": direction,
                "recording_started_at_epoch_ms": started_at_epoch_ms,
                "recording_ended_at_epoch_ms": ended_at_epoch_ms,
                "duration_ms": duration_ms,
                "recording_source": recording_source,
                "recording_status": recording_source if is_metadata_only else "PENDING",
                "audio_scope": audio_scope,
                "capability": capability,
                "employee_notice_status": employee_notice_status,
                "customer_consent_status": customer_consent_status,
                "consent_basis": consent_basis,
                "mime_type": mime_type,
                "file_size_bytes": 0,
                "sha256": sha256 if not is_metadata_only else None,
                "storage_bucket": None,
                "storage_object_path": None,
                "upload_status": "PENDING",
                "uploaded_at": None,
                "last_error": None
            }
            try:
                db("POST", "fireblade_call_recordings", record)
            except HTTPException as e:
                if "duplicate key value violates unique constraint" in str(e.detail):
                    raise HTTPException(409, "Duplicate recording")
                raise
        
        if not is_metadata_only:
            storage_path = f"{device_id}/{recording_id[:2]}/{recording_id}.mp4"
            import os, urllib.request, json
            base = os.environ.get("SUPABASE_URL", "http://localhost").rstrip("/")
            key = os.environ.get("SUPABASE_SECRET_KEY", "")
            safe_storage_path = quote(storage_path, safe="/")
            req = urllib.request.Request(
                f"{base}/storage/v1/object/fireblade-recordings/{safe_storage_path}",
                data=content,
                method="POST",
                headers={
                    "apikey": key,
                    "Content-Type": mime_type or "audio/mp4",
                    **({"Authorization": f"Bearer {key}"} if key.startswith("eyJ") else {})
                }
            )
            
            storage_success = False
            last_error = None
            try:
                with urllib.request.urlopen(req, timeout=30):
                    storage_success = True
            except urllib.error.HTTPError as e:
                try:
                    resp_body = e.read().decode()
                    if e.code in (400, 409) and ("Duplicate" in resp_body or "AlreadyExists" in resp_body or "Already Exists" in resp_body):
                        storage_success = True
                    else:
                        last_error = f"HTTP {e.code}"
                except Exception:
                    last_error = f"HTTP {e.code}"
            except Exception as e:
                last_error = str(e)
                
            if storage_success:
                db("PATCH", f"fireblade_call_recordings?recording_id=eq.{quote(recording_id, safe='')}", {
                    "storage_bucket": "fireblade-recordings",
                    "storage_object_path": storage_path,
                    "file_size_bytes": len(content),
                    "recording_status": "UPLOADED",
                    "upload_status": "SUCCESS",
                    "uploaded_at": utcnow().isoformat(),
                    "last_error": None
                })
            else:
                db("PATCH", f"fireblade_call_recordings?recording_id=eq.{quote(recording_id, safe='')}", {
                    "upload_status": "FAILED",
                    "last_error": last_error
                })
                raise HTTPException(502, f"Failed to store audio file: {last_error}")
        else:
            db("PATCH", f"fireblade_call_recordings?recording_id=eq.{quote(recording_id, safe='')}", {
                "upload_status": "SUCCESS",
                "uploaded_at": utcnow().isoformat(),
                "last_error": None
            })

        return {"ok": True, "recording_id": recording_id}
