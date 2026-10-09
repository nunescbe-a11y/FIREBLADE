import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import {
  HANDOVER_SOURCES, currentHandoverItems, istDay, latestHandovers,
  type HandoverDetail, type HandoverDepartment, type HandoverEvent, type HandoverScope,
} from "@/lib/shane-handover";

type EmployeeRow = {
  employee_id: string;
  employee_name: string;
  department_id: string | null;
  profile_photo_updated_at: string | null;
};
type DepartmentRow = { id: string; name: string };
type Recipient = EmployeeRow & { department: HandoverDepartment; count: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 25;
const CHUNK_SIZE = 40;
const MAX_DETAILS = 50000;
const MAX_EVENTS_PER_CHUNK = 100000;

function validDay(value: string) {
  if (!DATE.test(value)) return false;
  const ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

async function loadRoster(): Promise<Recipient[]> {
  const [employees, departments] = await Promise.all([
    supabaseRest<EmployeeRow[]>(
      "fireblade_employees?select=employee_id,employee_name,department_id,profile_photo_updated_at&active=eq.true&order=employee_name.asc&limit=1000"
    ),
    supabaseRest<DepartmentRow[]>(
      "fireblade_departments?select=id,name&active=eq.true&limit=1000"
    ),
  ]);
  const depts = new Map(departments.map(d => [d.id, d.name.trim().toUpperCase()]));
  return employees.flatMap((employee): Recipient[] => {
    const department = depts.get(employee.department_id || "");
    if (department === "MARKETING") return [{ ...employee, department: "MARKETING" as const, count: 0 }];
    // Only EMP-008 is a permitted SERVICE handover recipient.
    if (department === "SERVICE" && employee.employee_id === "EMP-008")
      return [{ ...employee, department: "SERVICE" as const, count: 0 }];
    return [];
  });
}

async function loadScopedDetails(scope: HandoverScope): Promise<HandoverDetail[]> {
  const source = HANDOVER_SOURCES[scope];
  const all: HandoverDetail[] = [];
  const take = 1000;
  for (let offset = 0; offset < MAX_DETAILS; offset += take) {
    const page = await supabaseRest<HandoverDetail[]>(
      "fireblade_shane_call_details?select=" +
      "detail_id,device_id,employee_id,customer_name,product_asked,location,notes," +
      "phone_number_raw,phone_number_normalized,call_started_at_epoch_ms,very_urgent" +
      `&device_id=eq.${source.deviceId}&employee_id=eq.${source.employeeId}` +
      `&order=detail_id.asc&limit=${take}&offset=${offset}`
    );
    all.push(...page);
    if (page.length < take) return all;
  }
  throw new Error("Too many handovers for one report. Narrow the date range or add an indexed RPC.");
}

async function loadScopedEvents(details: HandoverDetail[]): Promise<HandoverEvent[]> {
  const all: HandoverEvent[] = [];
  const detailIds = [...new Set(details.map(d => d.detail_id))].filter(id => UUID.test(id));
  for (let start = 0; start < detailIds.length; start += CHUNK_SIZE) {
    const ids = detailIds.slice(start, start + CHUNK_SIZE);
    for (let offset = 0; offset < MAX_EVENTS_PER_CHUNK; offset += 1000) {
      const page = await supabaseRest<HandoverEvent[]>(
        "fireblade_shane_assignment_events?select=" +
        "event_id,detail_id,assigned_to_employee_id,event_type,occurred_at_epoch_ms,recorded_at" +
        `&detail_id=in.(${ids.join(",")})&event_type=in.(ASSIGNED,REASSIGNED)` +
        `&order=occurred_at_epoch_ms.desc,event_id.desc&limit=1000&offset=${offset}`
      );
      all.push(...page);
      if (page.length < 1000) break;
      if (offset + 1000 >= MAX_EVENTS_PER_CHUNK) {
        throw new Error("Assignment audit is too large to paginate safely.");
      }
    }
  }
  return all;
}

function errorResponse(error: unknown) {
  console.error("[Fireblade Shane Handover]", error);
  return NextResponse.json({ error: "Could not load Shane's Handover" }, { status: 500 });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGEMENT")
    return NextResponse.json({ error: "Admin or Management access required" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") || "";
  if (scope !== "original" && scope !== "test")
    return NextResponse.json({ error: "Choose an authorized handover box" }, { status: 400 });
  const mode = params.get("mode") || "roster";
  const from = (params.get("from") || "").trim();
  const to = (params.get("to") || "").trim();
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to))
    return NextResponse.json({ error: "Invalid assignment date range" }, { status: 400 });

  try {
    if (mode === "history") {
      const detailId = params.get("detail_id") || "";
      if (!UUID.test(detailId)) return NextResponse.json({ error: "Invalid detail ID" }, { status: 400 });
      const source = HANDOVER_SOURCES[scope];
      // Strict, independent authorization of each modal read against the box's device and employee.
      const details = await supabaseRest<HandoverDetail[]>(
        "fireblade_shane_call_details?select=" +
        "detail_id,device_id,employee_id,customer_name,product_asked,location,notes," +
        "phone_number_raw,phone_number_normalized,call_started_at_epoch_ms,very_urgent" +
        `&detail_id=eq.${detailId}&device_id=eq.${source.deviceId}` +
        `&employee_id=eq.${source.employeeId}&limit=1`
      );
      if (!details.length) return NextResponse.json({ error: "No handover in this box" }, { status: 404 });
      const events = await supabaseRest<Array<HandoverEvent & {
        whatsapp_recipient_number: string | null;
        form_snapshot: Record<string, unknown> | null;
      }>>(
        "fireblade_shane_assignment_events?select=" +
        "event_id,detail_id,assigned_to_employee_id,event_type,occurred_at_epoch_ms,recorded_at," +
        "whatsapp_recipient_number,form_snapshot" +
        `&detail_id=eq.${detailId}&order=occurred_at_epoch_ms.desc&limit=200`
      );
      return NextResponse.json({ detail: details[0], events }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    if (mode !== "roster" && mode !== "customers")
      return NextResponse.json({ error: "Invalid view" }, { status: 400 });

    const [roster, details] = await Promise.all([loadRoster(), loadScopedDetails(scope)]);
    const handovers = latestHandovers(await loadScopedEvents(details));

    if (mode === "roster") {
      const counts = new Map(roster.map(e => [e.employee_id, 0]));
      // Count distinct detail IDs per department, not selected-recipient or WhatsApp events.
      const uniqueByDepartment: Record<HandoverDepartment, Set<string>> = {
        MARKETING: new Set<string>(),
        SERVICE: new Set<string>(),
      };
      const departmentByEmployee = new Map(roster.map(e => [e.employee_id, e.department]));
      for (const detail of details) {
        const handover = handovers.get(detail.detail_id);
        if (!handover) continue;
        const day = istDay(handover.occurred_at_epoch_ms);
        if ((from && day < from) || (to && day > to)) continue;
        for (const employeeId of handover.recipients.keys()) {
          if (counts.has(employeeId)) {
            counts.set(employeeId, (counts.get(employeeId) || 0) + 1);
            const assignedDepartment = departmentByEmployee.get(employeeId);
            if (assignedDepartment) uniqueByDepartment[assignedDepartment].add(detail.detail_id);
          }
        }
      }
      return NextResponse.json({
        scope,
        department_totals: {
          MARKETING: uniqueByDepartment.MARKETING.size,
          SERVICE: uniqueByDepartment.SERVICE.size,
        },
        departments: {
          MARKETING: roster.filter(e => e.department === "MARKETING")
            .map(e => ({ ...e, count: counts.get(e.employee_id) || 0 })),
          SERVICE: roster.filter(e => e.department === "SERVICE")
            .map(e => ({ ...e, count: counts.get(e.employee_id) || 0 })),
        },
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const department = params.get("department") || "";
    const employeeId = params.get("employee") || "";
    const employee = roster.find(e => e.employee_id === employeeId && e.department === department);
    if (!employee || (department !== "MARKETING" && department !== "SERVICE"))
      return NextResponse.json({ error: "Recipient not permitted in department" }, { status: 404 });
    const page = Number(params.get("page") || "1");
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    const query = (params.get("q") || "").trim().slice(0, 120);
    const all = currentHandoverItems(details, handovers, employeeId, from, to, query);
    const format = String(params.get("format") || "").toLowerCase();
    if (format && format !== "csv" && format !== "xlsx")
      return NextResponse.json({ error: "Unsupported export format" }, { status: 400 });
    if (format) {
      const ist = (ms: number) => new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(ms));
      const exported = all.map(row => ({
        "Employee": scope === "original" ? "SHANE" : "SHANE TEST",
        "Customer": row.customer_name || "Not recorded",
        "Product": row.product_asked || "Not recorded",
        "Call Date / Time": ist(row.call_started_at_epoch_ms),
        "Location": row.location || "Not recorded",
        "Assigned To": employee.employee_name,
        "Assigned Date / Time": ist(row.assigned_at_epoch_ms),
        "Customer Phone": row.phone_number_normalized || row.phone_number_raw || "",
        "Notes": row.notes || "",
        "Shane Detail ID": row.detail_id,
        "Assignment Event ID": row.assignment_event_id,
      }));
      const columns = [
        "Employee", "Customer", "Product", "Call Date / Time", "Location",
        "Assigned To", "Assigned Date / Time", "Customer Phone", "Notes",
        "Shane Detail ID", "Assignment Event ID",
      ];
      const fileName = `shane-handover-${scope}-${employeeId}`;
      if (format === "csv") {
        const cell = (value: string) => {
          // Avoid spreadsheet formula execution from untrusted customer input.
          const safe = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
          return '"' + safe.replaceAll('"', '""') + '"';
        };
        const lines = [
          columns.map(cell).join(","),
          ...exported.map(record => columns.map(key => cell(
            String(record[key as keyof typeof record] ?? "")
          )).join(",")),
        ];
        return new NextResponse(lines.join("\r\n"), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fileName}.csv"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Fireblade Gen 2";
      const sheet = workbook.addWorksheet("Shane Handover");
      sheet.columns = columns.map(header => ({ header, key: header, width: Math.min(36, Math.max(15, header.length + 5)) }));
      for (const record of exported) {
        sheet.addRow(Object.fromEntries(columns.map(key => {
          const value = String(record[key as keyof typeof record] ?? "");
          return [key, /^[=+@\-\t\r]/.test(value) ? "'" + value : value];
        })));
      }
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(buffer as BodyInit, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}.xlsx"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return NextResponse.json({
      scope, employee: { employee_id: employee.employee_id, employee_name: employee.employee_name },
      total: all.length, page, pageSize: PAGE_SIZE,
      items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
