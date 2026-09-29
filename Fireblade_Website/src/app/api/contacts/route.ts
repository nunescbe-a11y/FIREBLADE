import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { Contact } from "@/lib/types";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone")?.trim();
  if (!phone) return NextResponse.json({ contacts: [] });
  try {
    const encoded = encodeURIComponent(phone);
    if (session.role === "MARKETING") {
      const owned = await supabaseRest<Array<{call_id:number}>>(`fireblade_incoming_calls?select=call_id&registered_employee_id=eq.${encodeURIComponent(session.employee_id || "")}&phone_number_normalized=eq.${encoded}&limit=1`);
      if (!owned.length) return NextResponse.json({ contacts: [] });
    }
    const contacts = await supabaseRest<Contact[]>(`fireblade_contacts?select=*&phone_number_normalized=eq.${encoded}&order=updated_at.desc`);
    return NextResponse.json({ contacts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load contacts" }, { status: 500 });
  }
}
