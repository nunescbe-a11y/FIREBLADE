import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";
import { bridgeRequest } from "@/lib/whatsapp";
import { buildPendingCallReportMessages, reportDateIST, type PendingCallReportRow } from "@/lib/pending-call-report";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_NAME = "pending-call-report";

type EmployeeRow = { employee_id: string; employee_name: string; active: boolean };
type ConnectionRow = { employee_id: string; session_key: string; whatsapp_number: string | null; status: string };
type ClaimRow = { id: string };

function authorized(request: Request) {
  const expected = process.env.FIREBLADE_WHATSAPP_BRIDGE_KEY?.trim() || "";
  const supplied = request.headers.get("x-fireblade-bridge-key")?.trim() || "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function updateRun(id: string, values: Record<string, unknown>) {
  await supabaseRest(`fireblade_pending_call_report_runs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
}

async function ensureReady(connection: ConnectionRow) {
  const path = `/sessions/${encodeURIComponent(connection.session_key)}`;
  let status = await bridgeRequest<{ status?: string; number?: string | null }>(`${path}/status`);
  if (status.status === "READY") return status;

  status = await bridgeRequest<{ status?: string; number?: string | null }>(`${path}/start`, {
    method: "POST",
    body: "{}",
  });
  if (status.status === "READY") return status;

  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    status = await bridgeRequest<{ status?: string; number?: string | null }>(`${path}/status`);
    if (status.status === "READY") return status;
  }
  throw new Error(`WhatsApp session ${connection.session_key} is ${status.status || "not ready"}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reportDate = reportDateIST(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const summary: Array<{ employee_id: string; pending: number; status: string; messages?: number; error?: string }> = [];

  try {
    const [employees, connections, pendingRows] = await Promise.all([
      supabaseRest<EmployeeRow[]>("fireblade_employees?select=employee_id,employee_name,active&active=eq.true&order=employee_name.asc&limit=1000"),
      supabaseRest<ConnectionRow[]>("fireblade_whatsapp_connections?select=employee_id,session_key,whatsapp_number,status&whatsapp_number=not.is.null&limit=1000"),
      supabaseRest<Array<Omit<PendingCallReportRow, "callback_status">>>(
        "rpc/fireblade_pending_call_report_yesterday",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ p_report_date_ist: reportDate }),
        },
      ).then(rows =>
        rows.map(row => ({ ...row, callback_status: "PENDING" as const })),
      ),
    ]);

    const active = new Map(employees.map(employee => [employee.employee_id, employee]));
    const connectionByEmployee = new Map(connections.map(connection => [connection.employee_id, connection]));
    const pendingByEmployee = new Map<string, PendingCallReportRow[]>();
    for (const row of pendingRows) {
      if (!active.has(row.employee_id)) continue;
      const group = pendingByEmployee.get(row.employee_id) || [];
      group.push(row);
      pendingByEmployee.set(row.employee_id, group);
    }

    for (const [employeeId, rows] of pendingByEmployee.entries()) {
      const employee = active.get(employeeId);
      const connection = connectionByEmployee.get(employeeId);
      if (!employee || !connection?.whatsapp_number) {
        summary.push({ employee_id: employeeId, pending: rows.length, status: "SKIPPED_NO_LINKED_WHATSAPP" });
        continue;
      }

      const claim = await supabaseRest<ClaimRow[]>("rpc/fireblade_claim_pending_call_report", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_report_date_ist: reportDate,
          p_employee_id: employeeId,
          p_whatsapp_number: connection.whatsapp_number,
          p_pending_count: rows.length,
          p_pending_call_ids: rows.map(row => row.missed_call_id),
        }),
      });
      const runId = claim[0]?.id;
      if (!runId) {
        summary.push({ employee_id: employeeId, pending: rows.length, status: "ALREADY_CLAIMED" });
        continue;
      }

      try {
        await ensureReady(connection);
        const messages = buildPendingCallReportMessages(employee.employee_name || employeeId, rows);
        const providerMessageIds: Array<string | null> = [];
        for (const text of messages) {
          const result = await bridgeRequest<{ text_message_id?: string | null }>(`/sessions/${encodeURIComponent(connection.session_key)}/send`, {
            method: "POST",
            body: JSON.stringify({ to: connection.whatsapp_number, text, media: [] }),
          });
          providerMessageIds.push(result.text_message_id || null);
        }

        await updateRun(runId, {
          status: "SENT",
          message_count: messages.length,
          provider_message_ids: providerMessageIds,
          sent_at: new Date().toISOString(),
          last_error: null,
        });
        summary.push({ employee_id: employeeId, pending: rows.length, status: "SENT", messages: messages.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Pending-call report failed";
        await updateRun(runId, { status: "FAILED", last_error: message.slice(0, 1000) });
        summary.push({ employee_id: employeeId, pending: rows.length, status: "FAILED", error: message });
      }
    }

    return NextResponse.json({ ok: true, job: JOB_NAME, report_date_ist: reportDate, employees: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pending-call report job failed";
    console.error(`[Fireblade ${JOB_NAME}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


