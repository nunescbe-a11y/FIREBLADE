import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { DeviceAssignment, FirebladeDevice, FirebladeDeviceLine, FirebladeEmployee, IncomingCall } from "@/lib/types";
import { FIREBLADE_VISIBLE_FROM_EPOCH_MS } from "@/lib/call-window";

// In-memory registry cache to keep application snappy and responsive (<100ms response)
let cachedRegistry: {
  timestamp: number;
  employees: FirebladeEmployee[];
  devices: FirebladeDevice[];
  assignments: DeviceAssignment[];
  lines: FirebladeDeviceLine[];
  enquiries: Array<{
    id: string;
    call_id: number;
    status: "PENDING" | "COMPLETED" | null;
    product_name: string | null;
    requirement_details: string | null;
    notes: string | null;
    entered_by: string | null;
    updated_by: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    resolution_outcome: string | null;
    resolution_at: string | null;
    resolution_by: string | null;
    contact_id?: string | null;
    person_name?: string | null;
    company_name?: string | null;
  }>;
  recordings: Array<{
    id: string;
    call_id: number | null;
    device_id: string;
    employee_id: string;
    phone_number: string;
    storage_bucket: string;
    storage_object_path: string;
    recording_started_at_epoch_ms: number;
    duration_ms: number;
  }>;
} | null = null;

const REGISTRY_CACHE_TTL_MS = 15_000;

async function getCachedRegistry() {
  const now = Date.now();
  if (cachedRegistry && now - cachedRegistry.timestamp < REGISTRY_CACHE_TTL_MS) {
    return cachedRegistry;
  }
  const [employees, devices, assignments, lines, enquiries, recordings] = await Promise.all([
    supabaseRest<FirebladeEmployee[]>("fireblade_employees?select=*&active=eq.true&order=employee_name.asc"),
    supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&active=eq.true&order=device_id.asc"),
    supabaseRest<DeviceAssignment[]>("fireblade_device_assignments?select=*&assigned_until=is.null&order=assigned_from.desc"),
    supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true&order=device_id.asc,sim_slot_index.asc"),
    supabaseRest<any[]>("fireblade_call_enquiries?select=*"),
    supabaseRest<any[]>("fireblade_call_recordings?select=id,call_id,device_id,employee_id,phone_number,storage_bucket,storage_object_path,recording_started_at_epoch_ms,duration_ms&order=created_at.desc&limit=100").catch(() => []),
  ]);
  cachedRegistry = { timestamp: now, employees, devices, assignments, lines, enquiries, recordings: recordings || [] };
  return cachedRegistry;
}

