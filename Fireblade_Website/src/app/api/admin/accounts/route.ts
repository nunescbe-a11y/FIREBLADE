import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseAuthAdmin, supabaseRest } from "@/lib/supabase";
import crypto from "node:crypto";

type Profile = { auth_user_id:string; username:string; login_email:string; role:string; employee_id:string|null; active:boolean; force_password_change:boolean; session_version:number; created_at:string; updated_at:string };
type Employee = { employee_id:string; employee_name:string; active:boolean; department_id:string|null; profile_photo_updated_at:string|null };

function loginEmail(employeeId: string) {
  const local = employeeId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return `${local || crypto.randomUUID()}@auth.fireblade.local`;
}

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [employees, profiles] = await Promise.all([
    supabaseRest<Employee[]>("fireblade_employees?select=employee_id,employee_name,active,department_id,profile_photo_updated_at&order=employee_name.asc"),
    supabaseRest<Profile[]>("fireblade_user_profiles?select=*&role=eq.MARKETING&order=username.asc"),
  ]);
  return NextResponse.json({ employees, profiles });
}

export async function POST(request: Request) {
  const admin = await getSession();
  if (!admin || admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const employeeId = String(body.employee_id || "").trim().toUpperCase();
  if (!employeeId) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });

  const employees = await supabaseRest<Employee[]>(`fireblade_employees?select=employee_id,employee_name,active,department_id,profile_photo_updated_at&employee_id=eq.${encodeURIComponent(employeeId)}&limit=1`);
  if (!employees[0]) return NextResponse.json({ error: "Employee does not exist in Fireblade" }, { status: 404 });

  const existing = await supabaseRest<Profile[]>(`fireblade_user_profiles?select=*&employee_id=eq.${encodeURIComponent(employeeId)}&limit=1`);
  const profile = existing[0];

  if (action === "create") {
    if (profile) return NextResponse.json({ error: "Account already exists" }, { status: 409 });
    const password = String(body.password || "");
    if (password.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });
    const email = loginEmail(employeeId);
    const created = await supabaseAuthAdmin("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { fireblade_role: "MARKETING", employee_id: employeeId } }) });
    const authUserId = created?.user?.id || created?.id;
    if (!authUserId) throw new Error("Supabase Auth did not return a user ID");
    await supabaseRest("fireblade_user_profiles", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ auth_user_id: authUserId, username: employeeId, login_email: email, role: "MARKETING", employee_id: employeeId, active: true, force_password_change: true, created_by: admin.username }) });
    return NextResponse.json({ ok: true });
  }

  if (!profile) return NextResponse.json({ error: "Account does not exist" }, { status: 404 });

  if (action === "reset_password") {
    const password = String(body.password || "");
    if (password.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });
    await supabaseAuthAdmin(`users/${profile.auth_user_id}`, { method: "PUT", body: JSON.stringify({ password }) });
    await supabaseRest(`fireblade_user_profiles?auth_user_id=eq.${profile.auth_user_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ force_password_change: true, session_version: Number(profile.session_version || 1) + 1, updated_at: new Date().toISOString() }) });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_active") {
    const active = Boolean(body.active);
    await supabaseRest(`fireblade_user_profiles?auth_user_id=eq.${profile.auth_user_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active, session_version: Number(profile.session_version || 1) + 1, updated_at: new Date().toISOString() }) });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
