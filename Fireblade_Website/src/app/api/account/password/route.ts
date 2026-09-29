import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";
import { supabaseAuthAdmin, supabaseRest } from "@/lib/supabase";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user || !user.auth_user_id) return NextResponse.json({ error: "This account does not use managed employee authentication" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const nextSessionVersion = Number(user.session_version || 1) + 1;
  await supabaseAuthAdmin(`users/${user.auth_user_id}`, { method: "PUT", body: JSON.stringify({ password }) });
  await supabaseRest(`fireblade_user_profiles?auth_user_id=eq.${user.auth_user_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ force_password_change: false, session_version: nextSessionVersion, updated_at: new Date().toISOString() }) });
  await setSession({ ...user, force_password_change: false, session_version: nextSessionVersion });
  return NextResponse.json({ ok: true });
}
