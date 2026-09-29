import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSession, principalFor } from "@/lib/auth";
import { storageRequest } from "@/lib/storage";
import {
  supabaseRest,
  supabaseStorageCreateSignedUploadUrl,
  supabaseStorageObjectInfo,
  supabaseStorageSignedUrl,
} from "@/lib/supabase";

const BUCKET = "fireblade-employee-photos";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type ManagementProfile = {
  principal: string;
  display_name: string;
  profile_photo_path: string | null;
  profile_photo_updated_at: string | null;
  updated_at: string;
};

function cleanFilename(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "md-profile";
}

function folderFor(principal: string) {
  return `management/${crypto.createHash("sha256").update(principal).digest("hex").slice(0, 24)}`;
}

async function profileRow(principal: string) {
  const rows = await supabaseRest<ManagementProfile[]>(
    `fireblade_management_profiles?select=*&principal=eq.${encodeURIComponent(principal)}&limit=1`,
  );
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
    console.warn("[Fireblade management photo cleanup]", error);
  }
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "MANAGEMENT") return NextResponse.json({ error: "Management access required" }, { status: 403 });

  try {
    const principal = principalFor(user);
    const profile = await profileRow(principal);
    const url = new URL(request.url);

    if (url.searchParams.get("photo") === "1") {
      if (!profile?.profile_photo_path) return NextResponse.json({ error: "No Management profile photo" }, { status: 404 });
      const signed = await supabaseStorageSignedUrl(BUCKET, profile.profile_photo_path, 600);
      const response = NextResponse.redirect(signed, 307);
      response.headers.set("Cache-Control", "private, max-age=300");
      return response;
    }

    return NextResponse.json({
      display_name: profile?.display_name || user.employee_name || "MD",
      has_photo: Boolean(profile?.profile_photo_path),
      profile_photo_updated_at: profile?.profile_photo_updated_at || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Management profile" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "MANAGEMENT") return NextResponse.json({ error: "Management access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    const principal = principalFor(user);
    const profile = await profileRow(principal);
    const folder = folderFor(principal);

    if (action === "sign_upload") {
      const filename = cleanFilename(String(body.filename || ""));
      const contentType = String(body.content_type || "").toLowerCase();
      const size = Number(body.size || 0);
      if (!ALLOWED_MIME.has(contentType)) return NextResponse.json({ error: "Only JPEG, PNG and WebP Management photos are allowed" }, { status: 400 });
      if (!Number.isFinite(size) || size < 1 || size > MAX_BYTES) return NextResponse.json({ error: "Management photo must be between 1 byte and 5 MB" }, { status: 400 });

      const objectPath = `${folder}/${Date.now()}-${crypto.randomUUID()}-${filename}`;
      const signed = await supabaseStorageCreateSignedUploadUrl(BUCKET, objectPath);
      return NextResponse.json({ ok: true, upload_url: signed.signedUrl, object_path: objectPath, max_bytes: MAX_BYTES });
    }

    if (action === "finalize_upload") {
      const objectPath = String(body.object_path || "");
      if (!objectPath.startsWith(`${folder}/`)) return NextResponse.json({ error: "Invalid Management photo path" }, { status: 400 });
      await supabaseStorageObjectInfo(BUCKET, objectPath);

      const updatedAt = new Date().toISOString();
      const displayName = profile?.display_name || user.employee_name || "MD";
      await supabaseRest("fireblade_management_profiles?on_conflict=principal", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          principal,
          display_name: displayName,
          profile_photo_path: objectPath,
          profile_photo_updated_at: updatedAt,
          updated_by: user.username,
          updated_at: updatedAt,
        }),
      });

      if (profile?.profile_photo_path && profile.profile_photo_path !== objectPath) {
        await deleteObject(profile.profile_photo_path);
      }

      return NextResponse.json({ ok: true, profile_photo_updated_at: updatedAt });
    }

    if (action === "remove") {
      const updatedAt = new Date().toISOString();
      await supabaseRest("fireblade_management_profiles?on_conflict=principal", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          principal,
          display_name: profile?.display_name || user.employee_name || "MD",
          profile_photo_path: null,
          profile_photo_updated_at: updatedAt,
          updated_by: user.username,
          updated_at: updatedAt,
        }),
      });
      await deleteObject(profile?.profile_photo_path || null);
      return NextResponse.json({ ok: true, profile_photo_updated_at: updatedAt });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Management profile operation failed" }, { status: 500 });
  }
}