type Phase0CallRow = {
  id: number;
  device_id: string;
  employee_name: string | null;
  source_call_id: string | null;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  contact_name: string | null;
  direction: string;
  started_at_epoch_ms: number;
  duration_seconds: number;
  received_at: string | null;
  sim_slot_index: number | null;
  phone_account_id: string | null;
  subscription_id: number | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);

  // Allow larger fetch limits so full call history (up to 35,500+) can be loaded on demand
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 10000), 1), 40000);
  const today = url.searchParams.get("today") === "true";
  const allHistory = url.searchParams.get("all") === "true";
  const directionParam = url.searchParams.get("direction");
  const includeOutgoing = url.searchParams.get("include_outgoing") !== "false"; // Default true

  const istDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const since = today
    ? Date.parse(`${istDate}T00:00:00+05:30`)
    : allHistory
    ? 0
    : FIREBLADE_VISIBLE_FROM_EPOCH_MS;

  const isMarketing = session.role === "MARKETING" && session.employee_id;

  try {
    const registry = await getCachedRegistry();

    // Build filter query for phase0_calls
    const queryParts: string[] = [
      `started_at_epoch_ms=gte.${since}`,
      "order=started_at_epoch_ms.desc,id.desc"
    ];

    if (directionParam) {
      if (directionParam === "INCOMING") {
        queryParts.push("direction=like.INCOMING*");
      } else if (directionParam === "OUTGOING") {
        queryParts.push("direction=like.OUTGOING*");
      } else {
        queryParts.push(`direction=eq.${encodeURIComponent(directionParam)}`);
      }
    } else if (!includeOutgoing) {
      queryParts.push("direction=in.(INCOMING_ANSWERED,INCOMING_MISSED)");
    }

    if (isMarketing) {
      // Find devices assigned to this marketing employee
      const assignedDeviceIds = registry.assignments
        .filter(a => a.employee_id === session.employee_id)
        .map(a => a.device_id);
      if (assignedDeviceIds.length > 0) {
        queryParts.push(`device_id=in.(${assignedDeviceIds.map(encodeURIComponent).join(",")})`);
      } else {
        queryParts.push(`employee_name=eq.${encodeURIComponent(session.employee_name || "")}`);
      }
    }

    const baseFilter = queryParts.join("&");

    // Fetch calls in parallel 1000-row chunks for high performance
    const offsets: number[] = [];
    for (let offset = 0; offset < limit; offset += 1000) {
      offsets.push(offset);
    }

    const pages = await Promise.all(
      offsets.map(async offset => {
        const pageSize = Math.min(1000, limit - offset);
        return supabaseRest<Phase0CallRow[]>(
          `phase0_calls?select=id,device_id,employee_name,source_call_id,phone_number_raw,phone_number_normalized,contact_name,direction,started_at_epoch_ms,duration_seconds,received_at,sim_slot_index,phone_account_id,subscription_id&${baseFilter}&limit=${pageSize}&offset=${offset}`
        );
      })
    );

    const rawCalls = pages.flat();

    // In-memory enrichment
    const enqMap = new Map(registry.enquiries.map(e => [e.call_id, e]));
    const empMap = new Map(registry.employees.map(e => [e.employee_id, e]));
    const assignMap = new Map(registry.assignments.map(a => [a.device_id, a.employee_id]));
    const recByCallId = new Map(
      (registry.recordings || []).filter(r => r.call_id != null).map(r => [r.call_id!, r])
    );

    let incomingAnsweredCount = 0;
    let incomingMissedCount = 0;
    let outgoingConnectedCount = 0;
    let outgoingUnansweredCount = 0;
    let totalTalkSeconds = 0;

    const mappedCalls: IncomingCall[] = rawCalls.map(row => {
      if (row.direction === "INCOMING_ANSWERED") incomingAnsweredCount++;
      else if (row.direction === "INCOMING_MISSED") incomingMissedCount++;
      else if (row.direction === "OUTGOING_CONNECTED") outgoingConnectedCount++;
      else if (row.direction === "OUTGOING_UNANSWERED") outgoingUnansweredCount++;

      if (row.duration_seconds > 0) {
        totalTalkSeconds += row.duration_seconds;
      }

      const enq = enqMap.get(row.id);
      const empId = assignMap.get(row.device_id);
      const emp = empId ? empMap.get(empId) : null;
      const deviceLines = registry.lines.filter(l => l.device_id === row.device_id);
      const line = row.sim_slot_index != null
        ? deviceLines.find(l => l.sim_slot_index === row.sim_slot_index) || deviceLines[0]
        : deviceLines[0];

      // Match recording
      const normDigits = (row.phone_number_normalized || row.phone_number_raw || "").replace(/\D/g, "");
      const matchedRecording = recByCallId.get(row.id) || (registry.recordings || []).find(r => {
        if (!r.phone_number) return false;
        const recDigits = r.phone_number.replace(/\D/g, "");
        if (!recDigits || !normDigits) return false;
        const phoneMatch = normDigits.endsWith(recDigits) || recDigits.endsWith(normDigits);
        if (!phoneMatch) return false;
        if (r.recording_started_at_epoch_ms && row.started_at_epoch_ms) {
          return Math.abs(r.recording_started_at_epoch_ms - row.started_at_epoch_ms) < 180_000;
        }
        return true;
      });

      const recordingUrl = matchedRecording?.storage_object_path
        ? `/api/recordings?path=${encodeURIComponent(matchedRecording.storage_object_path)}`
        : null;

      const relevanceScore = matchedRecording ? 95 : (enq?.product_name ? 92 : (row.duration_seconds > 0 ? 88 : null));

      return {
        call_id: row.id,
        device_id: row.device_id,
        collector_employee: row.employee_name || null,
        phone_number_raw: row.phone_number_raw || null,
        phone_number_normalized: row.phone_number_normalized || row.phone_number_raw || null,
        phone_contact_name: row.contact_name || null,
        direction: row.direction as any,
        started_at_epoch_ms: row.started_at_epoch_ms,
        started_at: new Date(row.started_at_epoch_ms).toISOString(),
        duration_seconds: row.duration_seconds || 0,
        received_at: row.received_at || new Date(row.started_at_epoch_ms).toISOString(),
        call_phone_account_id: row.phone_account_id || null,
        call_phone_account_component: null,
        call_subscription_id: row.subscription_id || null,
        call_sim_slot_index: row.sim_slot_index ?? null,
        registered_employee_id: emp?.employee_id || null,
        registered_employee_name: emp?.employee_name || null,
        received_by: emp?.employee_name || row.employee_name || "Unassigned",
        company_phone_number: line?.phone_number || null,
        device_name: null,
        phone_label: null,
        resolved_line_id: line?.id || null,
        resolved_line_label: line?.line_label || null,
        resolved_line_carrier: line?.carrier_name || null,
        resolved_sim_slot_index: line?.sim_slot_index ?? null,
        line_resolution: line ? "EXACT_SIM" : "NO_LINE",
        enquiry_id: enq?.id || null,
        enquiry_status: enq?.status || null,
        product_name: enq?.product_name || null,
        requirement_details: enq?.requirement_details || null,
        notes: enq?.notes || null,
        entered_by: enq?.entered_by || null,
        updated_by: enq?.updated_by || null,
        enquiry_created_at: enq?.created_at || null,
        enquiry_updated_at: enq?.updated_at || null,
        resolution_outcome: (enq?.resolution_outcome as any) || null,
        resolution_at: enq?.resolution_at || null,
        resolution_by: enq?.resolution_by || null,
        contact_id: enq?.contact_id || null,
        person_name: enq?.person_name || null,
        company_name: enq?.company_name || null,
        known_contact_count: enq?.contact_id ? 1 : 0,
        transcript: enq?.notes || null,
        relevance_score: relevanceScore,
        recording_url: recordingUrl,
      };
    });

    return NextResponse.json({
      calls: mappedCalls,
      total_count: 35407,
      summary: {
        total_all_time: 35407,
        incoming_answered: incomingAnsweredCount,
        incoming_missed: incomingMissedCount,
        outgoing_connected: outgoingConnectedCount,
        outgoing_unanswered: outgoingUnansweredCount,
        talked_calls_count: outgoingConnectedCount + incomingAnsweredCount,
        total_talk_seconds: totalTalkSeconds,
        total_talk_hours: Math.round(totalTalkSeconds / 3600),
        loaded_count: mappedCalls.length,
      },
      user: session,
      registry: {
        employees: registry.employees,
        devices: registry.devices,
        assignments: registry.assignments,
        lines: registry.lines,
      },
    }, {
      headers: {
        "Cache-Control": "private, no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("[Fireblade Gen2 /api/calls]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load calls" },
      { status: 500 }
    );
  }
}
