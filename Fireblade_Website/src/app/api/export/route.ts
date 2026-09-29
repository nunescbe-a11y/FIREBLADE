import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { DeviceAssignment, FirebladeDeviceLine, FirebladeEmployee, IncomingCall } from "@/lib/types";
import { formatIST } from "@/lib/format";
import { FIREBLADE_VISIBLE_FROM_EPOCH_MS } from "@/lib/call-window";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const employeeId = session.role === "MARKETING" ? (session.employee_id || "") : (url.searchParams.get("employeeId")?.trim() || "");
  const lineFilter = url.searchParams.get("lineFilter")?.trim() || "";

  try {
    const [calls, employees, assignments, lines] = await Promise.all([
      supabaseRest<IncomingCall[]>(`fireblade_incoming_calls?select=*&started_at_epoch_ms=gte.${FIREBLADE_VISIBLE_FROM_EPOCH_MS}${session.role === "MARKETING" && session.employee_id ? `&registered_employee_id=eq.${encodeURIComponent(session.employee_id)}` : ""}&order=started_at_epoch_ms.desc&limit=5000`),
      supabaseRest<FirebladeEmployee[]>("fireblade_employees?select=*&active=eq.true"),
      supabaseRest<DeviceAssignment[]>("fireblade_device_assignments?select=*&assigned_until=is.null"),
      supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true"),
    ]);

    const selectedEmployee = employees.find(e => e.employee_id === employeeId) || null;
    const employeeDevices = new Set(assignments.filter(a => !employeeId || a.employee_id === employeeId).map(a => a.device_id));
    let selectedLineId: number | null = null;
    let selectedDeviceId = "";
    if (lineFilter.startsWith("LINE:")) {
      selectedLineId = Number(lineFilter.slice(5));
      selectedDeviceId = lines.find(l => l.id === selectedLineId)?.device_id || "";
    } else if (lineFilter.startsWith("DEVICE:")) {
      selectedDeviceId = lineFilter.slice(7);
    }

    const filtered = calls.filter(c => {
      if (employeeId) {
        const exact = c.registered_employee_id === employeeId;
        const historicalFallback = !c.registered_employee_id && employeeDevices.has(c.device_id) && selectedEmployee &&
          (c.received_by || c.collector_employee || "").trim().toLowerCase() === selectedEmployee.employee_name.trim().toLowerCase();
        if (!exact && !historicalFallback) return false;
      }
      if (selectedDeviceId && c.device_id !== selectedDeviceId) return false;
      if (selectedLineId != null) {
        if (c.resolved_line_id === selectedLineId) return true;
        const deviceLines = lines.filter(l => l.device_id === selectedDeviceId && l.active);
        if (c.resolved_line_id == null && deviceLines.length === 1) return true;
        return false;
      }
      return true;
    });

    const records = filtered.map((c) => {
      const handled = Boolean(c.enquiry_id) && c.resolution_outcome !== "RECOVERED";
      return {
      "Call Date / Time (IST)": formatIST(c.started_at_epoch_ms),
      "Customer Phone Number": c.phone_number_normalized || c.phone_number_raw || "",
      "Received By": c.received_by || "",
      "Employee ID": c.registered_employee_id || "",
      "Company Line": c.company_phone_number || (c.line_resolution === "MULTI_SIM_UNKNOWN" ? "Multiple SIMs - line unknown" : ""),
      "SIM": c.resolved_sim_slot_index === 1 ? "SIM 2" : c.resolved_sim_slot_index === 0 ? "SIM 1" : "",
      "Line Resolution": c.line_resolution || "",
      "Device ID": c.device_id,
      "Phone Label": c.phone_label || "",
      "Call Status": c.direction,
      "Duration Seconds": c.duration_seconds,
      "Person Name": c.person_name || "",
      "Company": c.company_name || "",
      "Product / Requirement": handled ? (c.product_name || "") : "",
      "Requirement Details": handled ? (c.requirement_details || "") : "",
      "Notes": handled ? (c.notes || "") : "",
      "Enquiry Status": handled ? "COMPLETED" : "PENDING",
      "Entered By": c.entered_by || "",
      "Updated By": c.updated_by || "",
      };
    });

    if (format === "csv") {
      const headers = Object.keys(records[0] || { "Call Date / Time (IST)": "" });
      const csv = [headers.map(csvCell).join(","), ...records.map((r) => headers.map((h) => csvCell((r as Record<string, unknown>)[h])).join(","))].join("\r\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=fireblade-incoming-calls-${new Date().toISOString().slice(0, 10)}.csv`,
        },
      });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Fireblade V1.2";
    const sheet = workbook.addWorksheet("Incoming Calls");
    const headers = Object.keys(records[0] || { "Call Date / Time (IST)": "" });
    sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(16, Math.min(36, header.length + 5)) }));
    records.forEach((record) => sheet.addRow(record));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + Math.min(headers.length, 26))}1` };
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=fireblade-incoming-calls-${new Date().toISOString().slice(0, 10)}.xlsx`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 500 });
  }
}
