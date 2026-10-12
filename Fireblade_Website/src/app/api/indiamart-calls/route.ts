import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest, supabaseRestWithCount } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Site = "KRISHNA" | "SF" | "MOHAMMED" | "OTHER";
type SummaryRow = {
  site: Site;
  employee_id: string;
  employee_name: string;
  receiving_sim: string;
  total: number;
  answered: number;
  missed: number;
};
type CurrentHandler = { employeeName: string; employeeId: string; deviceId: string; simSlotIndex: number | null };
type CallRow = {
  call_id: number;
  site: Site;
  device_id: string;
  employee_id: string | null;
  employee_name: string | null;
  started_at_epoch_ms: number;
  direction: "INCOMING_ANSWERED" | "INCOMING_MISSED";
  duration_seconds: number;
  tracking_number: string;
  receiving_sim: string | null;
  sim_confidence: "CONFIRMED" | "INFERRED" | "UNKNOWN";
  line_resolution: string | null;
};

// ISO dates are interpreted as calendar days in IST, not the Vercel server timezone.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;
function dateIST(date: number): string {
  return new Date(date + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function parseDateIST(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00+05:30`);
  return Number.isFinite(parsed) && dateIST(parsed) === value ? parsed : null;
}
function positiveInt(raw: string | null, fallback: number, maximum: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, maximum) : fallback;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Admin or Management access required" }, { status: 403 });
  }
  if (session.force_password_change) return NextResponse.json({ error: "Change your password first" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const today = dateIST(Date.now());
  const todayStart = parseDateIST(today)!;
  const from = params.get("from") || dateIST(todayStart - 29 * DAY_MS);
  const to = params.get("to") || today;
  const since = parseDateIST(from);
  const toStart = parseDateIST(to);

  if (since === null || toStart === null || toStart < since || (toStart - since) > 365 * DAY_MS || toStart > todayStart) {
    return NextResponse.json({ error: "Choose a valid IST date range of at most 366 days, ending today or earlier." }, { status: 400 });
  }

  const siteInput = (params.get("site") || "KRISHNA").toUpperCase();
  if (!["KRISHNA", "SF", "MOHAMMED", "OTHER"].includes(siteInput)) {
    return NextResponse.json({ error: "Invalid IndiaMART site" }, { status: 400 });
  }
  const site = siteInput as Site;
  const status = params.get("status") || "ALL";
  if (!["ALL", "ANSWERED", "MISSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid call status" }, { status: 400 });
  }
  const sim = params.get("sim") || "";
  if (sim && !/^\d{10}$/.test(sim)) {
    return NextResponse.json({ error: "Invalid receiving SIM number" }, { status: 400 });
  }
  const page = positiveInt(params.get("page"), 1, 1_000_000);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const until = toStart + DAY_MS;

  const filters = [
    "select=call_id,site,device_id,employee_id,employee_name,started_at_epoch_ms,direction,duration_seconds,tracking_number,receiving_sim,sim_confidence,line_resolution",
    `site=eq.${site}`,
    `started_at_epoch_ms=gte.${since}`,
    `started_at_epoch_ms=lt.${until}`,
  ];
  if (sim) filters.push(`receiving_sim=eq.${sim}`);
  if (status !== "ALL") filters.push(`direction=eq.INCOMING_${status}`);
  filters.push("order=started_at_epoch_ms.desc,call_id.desc", `limit=${pageSize}`, `offset=${offset}`);

  try {
    const [summary, result] = await Promise.all([
      supabaseRest<SummaryRow[]>("rpc/fireblade_indiamart_call_summary", {
        method: "POST",
        body: JSON.stringify({ p_since_ms: since, p_until_ms: until }),
      }),
      supabaseRestWithCount<CallRow[]>(`fireblade_indiamart_call_records?${filters.join("&")}`),
    ]);
    // Read current device ownership rather than freezing handler names in the UI.
    // A registry outage must not hide otherwise valid call records.
    const currentHandlers: Record<string, CurrentHandler> = {};
    try {
      const [lines, assignments, employees] = await Promise.all([
        supabaseRest<Array<{ device_id: string; phone_number: string; sim_slot_index: number | null }>>(
          "fireblade_device_lines?select=device_id,phone_number,sim_slot_index&active=eq.true"
        ),
        supabaseRest<Array<{ device_id: string; employee_id: string }>>(
          "fireblade_device_assignments?select=device_id,employee_id&assigned_until=is.null"
        ),
        supabaseRest<Array<{ employee_id: string; employee_name: string }>>(
          "fireblade_employees?select=employee_id,employee_name&active=eq.true"
        ),
      ]);
      const known = new Set(["9159242000", "7305966225", "8940944000", "7550093383", "9345226022", "9087753000"]);
      for (const line of lines) {
        const number = (line.phone_number || "").replace(/\D/g, "").slice(-10);
        if (!known.has(number)) continue;
        const assignment = assignments.find((row) => row.device_id === line.device_id);
        const employee = employees.find((row) => row.employee_id === assignment?.employee_id);
        if (employee && assignment) {
          currentHandlers[number] = {
            employeeName: employee.employee_name,
            employeeId: employee.employee_id,
            deviceId: line.device_id,
            simSlotIndex: line.sim_slot_index,
          };
        }
      }
    } catch (registryError) {
      console.warn("[IndiaMART Calls] Current handler registry unavailable", registryError);
    }
    return NextResponse.json({
      site, from, to, page, pageSize, currentHandlers,
      totalCount: result.count ?? result.data.length,
      totalPages: Math.max(1, Math.ceil((result.count ?? result.data.length) / pageSize)),
      summary, calls: result.data,
      // A single IndiaMART ring can create multiple phone records. Never call these unique leads.
      countUnit: "device_call_records",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[IndiaMART Calls]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load IndiaMART calls" }, { status: 500 });
  }
}
