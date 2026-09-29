import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

type InformationTypeRow = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
  require_remark_when_no: boolean;
};

type ResponseRow = {
  information_type_id: string;
  sent: boolean;
  remarks: string | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const enquiryId = String(url.searchParams.get("enquiryId") || "").trim();

  try {
    if (enquiryId && session.role === "MARKETING") {
      const owned = await supabaseRest<Array<{ enquiry_id: string }>>(
        `fireblade_incoming_calls?select=enquiry_id&enquiry_id=eq.${encodeURIComponent(enquiryId)}&registered_employee_id=eq.${encodeURIComponent(session.employee_id || "")}&limit=1`,
      );
      if (!owned[0]) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
    }

    const [types, responses] = await Promise.all([
      supabaseRest<InformationTypeRow[]>(
        "fireblade_information_types?select=id,code,label,sort_order,active,require_remark_when_no&active=eq.true&order=sort_order.asc,label.asc",
      ),
      enquiryId
        ? supabaseRest<ResponseRow[]>(
            `fireblade_enquiry_information_sent?select=information_type_id,sent,remarks&enquiry_id=eq.${encodeURIComponent(enquiryId)}`,
          )
        : Promise.resolve([] as ResponseRow[]),
    ]);

    return NextResponse.json({ types, responses });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load information types" }, { status: 500 });
  }
}