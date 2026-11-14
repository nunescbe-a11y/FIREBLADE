import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { Contact } from "@/lib/types";

type InformationTypeRow = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  require_remark_when_no: boolean;
};

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
  const notes = String(body.notes || "").trim();
  const requestedContactId = String(body.contactId || "").trim();
  const commonRemarks = String(body.commonRemarks || "").trim();
  const informationSent = Array.isArray(body.informationSent) ? body.informationSent as InformationAnswerBody[] : [];

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

    const informationTypes = await supabaseRest<InformationTypeRow[]>(
      "fireblade_information_types?select=id,code,label,active,require_remark_when_no&active=eq.true&order=sort_order.asc,label.asc",
    );

    const submittedById = new Map<string, { sent: boolean; remarks: string }>();
    for (const raw of informationSent) {
      const id = String(raw.informationTypeId || "").trim();
      if (!id || typeof raw.sent !== "boolean") continue;
      submittedById.set(id, {
        sent: raw.sent,
        remarks: String(raw.remarks || "").trim(),
      });
    }

    const commonRemarkCodes = new Set(["QUOTATION", "CATALOGUE", "IMAGE"]);
    let commonRemarkRequired = false;
    for (const type of informationTypes) {
      const answer = submittedById.get(type.id);
      if (!answer) {
        return NextResponse.json({ error: `${type.label}: select Yes or No` }, { status: 400 });
      }
      if (!answer.sent && commonRemarkCodes.has(type.code)) commonRemarkRequired = true;
      if (!answer.sent && !commonRemarkCodes.has(type.code) && type.require_remark_when_no && !answer.remarks) {
        return NextResponse.json({ error: `${type.label}: remarks are required when No is selected` }, { status: 400 });
      }
    }
    if (commonRemarkRequired && !commonRemarks) {
      return NextResponse.json({ error: "Common Remarks are required when Quotation, Catalogue or Image is marked No" }, { status: 400 });
    }

    let contactId = requestedContactId;
    if (contactId) {
      await supabaseRest(`fireblade_contacts?id=eq.${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          person_name: personName,
          company_name: companyName || null,
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
          created_by: session.username,
          updated_at: new Date().toISOString(),
        }),
      });
      contactId = created[0]?.id || "";
    }

    if (!contactId) throw new Error("Could not create contact");

    const enquiryRows = await supabaseRest<Array<{ id: string }>>("fireblade_call_enquiries?on_conflict=call_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        call_id: callId,
        contact_id: contactId,
        product_name: productName,
        requirement_details: requirementDetails || null,
        notes: notes || null,
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

    if (informationTypes.length) {
      const now = new Date().toISOString();
      const responseRows = informationTypes.map((type) => {
        const answer = submittedById.get(type.id)!;
        const remarks = commonRemarkCodes.has(type.code) ? commonRemarks : answer.remarks;
        return {
          enquiry_id: enquiryId,
          information_type_id: type.id,
          sent: answer.sent,
          remarks: remarks || null,
          answered_by: session.username,
          updated_at: now,
        };
      });

      await supabaseRest("fireblade_enquiry_information_sent?on_conflict=enquiry_id,information_type_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(responseRows),
      });
    }

    return NextResponse.json({ ok: true, contactId, enquiryId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save enquiry" }, { status: 500 });
  }
}