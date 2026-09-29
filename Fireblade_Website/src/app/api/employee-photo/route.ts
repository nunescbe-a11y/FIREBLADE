import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { storageRequest } from "@/lib/storage";
import { supabaseRest, supabaseStorageCreateSignedUploadUrl, supabaseStorageObjectInfo, supabaseStorageSignedUrl } from "@/lib/supabase";

const BUCKET = "fireblade-employee-photos";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type EmployeePhotoRow = {
  employee_id: string;
  employee_name: string;
  profile_photo_path: string | null;
  profile_photo_updated_at: string | null;
};

function cleanFilename(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "profile-photo";
}
async function employeeRow(employeeId: string) {
  const rows = await supabaseRest<EmployeePhotoRow[]>(`fireblade_employees?select=employee_id,employee_name,profile_photo_path,profile_photo_updated_at&employee_id=eq.${encodeURIComponent(employeeId)}&active=eq.true&limit=1`);
  return rows[0] || null;
}
async function deleteObject(path: string | null) {
  if (!path) return;
  try {
    await storageRequest(`object/${BUCKET}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
  } catch (error) {
    console.warn("[Fireblade Gen2.1 employee photo cleanup]", error);
  }
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const employeeId = (url.searchParams.get("employee_id") || "").trim().toUpperCase();
  if (!employeeId) return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
  if (user.role === "MARKETING" && user.employee_id !== employeeId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const employee = await employeeRow(employeeId);
    if (!employee?.profile_photo_path) return NextResponse.json({ error: "No profile photo" }, { status: 404 });
    const signed = await supabaseStorageSignedUrl(BUCKET, employee.profile_photo_path, 600);
    const response = NextResponse.redirect(signed, 307);
    response.headers.set("Cache-Control", "private, max-age=300");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load employee photo" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const employeeId = String(body.employee_id || "").trim().toUpperCase();
  if (!employeeId) return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
  try {
    const employee = await employeeRow(employeeId);
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

    if (action === "sign_upload") {
      const filename = cleanFilename(String(body.filename || ""));
      const contentType = String(body.content_type || "").toLowerCase();
      const size = Number(body.size || 0);
      if (!ALLOWED_MIME.has(contentType)) return NextResponse.json({ error: "Only JPEG, PNG and WebP employee photos are allowed" }, { status: 400 });
      if (!Number.isFinite(size) || size < 1 || size > MAX_BYTES) return NextResponse.json({ error: "Employee photo must be between 1 byte and 5 MB" }, { status: 400 });
      const objectPath = `${employeeId}/${Date.now()}-${crypto.randomUUID()}-${filename}`;
      const signed = await supabaseStorageCreateSignedUploadUrl(BUCKET, objectPath);
      return NextResponse.json({ ok: true, upload_url: signed.signedUrl, object_path: objectPath, max_bytes: MAX_BYTES });
    }

    if (action === "finalize_upload") {
      const objectPath = String(body.object_path || "");
      if (!objectPath.startsWith(`${employeeId}/`)) return NextResponse.json({ error: "Invalid employee photo path" }, { status: 400 });
      await supabaseStorageObjectInfo(BUCKET, objectPath);
      const oldPath = employee.profile_photo_path;
      const updatedAt = new Date().toISOString();
      await supabaseRest(`fireblade_employees?employee_id=eq.${encodeURIComponent(employeeId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ profile_photo_path: objectPath, profile_photo_updated_at: updatedAt, updated_at: updatedAt }),
      });
      if (oldPath && oldPath !== objectPath) await deleteObject(oldPath);
      return NextResponse.json({ ok: true, profile_photo_updated_at: updatedAt });
    }

    if (action === "remove") {
      const oldPath = employee.profile_photo_path;
      const updatedAt = new Date().toISOString();
      await supabaseRest(`fireblade_employees?employee_id=eq.${encodeURIComponent(employeeId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ profile_photo_path: null, profile_photo_updated_at: updatedAt, updated_at: updatedAt }),
      });
      await deleteObject(oldPath);
      return NextResponse.json({ ok: true, profile_photo_updated_at: updatedAt });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Employee photo operation failed" }, { status: 500 });
  }
}
