import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { DeviceAssignment, FirebladeDevice, FirebladeDeviceLine, FirebladeEmployee, IncomingCall } from "@/lib/types";
import { FIREBLADE_VISIBLE_FROM_EPOCH_MS } from "@/lib/call-window";

// In-memory registry cache to keep application fast and smooth (<100ms response)
let cachedRegistry: {
  timestamp: number;
  employees: FirebladeEmployee[];
  devices: FirebladeDevice[];
  assignments: DeviceAssignment[];
  lines: FirebladeDeviceLine[];
} | null = null;

const REGISTRY_CACHE_TTL_MS = 15_000;

async function getCachedRegistry() {
  const now = Date.now();
  if (cachedRegistry && now - cachedRegistry.timestamp < REGISTRY_CACHE_TTL_MS) {
    return cachedRegistry;
  }
  const [employees, devices, assignments, lines] = await Promise.all([
    supabaseRest<FirebladeEmployee[]>("fireblade_employees?select=*&active=eq.true&order=employee_name.asc"),
    supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&active=eq.true&order=device_id.asc"),
    supabaseRest<DeviceAssignment[]>("fireblade_device_assignments?select=*&assigned_until=is.null&order=assigned_from.desc"),
    supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true&order=device_id.asc,sim_slot_index.asc"),
  ]);
  cachedRegistry = { timestamp: now, employees, devices, assignments, lines };
  return cachedRegistry;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 1000), 1), 5000);
  const today = url.searchParams.get("today") === "true";
  const allHistory = url.searchParams.get("all") === "true";
  const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  
  const since = today
    ? Date.parse(`${istDate}T00:00:00+05:30`)
    : allHistory
    ? 0
    : FIREBLADE_VISIBLE_FROM_EPOCH_MS;
    
  const employeeFilter = session.role === "MARKETING" && session.employee_id ? `&registered_employee_id=eq.${encodeURIComponent(session.employee_id)}` : "";

  async function readCalls() {
    if (limit <= 1000) {
      return await supabaseRest<IncomingCall[]>(
        `fireblade_incoming_calls?select=*&started_at_epoch_ms=gte.${since}${employeeFilter}&order=started_at_epoch_ms.desc,call_id.desc&limit=${limit}`
      );
    }
    const offsets: number[] = [];
    for (let offset = 0; offset < limit; offset += 1000) {
      offsets.push(offset);
    }
    const pages = await Promise.all(
      offsets.map(offset => {
        const pageSize = Math.min(1000, limit - offset);
        return supabaseRest<IncomingCall[]>(
          `fireblade_incoming_calls?select=*&started_at_epoch_ms=gte.${since}${employeeFilter}&order=started_at_epoch_ms.desc,call_id.desc&limit=${pageSize}&offset=${offset}`
        );
      })
    );
    return pages.flat();
  }

  try {
    const isMarketing = session.role === "MARKETING" && session.employee_id;
    
    if (isMarketing) {
      const employeeId = session.employee_id!;
      const [calls, employees, assignments] = await Promise.all([
        readCalls(),
        supabaseRest<FirebladeEmployee[]>(`fireblade_employees?select=*&employee_id=eq.${encodeURIComponent(employeeId)}&active=eq.true`),
        supabaseRest<DeviceAssignment[]>(`fireblade_device_assignments?select=*&employee_id=eq.${encodeURIComponent(employeeId)}&assigned_until=is.null&order=assigned_from.desc`),
      ]);
      const deviceIds = [...new Set(assignments.map(a => a.device_id))];
      let devices: FirebladeDevice[] = [];
      let lines: FirebladeDeviceLine[] = [];
      if (deviceIds.length) {
        const quoted = deviceIds.map(encodeURIComponent).join(",");
        [devices, lines] = await Promise.all([
          supabaseRest<FirebladeDevice[]>(`fireblade_devices?select=*&device_id=in.(${quoted})&active=eq.true&order=device_id.asc`),
          supabaseRest<FirebladeDeviceLine[]>(`fireblade_device_lines?select=*&device_id=in.(${quoted})&active=eq.true&order=device_id.asc,sim_slot_index.asc`),
        ]);
      }
      return NextResponse.json({ calls, user: session, registry: { employees, devices, assignments, lines } });
    }

    // For Admin and Management: use fast concurrent cached registry
    const [calls, registry] = await Promise.all([
      readCalls(),
      getCachedRegistry()
    ]);

    return NextResponse.json({
      calls,
      user: session,
      registry: {
        employees: registry.employees,
        devices: registry.devices,
        assignments: registry.assignments,
        lines: registry.lines,
      }
    }, {
      headers: {
        "Cache-Control": "private, no-cache, no-transform",
      }
    });
  } catch (error) {
    console.error("[Fireblade Gen2 /api/calls]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load calls" }, { status: 500 });
  }
}
