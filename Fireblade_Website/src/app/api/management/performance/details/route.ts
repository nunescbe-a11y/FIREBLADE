import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CALL_METRICS = new Set(["TOTAL", "ANSWERED", "MISSED"]);
const CALLBACK_METRICS = new Set(["CALLED_BACK", "PENDING"]);

function dateEpoch(date: string) {
  return Date.parse(`${date}T00:00:00+05:30`);
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Management access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const employee = (url.searchParams.get("employee") || "").trim().toUpperCase();
  const metric = (url.searchParams.get("metric") || "").trim().toUpperCase();
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const lineRaw = (url.searchParams.get("line") || "").trim();
  const lineId = lineRaw ? Number(lineRaw) : null;

  if (
    !employee ||
    (!CALL_METRICS.has(metric) && !CALLBACK_METRICS.has(metric)) ||
    !DATE_RE.test(from) ||
    !DATE_RE.test(to) ||
    (lineRaw !== "" && (!Number.isInteger(lineId) || Number(lineId) <= 0))
  ) {
    return NextResponse.json({ error: "Invalid detail request" }, { status: 400 });
  }

  const start = dateEpoch(from);
  const end = dateEpoch(to) + 86_400_000;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 366 * 86_400_000) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    if (CALL_METRICS.has(metric)) {
      const rows = await supabaseRest("rpc/fireblade_employee_call_detail_rows", {
        method: "POST",
        body: JSON.stringify({
          p_employee_id: employee,
          p_metric: metric,
          p_start_epoch_ms: start,
          p_end_epoch_ms: end,
          p_line_id: lineId,
        }),
      });

      return NextResponse.json({ kind: "CALL", metric, line_id: lineId, rows });
    }

    const status = metric === "CALLED_BACK" ? "RESOLVED" : "PENDING";
    const rows = await supabaseRest("rpc/fireblade_employee_callback_detail_rows", {
      method: "POST",
      body: JSON.stringify({
        p_employee_id: employee,
        p_status: status,
        p_start_epoch_ms: start,
        p_end_epoch_ms: end,
        p_line_id: lineId,
      }),
    });

    return NextResponse.json({ kind: "CALLBACK", metric, line_id: lineId, rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load performance details" },
      { status: 500 },
    );
  }
}

