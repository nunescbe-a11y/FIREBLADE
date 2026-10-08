import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

export type HandoverEvent = {
  event_id: string;
  detail_id: string;
  assigned_to_employee_id: string;
  event_type: string;
  occurred_at_epoch_ms: number;
  recorded_at: string;
  whatsapp_recipient_number: string | null;
  form_snapshot: Record<string, unknown>;
};

export type HandoverCallDetail = {
  id: string;
  detail_id: string;
  call_id: number | null;
  source_call_id: string | null;
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
  client_updated_at_epoch_ms: number;
  created_at: string;
  updated_at: string;
};

export type HandoverEmployee = {
  employee_id: string;
  employee_name: string;
  department_name: string;
  profile_photo_path: string | null;
  profile_photo_updated_at: string | null;
  active: boolean;
  assignments_count: number;
  assignments: Array<{
    event_id: string;
    assigned_to_employee_id: string;
    event_type: string;
    occurred_at_epoch_ms: number;
    recorded_at: string;
    whatsapp_recipient_number: string | null;
    form_snapshot: Record<string, unknown>;
    call_detail: HandoverCallDetail;
  }>;
};

export type HandoverResponse = {
  marketing_employees: HandoverEmployee[];
  service_employees: HandoverEmployee[];
};

type DepartmentRow = {
  id: string;
  name: string;
  active: boolean;
};

type EmployeeRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  department_id: string;
  active: boolean;
  profile_photo_path: string | null;
  profile_photo_updated_at: string | null;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Admin or Management access required" }, { status: 403 });
  }

  try {
    const [departments, employees, assignmentEvents, callDetails] = await Promise.all([
      supabaseRest<DepartmentRow[]>("fireblade_departments?select=id,name,active&active=eq.true"),
      supabaseRest<EmployeeRow[]>("fireblade_employees?select=id,employee_id,employee_name,department_id,active,profile_photo_path,profile_photo_updated_at&active=eq.true&order=employee_name.asc"),
      supabaseRest<HandoverEvent[]>("fireblade_shane_assignment_events?select=*&order=occurred_at_epoch_ms.desc"),
      supabaseRest<HandoverCallDetail[]>("fireblade_shane_call_details?select=*&order=call_started_at_epoch_ms.desc"),
    ]);

    const deptMap = new Map((departments || []).map((d) => [d.id, d.name.trim().toUpperCase()]));
    const detailsMap = new Map((callDetails || []).map((d) => [d.detail_id, d]));

    // Group events by target employee
    const eventsByEmployee = new Map<string, Array<{ event: HandoverEvent; detail: HandoverCallDetail }>>();
    for (const evt of assignmentEvents || []) {
      const targetEmp = (evt.assigned_to_employee_id || "").trim();
      const detail = detailsMap.get(evt.detail_id);
      if (!targetEmp || !detail) continue;

      if (!eventsByEmployee.has(targetEmp)) {
        eventsByEmployee.set(targetEmp, []);
      }
      eventsByEmployee.get(targetEmp)!.push({ event: evt, detail });
    }

    const marketingEmployees: HandoverEmployee[] = [];
    const serviceEmployees: HandoverEmployee[] = [];

    for (const emp of employees || []) {
      const deptName = deptMap.get(emp.department_id) || "";
      const isMarketing = deptName === "MARKETING";
      const isAlagupriya = emp.employee_id === "EMP-008" && (deptName === "SERVICE" || emp.employee_name.toUpperCase().includes("ALAGUPRIYA"));

      if (!isMarketing && !isAlagupriya) continue;

      const empEvents = eventsByEmployee.get(emp.employee_id) || [];
      const assignments = empEvents.map(({ event, detail }) => ({
        event_id: event.event_id,
        assigned_to_employee_id: event.assigned_to_employee_id,
        event_type: event.event_type,
        occurred_at_epoch_ms: event.occurred_at_epoch_ms,
        recorded_at: event.recorded_at,
        whatsapp_recipient_number: event.whatsapp_recipient_number,
        form_snapshot: event.form_snapshot || {},
        call_detail: detail,
      }));

      const employeeRecord: HandoverEmployee = {
        employee_id: emp.employee_id,
        employee_name: emp.employee_name,
        department_name: isAlagupriya ? "SERVICE" : "MARKETING",
        profile_photo_path: emp.profile_photo_path,
        profile_photo_updated_at: emp.profile_photo_updated_at,
        active: emp.active,
        assignments_count: assignments.length,
        assignments,
      };

      if (isAlagupriya) {
        serviceEmployees.push(employeeRecord);
      } else {
        marketingEmployees.push(employeeRecord);
      }
    }

    return NextResponse.json({
      marketing_employees: marketingEmployees,
      service_employees: serviceEmployees,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Shane Handover data" },
      { status: 500 }
    );
  }
}
