import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

function validBrowserOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host") || new URL(request.url).host;
    return ["http:", "https:"].includes(originUrl.protocol) && originUrl.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "MARKETING" || !session.employee_id) {
    return NextResponse.json({ error: "Marketing employee access required" }, { status: 403 });
  }
  if (!validBrowserOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const callId = Number(body.callId);
  if (!Number.isInteger(callId) || callId <= 0) {
    return NextResponse.json({ error: "Invalid call" }, { status: 400 });
  }

  try {
    const enquiryId = await supabaseRest<string>("rpc/fireblade_mark_call_disqualified", {
      method: "POST",
      body: JSON.stringify({
        p_call_id: callId,
        p_employee_id: session.employee_id,
        p_actor: session.username,
      }),
    });

    return NextResponse.json({ ok: true, enquiryId, outcome: "DISQUALIFIED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark call as disqualified";
    if (/already has enquiry details/i.test(message)) {
      return NextResponse.json({ error: "This call already has saved enquiry details" }, { status: 409 });
    }
    if (/not assigned to this employee|active employee not found|limited to marketing/i.test(message)) {
      return NextResponse.json({ error: "This call cannot be disqualified by the current employee" }, { status: 403 });
    }
    console.error("[Fireblade Gen2 /api/enquiries/disqualify]", message);
    return NextResponse.json({ error: "Could not mark call as disqualified" }, { status: 500 });
  }
}
