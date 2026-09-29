import { NextResponse } from "next/server";
import { apiError, requireUser, AccessError } from "@/lib/admin";
import { supabaseRest } from "@/lib/supabase";
import { sendCheck } from "@/lib/push";
import type { CheckRecord } from "@/lib/device-status";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const user = await requireUser(request, true);
    const body = await request.json();
    const [all, assignments, employees, exclusions] = await Promise.all([
      supabaseRest<Array<{device_id:string}>>("fireblade_devices?select=device_id&active=eq.true&order=device_id.asc"),
      supabaseRest<Array<{device_id:string;employee_id:string}>>("fireblade_device_assignments?select=device_id,employee_id&assigned_until=is.null"),
      supabaseRest<Array<{employee_id:string}>>("fireblade_employees?select=employee_id&active=eq.true"),
      supabaseRest<Array<{device_id:string}>>("fireblade_dashboard_device_exclusions?select=device_id&active=eq.true"),
    ]);
    const assignedEmployeeByDevice = new Map(assignments.map(a => [a.device_id, a.employee_id]));
    const activeEmployeeIds = new Set(employees.map(e => e.employee_id));
    const excludedDeviceIds = new Set(exclusions.map(x => x.device_id));
    const operational = all.filter(d => {
      const employeeId = assignedEmployeeByDevice.get(d.device_id);
      return !!employeeId && activeEmployeeIds.has(employeeId) && !excludedDeviceIds.has(d.device_id);
    });
    const devices = body.all === true ? operational : operational.filter(d => d.device_id === body.device_id);
    if (!devices.length || devices.length > 100) throw new AccessError(400, "Choose 1–100 assigned active devices");
    const tokens = await supabaseRest<Array<{device_id:string;token:string}>>("fireblade_push_tokens?select=device_id,token");
    const results: Array<Record<string, unknown>> = [];
    // Requests are persisted before delivery. Phones can also pick them up on their next pulse.
    for (let i = 0; i < devices.length; i += 20) {
      const batch = await Promise.all(devices.slice(i, i + 20).map(async d => {
        try {
          const check = await supabaseRest<CheckRecord>("rpc/fireblade_request_check", { method: "POST", body: JSON.stringify({ p_device_id: d.device_id, p_actor: user.username }) });
          const delivery = await sendCheck(tokens.find(t => t.device_id === d.device_id)?.token, check.request_id);
          await supabaseRest(`fireblade_device_checks?request_id=eq.${check.request_id}`, { method: "PATCH", body: JSON.stringify({ delivery_status: delivery }) });
          return { ...check, delivery_status: delivery };
        } catch (e) { return { device_id: d.device_id, error: e instanceof Error ? e.message : "Check could not be queued" }; }
      }));
      results.push(...batch);
    }
    return NextResponse.json({ results }, { status: results.every(r => r.error) ? 409 : 200 });
  } catch (e) { return apiError(e); }
}
