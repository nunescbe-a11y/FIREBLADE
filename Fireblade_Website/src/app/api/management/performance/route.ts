import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dateEpoch(date: string) { return Date.parse(`${date}T00:00:00+05:30`); }

type SimPerformanceRow = {
  employee_id: string;
  employee_name: string;
  department_id: string | null;
  department_name: string;
  line_id: number;
  device_id: string;
  sim_slot_index: number | null;
  company_phone_number: string | null;
  line_label: string | null;
  carrier_name: string | null;
  total_incoming: number;
  answered_calls: number;
  missed_calls: number;
  called_back: number;
  pending_callbacks: number;
  callback_rate: number;
  average_callback_minutes: number | null;
};

type PerformanceRow = {
  employee_id: string;
  employee_name: string;
  department_id: string | null;
  department_name: string;
  profile_photo_updated_at: string | null;
  total_incoming: number;
  answered_calls: number;
  missed_calls: number;
  called_back: number;
  pending_callbacks: number;
  callback_rate: number;
  average_callback_minutes: number | null;
};

type DepartmentUniqueRow = {
  department_id: string | null;
  total_incoming: number;
};

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Management access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "Valid from/to dates are required" }, { status: 400 });
  }

  const start = dateEpoch(from);
  const end = dateEpoch(to) + 86_400_000;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 366 * 86_400_000) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const [rows, simRows, departmentRows] = await Promise.all([
      supabaseRest<PerformanceRow[]>("rpc/fireblade_employee_call_performance", {
        method: "POST",
        body: JSON.stringify({ p_start_epoch_ms: start, p_end_epoch_ms: end }),
      }),
      supabaseRest<SimPerformanceRow[]>("rpc/fireblade_employee_sim_call_performance", {
        method: "POST",
        body: JSON.stringify({ p_start_epoch_ms: start, p_end_epoch_ms: end }),
      }),
      supabaseRest<DepartmentUniqueRow[]>("rpc/fireblade_department_unique_incoming", {
        method: "POST",
        body: JSON.stringify({ p_start_epoch_ms: start, p_end_epoch_ms: end }),
      }),
    ]);

    const simsByEmployee = new Map<string, SimPerformanceRow[]>();
    for (const sim of simRows) {
      const list = simsByEmployee.get(sim.employee_id) || [];
      list.push(sim);
      simsByEmployee.set(sim.employee_id, list);
    }

    const departmentTotals = new Map(
      departmentRows.map(row => [row.department_id || "UNASSIGNED", Number(row.total_incoming || 0)]),
    );

    const enriched = rows.map(row => ({
      ...row,
      department_total_incoming: departmentTotals.get(row.department_id || "UNASSIGNED") || 0,
      sims: simsByEmployee.get(row.employee_id) || [],
    }));

    return NextResponse.json({
      from,
      to,
      generated_at: new Date().toISOString(),
      rows: enriched,
    });
  } catch (error) {
    console.error("[Fireblade Gen2.1 performance]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load employee performance" },
      { status: 500 },
    );
  }
}

