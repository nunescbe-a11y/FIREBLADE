import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

type InformationItem = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  sent: boolean;
  remarks: string | null;
  answered_by: string | null;
  updated_at: string | null;
};

type ReportRow = {
  enquiry_id: string;
  call_id: number;
  call_at: string;
  employee_id: string;
  employee_name: string;
  customer_name: string;
  customer_company: string;
  customer_phone: string;
  product_name: string;
  requirement_details: string | null;
  notes: string | null;
  information_items: InformationItem[];
};

type InformationTypeRow = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
};

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

function reportRecord(row: ReportRow, types: InformationTypeRow[]) {
  const byType = new Map((row.information_items || []).map((item) => [item.id, item]));
  const record: Record<string, string | number> = {
    "Employee Name": row.employee_name || "",
    "Employee ID": row.employee_id || "",
    "Customer Name": row.customer_name || "",
    "Customer Company": row.customer_company || "",
    "Customer Phone": row.customer_phone || "",
    "Product Name": row.product_name || "",
  };

  for (const type of types) {
    const item = byType.get(type.id);
    record[`${type.label} Sent`] = item ? (item.sent ? "Yes" : "No") : "Not recorded";
    record[`${type.label} Remarks`] = item?.remarks || "";
  }

  record["Requirement Details"] = row.requirement_details || "";
  record["Notes"] = row.notes || "";
  record["Call Date / Time (IST)"] = istDateTime(row.call_at);
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
  const format = String(url.searchParams.get("format") || "").toLowerCase();

  if (!validDate(from) || !validDate(to)) return NextResponse.json({ error: "Valid from/to dates are required" }, { status: 400 });
  if (from > to) return NextResponse.json({ error: "From date cannot be after To date" }, { status: 400 });

  try {
    const [rowsRaw, types] = await Promise.all([
      supabaseRest<ReportRow[]>("rpc/fireblade_information_sent_report", {
        method: "POST",
        body: JSON.stringify({ p_start_date: from, p_end_date: to }),
      }),
      supabaseRest<InformationTypeRow[]>(
        "fireblade_information_types?select=id,code,label,sort_order,active&order=sort_order.asc,label.asc",
      ),
    ]);

    const rows = employee ? rowsRaw.filter((row) => row.employee_id === employee) : rowsRaw;

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