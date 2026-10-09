/** Normalize saved Shane customer details for the Admin and Management report.
 * Shane's Android form contains LOCATION, not quotation/catalogue/image options.
 * Any actual employee "Information Sent" answers are from their separate flow.
 */
export type InformationTypeRow = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
};

export type InformationItem = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  sent: boolean;
  remarks: string | null;
  answered_by: string | null;
  updated_at: string | null;
};

export type ReportRow = {
  enquiry_id: string;
  call_id: number | null;
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
  source?: "SHANE" | "ENQUIRY";
  detail_id?: string;
  device_id?: string;
  location?: string;
  very_urgent?: boolean;
  assigned_to_employee_id?: string | null;
  assigned_to_employee_name?: string | null;
  assigned_at?: string | null;
  assigned_at_epoch_ms?: number | null;
};

export type ShaneDetailRow = {
  detail_id: string;
  call_id: number | null;
  device_id: string;
  employee_id: string;
  phone_number_raw: string;
  phone_number_normalized: string;
  call_started_at_epoch_ms: number;
  customer_name: string;
  product_asked: string;
  location: string;
  notes: string;
  very_urgent: boolean;
  updated_at: string;
  assigned_to_employee_id?: string | null;
  assigned_to_employee_name?: string | null;
  assigned_at?: string | null;
  assigned_at_epoch_ms?: number | null;
};

export function shaneDateWindow(from: string, to: string) {
  // India has no seasonal clock change; filter by the *call time*, not the save time.
  const start = Date.parse(`${from}T00:00:00+05:30`);
  const end = Date.parse(`${to}T00:00:00+05:30`) + 86_400_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Invalid India-time date range");
  }
  return { start, end };
}

export function mergeShaneReportRows(
  existing: ReportRow[],
  details: ShaneDetailRow[],
  _types: InformationTypeRow[],
  employeeNames: Map<string, string>,
): ReportRow[] {
  const byCall = new Map<number, ReportRow>();
  const withoutCall: ReportRow[] = [];
  for (const row of existing) {
    if (row.call_id == null) withoutCall.push({ ...row, source: "ENQUIRY" });
    else byCall.set(row.call_id, { ...row, source: "ENQUIRY" });
  }
  // The Shane record wins for the same call; this prevents duplicate entries.
  // The "source" marker allows full Shane details to be opened separately.
  for (const detail of details) {
    const matched = detail.call_id != null ? byCall.get(detail.call_id) : null;
    const row: ReportRow = {
      enquiry_id: detail.detail_id,
      detail_id: detail.detail_id,
      call_id: detail.call_id,
      device_id: detail.device_id,
      call_at: new Date(detail.call_started_at_epoch_ms).toISOString(),
      employee_id: detail.employee_id,
      employee_name: employeeNames.get(detail.employee_id) || detail.employee_id,
      customer_name: detail.customer_name || matched?.customer_name || "",
      customer_company: matched?.customer_company || "",
      customer_phone: detail.phone_number_raw || detail.phone_number_normalized || matched?.customer_phone || "",
      product_name: detail.product_asked || matched?.product_name || "",
      requirement_details: matched?.requirement_details || null,
      notes: detail.notes || matched?.notes || null,
      location: detail.location || "",
      very_urgent: detail.very_urgent,
      // An assignment is a separate action from receiving the call.
      // Never infer it from Shane's source employee_id or detail.updated_at.
      assigned_to_employee_id: detail.assigned_to_employee_id || null,
      assigned_to_employee_name: detail.assigned_to_employee_name?.trim()
        || (detail.assigned_to_employee_id
          ? employeeNames.get(detail.assigned_to_employee_id) || detail.assigned_to_employee_id
          : null),
      assigned_at: detail.assigned_at || null,
      assigned_at_epoch_ms: detail.assigned_at_epoch_ms ?? null,
      // Shane's Android form has NO quotation, catalogue or image selections.
      // Retain separately-saved employee follow-up answers, never invent Shane answers.
      information_items: matched?.information_items || [],
      source: "SHANE",
    };
    if (detail.call_id == null) withoutCall.push(row);
    else byCall.set(detail.call_id, row);
  }
  return [...byCall.values(), ...withoutCall]
    .sort((a, b) => Date.parse(b.call_at) - Date.parse(a.call_at));
}
