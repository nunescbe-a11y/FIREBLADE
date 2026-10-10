import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { Contact } from "@/lib/types";

type InformationAnswerBody = {
  informationTypeId?: unknown;
  sent?: unknown;
  remarks?: unknown;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "MANAGEMENT") return NextResponse.json({ error: "Management access is read-only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const callId = Number(body.callId);
  const personName = String(body.personName || "").trim();
  const companyName = String(body.companyName || "").trim();
  const productName = String(body.productName || "").trim();
  const requirementDetails = String(body.requirementDetails || "").trim();
  const location = String(body.location || "").trim();
  const notes = String(body.notes || "").trim();
  const requestedContactId = String(body.contactId || "").trim();
  const commonRemarks = String(body.commonRemarks || "").trim();
  const informationSent = Array.isArray(body.informationSent) ? (body.informationSent as InformationAnswerBody[]) : [];

  if (!Number.isInteger(callId) || callId <= 0) return NextResponse.json({ error: "Invalid call" }, { status: 400 });
  if (!personName) return NextResponse.json({ error: "Person name is required" }, { status: 400 });
  if (!productName) return NextResponse.json({ error: "Product / requirement is required" }, { status: 400 });

  try {
    const calls = session.role === "MARKETING"
      ? await supabaseRest<Array<{ call_id: number; phone_number_normalized: string | null }>>(
          `fireblade_incoming_calls?select=call_id,phone_number_normalized&call_id=eq.${callId}&registered_employee_id=eq.${encodeURIComponent(session.employee_id || "")}&limit=1`,
        )
      : await supabaseRest<Array<{ id: number; phone_number_normalized: string | null }>>(
          `phase0_calls?select=id,phone_number_normalized&id=eq.${callId}&limit=1`,
        );

    const call = calls[0];
    if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    const phone = call.phone_number_normalized || "";

    const existing = await supabaseRest<Array<{ entered_by: string | null; resolution_outcome: string | null }>>(
      `fireblade_call_enquiries?select=entered_by,resolution_outcome&call_id=eq.${callId}&limit=1`,
    );
    if (existing[0]?.resolution_outcome === "DISQUALIFIED") {
      return NextResponse.json({ error: "This call has already been marked Disqualified" }, { status: 409 });
    }

    let contactId = requestedContactId;
    if (contactId) {
      await supabaseRest(`fireblade_contacts?id=eq.${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          person_name: personName,
          company_name: companyName || null,
          location: location || "",
          updated_at: new Date().toISOString(),
        }),
      });
    } else {
      const created = await supabaseRest<Contact[]>("fireblade_contacts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          phone_number_normalized: phone,
          person_name: personName,
          company_name: companyName || null,
          location: location || "",
          created_by: session.username,
          updated_at: new Date().toISOString(),
        }),
      });
      contactId = created[0]?.id || "";
    }

    if (!contactId) throw new Error("Could not create contact");

    const combinedNotes = [notes, commonRemarks ? `Remarks: ${commonRemarks}` : ""].filter(Boolean).join("\n");

    const enquiryRows = await supabaseRest<Array<{ id: string }>>("fireblade_call_enquiries?on_conflict=call_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        call_id: callId,
        contact_id: contactId,
        product_name: productName,
        location: location || "",
        requirement_details: requirementDetails || null,
        notes: combinedNotes || null,
        status: "COMPLETED",
        entered_by: existing[0]?.entered_by || session.username,
        updated_by: session.username,
        resolution_outcome: "DETAILS_ENTERED",
        resolution_at: new Date().toISOString(),
        resolution_by: session.username,
        updated_at: new Date().toISOString(),
      }),
    });

    const enquiryId = enquiryRows[0]?.id;
    if (!enquiryId) throw new Error("Could not resolve saved enquiry");

    // If historical or backward-compatible checklist items are sent, optionally record them
    if (informationSent.length > 0) {
      const now = new Date().toISOString();
      const responseRows = informationSent
        .filter((raw) => raw.informationTypeId && typeof raw.sent === "boolean")
        .map((raw) => ({
          enquiry_id: enquiryId,
          information_type_id: String(raw.informationTypeId),
          sent: raw.sent as boolean,
          remarks: raw.remarks ? String(raw.remarks).trim() : null,
          answered_by: session.username,
          updated_at: now,
        }));

      if (responseRows.length > 0) {
        await supabaseRest("fireblade_enquiry_information_sent?on_conflict=enquiry_id,information_type_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(responseRows),
        }).catch(() => undefined);
      }
    }

    return NextResponse.json({ ok: true, contactId, enquiryId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save enquiry" }, { status: 500 });
  }
}