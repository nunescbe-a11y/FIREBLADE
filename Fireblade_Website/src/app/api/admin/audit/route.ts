import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/admin";
import { supabaseRest } from "@/lib/supabase";
export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const subject = url.searchParams.get("subject");
    const before = url.searchParams.get("before");
    const filter = subject ? `&subject=eq.${encodeURIComponent(subject)}` : "";
    const cursor = before && /^\d+$/.test(before) ? `&id=lt.${before}` : "";
    const [audit, checks] = await Promise.all([
      supabaseRest<Array<{id:number}>>(`fireblade_audit?select=*&order=id.desc&limit=100${filter}${cursor}`),
      subject ? supabaseRest(`fireblade_device_checks?select=*&device_id=eq.${encodeURIComponent(subject)}&order=requested_at.desc&limit=20`) : Promise.resolve([]),
    ]);
    return NextResponse.json({ audit, checks, next: audit.length === 100 ? audit.at(-1)?.id : null });
  } catch(e) { return apiError(e); }
}
