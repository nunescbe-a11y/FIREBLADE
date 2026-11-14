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
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function codeFromLabel(label: string) {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

async function loadTypes() {
  return supabaseRest<InformationTypeRow[]>(
    "fireblade_information_types?select=*&order=sort_order.asc,label.asc",
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });

  try {
    return NextResponse.json({ types: await loadTypes() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load information types" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").toUpperCase();
  const label = String(body.label || "").trim();
  const sortOrder = Number(body.sort_order ?? 0);
  const requireRemarkWhenNo = body.require_remark_when_no !== false;
  const active = body.active !== false;

  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    return NextResponse.json({ error: "Sort order must be a whole number between 0 and 100000" }, { status: 400 });
  }

  try {
    if (action === "CREATE") {
      const code = codeFromLabel(label);
      if (!code) return NextResponse.json({ error: "Could not create a valid information type code" }, { status: 400 });

      await supabaseRest("fireblade_information_types", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          code,
          label,
          sort_order: sortOrder,
          active,
          require_remark_when_no: requireRemarkWhenNo,
          created_by: session.username,
          updated_at: new Date().toISOString(),
        }),
      });
    } else if (action === "UPDATE") {
      const id = String(body.id || "").trim();
      if (!id) return NextResponse.json({ error: "Information type id is required" }, { status: 400 });

      await supabaseRest(`fireblade_information_types?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          label,
          sort_order: sortOrder,
          active,
          require_remark_when_no: requireRemarkWhenNo,
          updated_at: new Date().toISOString(),
        }),
      });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, types: await loadTypes() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save information type";
    if (message.includes("code_key")) {
      return NextResponse.json({ error: "An information type with this name/code already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}