import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest, supabaseStorageSignedUrl } from "@/lib/supabase";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const callId = url.searchParams.get("call_id");
  const phone = url.searchParams.get("phone");

  try {
    if (path) {
      const signedUrl = await supabaseStorageSignedUrl("fireblade-recordings", path, 3600);
      return NextResponse.json({ ok: true, signedUrl, storage_path: path });
    }

    let query = "fireblade_call_recordings?select=*&order=created_at.desc";
    if (callId) {
      query += `&call_id=eq.${encodeURIComponent(callId)}`;
    } else if (phone) {
      const cleanPhone = phone.replace(/^\+91/, "").replace(/\D/g, "");
      query += `&phone_number=like.*${encodeURIComponent(cleanPhone)}*`;
    } else {
      query += "&limit=25";
    }

    const recordings = await supabaseRest<any[]>(query);
    return NextResponse.json({ ok: true, recordings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load recording";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
