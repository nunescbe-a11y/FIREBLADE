import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import { loadShaneLatestAssignments } from "@/lib/shane-assignment-events";

import {
  mergeShaneReportRows, shaneDateWindow,
  type InformationTypeRow, type ReportRow, type ShaneDetailRow,
} from "@/lib/shane-information-report";

type EmployeeNameRow = { employee_id: string; employee_name: string };

async function loadShaneDetails(from: string, to: string): Promise<ShaneDetailRow[]> {
  const { start, end } = shaneDateWindow(from, to);
  const rows: ShaneDetailRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const page = await supabaseRest<ShaneDetailRow[]>(
      `fireblade_shane_call_details?select=*&call_started_at_epoch_ms=gte.${start}&call_started_at_epoch_ms=lt.${end}&order=call_started_at_epoch_ms.desc,detail_id.desc&limit=${pageSize}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error("Too many call details for selected period; choose a shorter range");
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function istDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function assignmentTime(row: ReportRow): string {
  if (typeof row.assigned_at_epoch_ms === "number" && row.assigned_at_epoch_ms > 0) {
    return istDateTime(new Date(row.assigned_at_epoch_ms).toISOString());
  }
  if (row.assigned_at && !Number.isNaN(Date.parse(row.assigned_at))) {
    return istDateTime(row.assigned_at);
  }
  return "Not recorded";
}

function reportRecord(row: ReportRow, types: InformationTypeRow[]) {
  const byType = new Map((row.information_items || []).map(item => [item.id, item]));
  // CSV and Excel use the same seven primary columns as the screen, followed by details.
  const record: Record<string, string | number> = {
    "Employee": row.employee_name || row.employee_id || "Not recorded",
    "Customer": row.customer_name || "Not recorded",
    "Product": row.product_name || "Not recorded",
    "Call Date / Time": istDateTime(row.call_at),
    "Location": row.location || "Not recorded",
    "Assigned To": row.assigned_to_employee_name || row.assigned_to_employee_id || "Not recorded",
    "Assigned Date / Time": assignmentTime(row),
    "Employee ID": row.employee_id || "",
    "Source": row.source === "SHANE" ? "Shane" : "Employee enquiry",
    "Customer Company": row.customer_company || "",
    "Customer Phone": row.customer_phone || "",
  };

  for (const type of types) {
    const item = byType.get(type.id);
    record[`${type.label} Sent`] = row.source === "SHANE"
      ? "Not applicable on Shane form"
      : item ? (item.sent ? "Yes" : "No") : "Not recorded";
    record[`${type.label} Remarks`] = item?.remarks || "";
  }

  record["Very Urgent"] = row.source === "SHANE" ? (row.very_urgent ? "Yes" : "No") : "Not recorded";
  record["Device ID"] = row.device_id || "";
  record["Shane Detail ID"] = row.detail_id || "";
  record["Requirement Details"] = row.requirement_details || "";
  record["Notes"] = row.notes || "";
  return record;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Admin or Management access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = String(url.searchParams.get("from") || "").trim();
  const to = String(url.searchParams.get("to") || "").trim();
  const employee = String(url.searchParams.get("employee") || "").trim();
  const source = String(url.searchParams.get("source") || "").trim().toUpperCase();
  const format = String(url.searchParams.get("format") || "").toLowerCase();

  if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: "Valid from/to dates are required" }, { status: 400 });
  if (from > to) return NextResponse.json({ error: "From date cannot be after To date" }, { status: 400 });
  if (source && source !== "ENQUIRY") return NextResponse.json({ error: "Invalid source filter" }, { status: 400 });

  try {
    const [rowsRaw, types, details, employees] = await Promise.all([
      supabaseRest<ReportRow[]>("rpc/fireblade_information_sent_report", {
        method: "POST",
        body: JSON.stringify({ p_start_date: from, p_end_date: to }),
      }),
      supabaseRest<InformationTypeRow[]>(
        "fireblade_information_types?select=id,code,label,sort_order,active&order=sort_order.asc,label.asc",
      ),
      loadShaneDetails(from, to),
      supabaseRest<EmployeeNameRow[]>("fireblade_employees?select=employee_id,employee_name"),
    ]);

    const employeeNames = new Map(employees.map(row => [row.employee_id, row.employee_name]));
    const assignments = await loadShaneLatestAssignments(details.map(row => row.detail_id));
    const detailsWithAssignments = details.map(detail => {
      const assignment = assignments.get(detail.detail_id);
      return {
        ...detail,
        assigned_to_employee_id: assignment?.events[0]?.assigned_to_employee_id ?? null,
        assigned_to_employee_name: assignment?.events.map(event =>
          employeeNames.get(event.assigned_to_employee_id) || event.assigned_to_employee_id
        ).join(", ") || null,
        assigned_at_epoch_ms: assignment?.occurred_at_epoch_ms ?? null,
      };
    });
    const combined = mergeShaneReportRows(rowsRaw, detailsWithAssignments, types, employeeNames);
    const rows = combined.filter(row => (!source || row.source === source) && (!employee || row.employee_id === employee));

    if (format !== "csv" && format !== "xlsx") {
      return NextResponse.json({ rows, types });
    }

    const records = rows.map((row) => reportRecord(row, types));
    const fallback = reportRecord({
      enquiry_id: "",
      call_id: 0,
      call_at: new Date().toISOString(),
      employee_id: "",
      employee_name: "",
      customer_name: "",
      customer_company: "",
      customer_phone: "",
      product_name: "",
      requirement_details: "",
      notes: "",
      information_items: [],
    }, types);
    const headers = Object.keys(records[0] || fallback);

    if (format === "csv") {
      const csv = [
        headers.map(csvCell).join(","),
        ...records.map((record) => headers.map((header) => csvCell(record[header])).join(",")),
      ].join("\r\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=fireblade-information-sent-${from}-to-${to}.csv`,
        },
      });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Fireblade Gen 2";
    const sheet = workbook.addWorksheet("Information Sent");
    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(14, Math.min(34, header.length + 4)),
    }));
    records.forEach((record) => sheet.addRow(record));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=fireblade-information-sent-${from}-to-${to}.xlsx`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load information sent report" }, { status: 500 });
  }
}