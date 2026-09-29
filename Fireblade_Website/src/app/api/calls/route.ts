import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { DeviceAssignment, FirebladeDevice, FirebladeDeviceLine, FirebladeEmployee, IncomingCall } from "@/lib/types";
import { FIREBLADE_VISIBLE_FROM_EPOCH_MS } from "@/lib/call-window";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 1000), 1), 5000);
  const today = url.searchParams.get("today") === "true";
  const istDate = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const since = today ? Date.parse(`${istDate}T00:00:00+05:30`) : FIREBLADE_VISIBLE_FROM_EPOCH_MS;
  const employeeFilter = session.role === "MARKETING" && session.employee_id ? `&registered_employee_id=eq.${encodeURIComponent(session.employee_id)}` : "";

  async function readCalls() {
    const rows: IncomingCall[] = [];
    for (let offset=0; offset<limit; offset+=1000) {
      const pageSize=Math.min(1000,limit-offset);
      const page = await supabaseRest<IncomingCall[]>(`fireblade_incoming_calls?select=*&started_at_epoch_ms=gte.${since}${employeeFilter}&order=started_at_epoch_ms.desc,call_id.desc&limit=${pageSize}&offset=${offset}`);
      rows.push(...page); if(page.length<pageSize)break;
    }
    return rows;
  }
  try {
    const employeeId = session.role === "MARKETING" ? session.employee_id : null;
    const employeeQuery = employeeId ? `fireblade_employees?select=*&employee_id=eq.${encodeURIComponent(employeeId)}&active=eq.true` : "fireblade_employees?select=*&active=eq.true&order=employee_name.asc";
    const assignmentQuery = employeeId ? `fireblade_device_assignments?select=*&employee_id=eq.${encodeURIComponent(employeeId)}&assigned_until=is.null&order=assigned_from.desc` : "fireblade_device_assignments?select=*&assigned_until=is.null&order=assigned_from.desc";
    const [calls, employees, assignments] = await Promise.all([
      readCalls(),
      supabaseRest<FirebladeEmployee[]>(employeeQuery),
      supabaseRest<DeviceAssignment[]>(assignmentQuery),
    ]);
    const deviceIds=[...new Set(assignments.map(a=>a.device_id))];
    let devices:FirebladeDevice[]=[]; let lines:FirebladeDeviceLine[]=[];
    if (session.role === "MARKETING") {
      if(deviceIds.length){
        const quoted=deviceIds.map(encodeURIComponent).join(',');
        [devices,lines]=await Promise.all([
          supabaseRest<FirebladeDevice[]>(`fireblade_devices?select=*&device_id=in.(${quoted})&active=eq.true&order=device_id.asc`),
          supabaseRest<FirebladeDeviceLine[]>(`fireblade_device_lines?select=*&device_id=in.(${quoted})&active=eq.true&order=device_id.asc,sim_slot_index.asc`),
        ]);
      }
    } else {
      [devices,lines]=await Promise.all([
        supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&active=eq.true&order=device_id.asc"),
        supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true&order=device_id.asc,sim_slot_index.asc"),
      ]);
    }
    return NextResponse.json({ calls, user: session, registry: { employees, devices, assignments, lines } });
  } catch (error) {
    console.error("[Fireblade Gen2 /api/calls]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load calls" }, { status: 500 });
  }
}
