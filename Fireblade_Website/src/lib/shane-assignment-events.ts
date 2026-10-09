import { supabaseRest } from "@/lib/supabase";

export type ShaneAssignmentEvent = {
  event_id: string;
  detail_id: string;
  assigned_to_employee_id: string;
  event_type: "ASSIGNED" | "REASSIGNED";
  occurred_at_epoch_ms: number;
  recorded_at: string;
};

export type ShaneAssignmentBatch = {
  occurred_at_epoch_ms: number;
  events: ShaneAssignmentEvent[];
};

const DETAIL_ID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

/**
 * Read every selected recipient from the most recent ASSIGNED save per call.
 * Multiple employees selected in one Save share a timestamp; do not discard them.
 * Only ASSIGNED / REASSIGNED count as an assignment: opening WhatsApp
 * alone must never be mistaken for a confirmed recipient or send.
 * All access is server-side through the protected service-role REST client.
 */
export async function loadShaneLatestAssignments(
  detailIds: string[],
): Promise<Map<string, ShaneAssignmentBatch>> {
  const uniqueIds = [...new Set(detailIds)].filter(id => DETAIL_ID_PATTERN.test(id));
  const assignments = new Map<string, ShaneAssignmentBatch>();
  for (let start = 0; start < uniqueIds.length; start += 50) {
    const chunk = uniqueIds.slice(start, start + 50);
    let offset = 0;
    // Paginate so a busy customer can have any number of reassignment events.
    while (true) {
      const page = await supabaseRest<ShaneAssignmentEvent[]>(
        `fireblade_shane_assignment_events?select=event_id,detail_id,assigned_to_employee_id,event_type,occurred_at_epoch_ms,recorded_at&detail_id=in.(${chunk.join(",")})&event_type=in.(ASSIGNED,REASSIGNED)&order=occurred_at_epoch_ms.desc,recorded_at.desc&limit=1000&offset=${offset}`
      );
      for (const event of page) {
        const batch = assignments.get(event.detail_id);
        if (!batch) {
          assignments.set(event.detail_id, { occurred_at_epoch_ms: event.occurred_at_epoch_ms, events: [event] });
        } else if (batch.occurred_at_epoch_ms === event.occurred_at_epoch_ms
          && event.event_type === "ASSIGNED"
          && batch.events[0].event_type === "ASSIGNED"
          && !batch.events.some(saved => saved.assigned_to_employee_id === event.assigned_to_employee_id)) {
          batch.events.push(event);
        }
      }
      if (page.length < 1000) break;
      offset += page.length;
      if (offset >= 100000) throw new Error("Too many Shane assignment events for a report");
    }
  }
  return assignments;
}
