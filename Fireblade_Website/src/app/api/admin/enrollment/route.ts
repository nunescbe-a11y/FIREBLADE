import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, requireUser, AccessError, audit } from "@/lib/admin";
import { supabaseRest } from "@/lib/supabase";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const b = await request.json();
    if (typeof b.device_id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(b.device_id)) throw new AccessError(400, "Invalid device ID");
    const devices = await supabaseRest<Array<{device_id:string}>>(`fireblade_devices?select=device_id&device_id=eq.${b.device_id}&active=eq.true`);
    if (!devices.length) throw new AccessError(404, "Register this device first");
    const code = randomBytes(24).toString("base64url");
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseRest("fireblade_enrollment_codes", { method: "POST", body: JSON.stringify({ device_id: b.device_id, code_hash: createHash("sha256").update(code).digest("hex"), expires_at, created_by: user.username }) });
    await audit(user.username, "ENROLLMENT_CODE_CREATED", b.device_id);
    return NextResponse.json({ code, expires_at }, { headers: { "Cache-Control": "no-store" } });
  } catch(e) { return apiError(e); }
}
