import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest, supabaseRestWithCount } from "@/lib/supabase";
import type { DeviceAssignment, FirebladeDevice, FirebladeDeviceLine, FirebladeEmployee, IncomingCall } from "@/lib/types";
import { FIREBLADE_VISIBLE_FROM_EPOCH_MS } from "@/lib/call-window";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 50), 1), 100);
  const offset = (page - 1) * pageSize;

  const today = url.searchParams.get("today") === "true";
  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const since = today ? Date.parse(`${istDate}T00:00:00+05:30`) : FIREBLADE_VISIBLE_FROM_EPOCH_MS;

  // Strict role-based isolation: Marketing employees only see their assigned calls
  const isMarketing = session.role === "MARKETING";
  const marketingEmployeeId = isMarketing ? session.employee_id : null;
  const requestedEmployeeId = url.searchParams.get("employeeId")?.trim();
  const effectiveEmployeeId = isMarketing ? marketingEmployeeId : (requestedEmployeeId && requestedEmployeeId !== "ALL" ? requestedEmployeeId : null);

  const lineFilter = url.searchParams.get("lineFilter")?.trim();
  const statusFilter = url.searchParams.get("status")?.trim();
  const callTypeFilter = url.searchParams.get("callType")?.trim();
  const rawSearch = url.searchParams.get("search")?.trim() || "";
  const skipRegistry = url.searchParams.get("skipRegistry") === "true";

  // Build PostgREST query parameters
  const queryParts: string[] = [
    `select=*`,
    `started_at_epoch_ms=gte.${since}`,
  ];

  if (effectiveEmployeeId) {
    queryParts.push(`registered_employee_id=eq.${encodeURIComponent(effectiveEmployeeId)}`);
  }

  if (lineFilter && lineFilter !== "ALL") {
    if (lineFilter.startsWith("LINE:")) {
      queryParts.push(`resolved_line_id=eq.${encodeURIComponent(lineFilter.slice(5))}`);
    } else if (lineFilter.startsWith("DEVICE:")) {
      queryParts.push(`device_id=eq.${encodeURIComponent(lineFilter.slice(7))}`);
    }
  }

  if (callTypeFilter && callTypeFilter !== "ALL") {
    queryParts.push(`direction=eq.${encodeURIComponent(callTypeFilter)}`);
  }

  if (statusFilter === "PENDING") {
    queryParts.push(`or=(enquiry_id.is.null,resolution_outcome.eq.RECOVERED)`);
    queryParts.push(`or=(resolution_outcome.is.null,resolution_outcome.neq.DISQUALIFIED)`);
  } else if (statusFilter === "COMPLETED") {
    queryParts.push(`or=(and(enquiry_id.not.is.null,resolution_outcome.neq.RECOVERED),resolution_outcome.eq.DISQUALIFIED)`);
  }

  if (rawSearch) {
    // Sanitize search string for PostgREST ilike pattern
    const sanitized = rawSearch.replace(/[^\w\s+@.-]/gi, " ").trim();
    if (sanitized) {
      const pattern = `*${sanitized}*`;
      queryParts.push(
        `or=(phone_number_raw.ilike.${pattern},phone_number_normalized.ilike.${pattern},person_name.ilike.${pattern},company_name.ilike.${pattern},product_name.ilike.${pattern},requirement_details.ilike.${pattern},received_by.ilike.${pattern},device_id.ilike.${pattern})`
      );
    }
  }

  queryParts.push(`order=started_at_epoch_ms.desc,call_id.desc`);
  queryParts.push(`limit=${pageSize}`);
  queryParts.push(`offset=${offset}`);

  const queryString = queryParts.join("&");

  try {
    const callPromise = supabaseRestWithCount<IncomingCall[]>(`fireblade_incoming_calls?${queryString}`);

    let registryPromise: Promise<{
      employees: FirebladeEmployee[];
      devices: FirebladeDevice[];
      assignments: DeviceAssignment[];
      lines: FirebladeDeviceLine[];
    }>;

    if (skipRegistry) {
      registryPromise = Promise.resolve({ employees: [], devices: [], assignments: [], lines: [] });
    } else {
      const empId = isMarketing ? session.employee_id : null;
      const employeeQuery = empId
        ? `fireblade_employees?select=*&employee_id=eq.${encodeURIComponent(empId)}&active=eq.true`
        : "fireblade_employees?select=*&active=eq.true&order=employee_name.asc";
      const assignmentQuery = empId
        ? `fireblade_device_assignments?select=*&employee_id=eq.${encodeURIComponent(empId)}&assigned_until=is.null&order=assigned_from.desc`
        : "fireblade_device_assignments?select=*&assigned_until=is.null&order=assigned_from.desc";

      registryPromise = (async () => {
        const [employees, assignments] = await Promise.all([
          supabaseRest<FirebladeEmployee[]>(employeeQuery),
          supabaseRest<DeviceAssignment[]>(assignmentQuery),
        ]);
        const deviceIds = [...new Set(assignments.map((a) => a.device_id))];
        let devices: FirebladeDevice[] = [];
        let lines: FirebladeDeviceLine[] = [];

        if (isMarketing) {
          if (deviceIds.length) {
            const quoted = deviceIds.map(encodeURIComponent).join(",");
            [devices, lines] = await Promise.all([
              supabaseRest<FirebladeDevice[]>(`fireblade_devices?select=*&device_id=in.(${quoted})&active=eq.true&order=device_id.asc`),
              supabaseRest<FirebladeDeviceLine[]>(`fireblade_device_lines?select=*&device_id=in.(${quoted})&active=eq.true&order=device_id.asc,sim_slot_index.asc`),
            ]);
          }
        } else {
          [devices, lines] = await Promise.all([
            supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&active=eq.true&order=device_id.asc"),
            supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true&order=device_id.asc,sim_slot_index.asc"),
          ]);
        }
        return { employees, devices, assignments, lines };
      })();
    }

    const [callResult, registry] = await Promise.all([callPromise, registryPromise]);
    const calls = callResult.data || [];
    const totalCount = callResult.count ?? calls.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return NextResponse.json({
      calls,
      totalCount,
      page,
      pageSize,
      totalPages,
      user: session,
      registry: skipRegistry ? undefined : registry,
    });
  } catch (error) {
    console.error("[Fireblade Gen2 /api/calls]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load calls" },
      { status: 500 }
    );
  }
}
