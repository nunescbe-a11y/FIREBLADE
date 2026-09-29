import { NextResponse } from "next/server";
import { getSession, principalFor, updateSessionTheme } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { FirebladeTheme } from "@/lib/types";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const theme = String(body.theme || "").toUpperCase() as FirebladeTheme;
  if (!["STANDARD", "NIGHTMARE", "SYSTEM"].includes(theme)) return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
  const principal = principalFor(user);
  await supabaseRest("fireblade_user_preferences?on_conflict=principal", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ principal, theme, updated_at: new Date().toISOString() }),
  });
  await updateSessionTheme(theme);
  return NextResponse.json({ ok: true, theme });
}
