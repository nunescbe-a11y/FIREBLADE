// Pure handover selection rules, shared by the Admin and Management API.
export type HandoverScope = "original" | "test";
export type HandoverDepartment = "MARKETING" | "SERVICE";
export const HANDOVER_SOURCES = {
  original: { deviceId: "MKT-019", employeeId: "EMP-017", title: "Original Shane's Handover" },
  test: { deviceId: "MKT-001", employeeId: "TEST-SHANE-001", title: "Shane Test Handover" },
} as const;

export type HandoverDetail = {
  detail_id: string;
  device_id: string;
  employee_id: string;
  customer_name: string | null;
  product_asked: string | null;
  location: string | null;
  notes: string | null;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  call_started_at_epoch_ms: number;
  very_urgent: boolean | null;
};

export type HandoverEvent = {
  event_id: string;
  detail_id: string;
  assigned_to_employee_id: string;
  event_type: string;
  occurred_at_epoch_ms: number;
  recorded_at: string;
};

export type LatestHandover = {
  occurred_at_epoch_ms: number;
  event_type: string;
  recipients: Map<string, HandoverEvent>;
};

/** A save produces one ASSIGNED/REASSIGNED event per recipient at the same instant.
 * WhatsApp handoff events must never alter current assignments or counts.
 * Later saves replace earlier recipient selections; history is retained separately.
 */
export function latestHandovers(events: HandoverEvent[]): Map<string, LatestHandover> {
  const grouped = new Map<string, LatestHandover>();
  const sorted = events
    .filter(e => (e.event_type === "ASSIGNED" || e.event_type === "REASSIGNED") &&
      Number.isSafeInteger(e.occurred_at_epoch_ms) && e.occurred_at_epoch_ms > 0 &&
      Boolean(e.detail_id && e.assigned_to_employee_id))
    .sort((a, b) =>
      b.occurred_at_epoch_ms - a.occurred_at_epoch_ms ||
      b.recorded_at.localeCompare(a.recorded_at) ||
      b.event_id.localeCompare(a.event_id)
    );
  for (const event of sorted) {
    let latest = grouped.get(event.detail_id);
    if (!latest) {
      latest = { occurred_at_epoch_ms: event.occurred_at_epoch_ms, event_type: event.event_type, recipients: new Map() };
      grouped.set(event.detail_id, latest);
    }
    if (latest.occurred_at_epoch_ms !== event.occurred_at_epoch_ms || latest.event_type !== event.event_type) continue;
    // Each employee gets at most one card per detail, even if an event was retried.
    if (!latest.recipients.has(event.assigned_to_employee_id)) {
      latest.recipients.set(event.assigned_to_employee_id, event);
    }
  }
  return grouped;
}

export function istDay(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const field = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${field("year")}-${field("month")}-${field("day")}`;
}

export function currentHandoverItems(
  details: HandoverDetail[],
  handovers: Map<string, LatestHandover>,
  employeeId: string,
  from = "",
  to = "",
  query = "",
) {
  const search = query.trim().toLocaleLowerCase();
  return details.flatMap(detail => {
    const latest = handovers.get(detail.detail_id);
    const event = latest?.recipients.get(employeeId);
    if (!event) return [];
    const day = istDay(event.occurred_at_epoch_ms);
    if ((from && day < from) || (to && day > to)) return [];
    if (search && ![
      detail.customer_name, detail.product_asked, detail.location,
      detail.phone_number_raw, detail.phone_number_normalized, detail.notes,
    ].some(value => String(value || "").toLocaleLowerCase().includes(search))) return [];
    return [{ ...detail, assignment_event_id: event.event_id,
      assignment_event_type: event.event_type, assigned_to_employee_id: employeeId,
      assigned_at_epoch_ms: event.occurred_at_epoch_ms }];
  }).sort((a, b) =>
    b.assigned_at_epoch_ms - a.assigned_at_epoch_ms ||
    a.detail_id.localeCompare(b.detail_id)
  );
}
