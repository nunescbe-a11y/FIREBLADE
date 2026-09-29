import { NextResponse } from "next/server";
import { apiError, requireUser, AccessError, uuid } from "@/lib/admin";
import { supabaseRest } from "@/lib/supabase";
export async function GET() {
  try {
    await requireUser(undefined, true);
    const [departments, employees] = await Promise.all([
      supabaseRest("fireblade_departments?select=*&order=name.asc"),
      supabaseRest("fireblade_employees?select=*&active=eq.true&order=employee_name.asc"),
    ]);
    return NextResponse.json({ departments, employees });
  } catch(e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const b = await request.json();
    if (!["CREATE", "RENAME", "ASSIGN"].includes(b.action)) throw new AccessError(400, "Invalid action");
    if (b.id != null && !uuid(b.id)) throw new AccessError(400, "Invalid department");
    if (b.action === "RENAME" && !b.id) throw new AccessError(400, "Choose a department");
    if (b.action !== "ASSIGN" && (typeof b.name !== "string" || !b.name.trim() || b.name.length > 80)) throw new AccessError(400, "Enter a department name up to 80 characters");
    if (b.action === "ASSIGN" && (typeof b.employee_id !== "string" || !b.employee_id)) throw new AccessError(400, "Choose an employee");
    await supabaseRest("rpc/fireblade_department_change", { method: "POST", body: JSON.stringify({ p_id: b.id || null, p_name: b.name?.trim() || null, p_employee_id: b.employee_id || null, p_actor: user.username, p_action: b.action }) });
    return NextResponse.json({ ok: true });
  } catch(e) { return apiError(e); }
}
