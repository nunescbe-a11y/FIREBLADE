import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type {
  DeviceAssignment,
  DeviceHealthRecord,
  DeviceHealthView,
  FirebladeDevice,
  FirebladeEmployee,
} from "@/lib/types";

import { deviceStatus, type CheckRecord } from "@/lib/device-status";
import type { FirebladeDeviceLine } from "@/lib/types";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Management or Admin access required" }, { status: 403 });
  }

  try {
    const [employees, devices, assignments, health, departments, checks, lines, exclusions] = await Promise.all([
      supabaseRest<FirebladeEmployee[]>("fireblade_employees?select=*&active=eq.true&order=employee_name.asc"),
      supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&active=eq.true&order=device_id.asc"),
      supabaseRest<DeviceAssignment[]>("fireblade_device_assignments?select=*&assigned_until=is.null&order=assigned_from.desc"),
      supabaseRest<DeviceHealthRecord[]>("fireblade_device_health?select=*&order=device_id.asc"),
      supabaseRest<Array<{id:string;name:string}>>("fireblade_departments?select=id,name"),
      supabaseRest<CheckRecord[]>("fireblade_latest_checks?select=request_id,device_id,requested_at,expires_at,responded_at,status,delivery_status"),
      supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true"),
      supabaseRest<Array<{device_id:string}>>("fireblade_dashboard_device_exclusions?select=device_id&active=eq.true"),
    ]);

    const employeeById = new Map(employees.map(e => [e.employee_id, e]));
    const assignmentByDevice = new Map<string, DeviceAssignment>();
    for (const assignment of assignments) {
      if (!assignmentByDevice.has(assignment.device_id)) assignmentByDevice.set(assignment.device_id, assignment);
    }
    const healthByDevice = new Map(health.map(h => [h.device_id, h]));
    const excludedDeviceIds = new Set(exclusions.map(x => x.device_id));
    const now = Date.now();

    // Device Health is an operational screen: show only active phones that are
    // currently assigned to an active employee and are not retired/excluded.
    const visibleDevices = devices.filter(device => {
      const assignment = assignmentByDevice.get(device.device_id);
      if (!assignment) return false;
      if (!employeeById.has(assignment.employee_id)) return false;
      if (excludedDeviceIds.has(device.device_id)) return false;
      return true;
    });

    const rows: DeviceHealthView[] = visibleDevices.map(device => {
      const assignment = assignmentByDevice.get(device.device_id);
      const employee = assignment ? employeeById.get(assignment.employee_id) : undefined;
      const h = healthByDevice.get(device.device_id) || null;
      const check = checks.find(c => c.device_id === device.device_id) || null;
      const status = deviceStatus(h, check, now);
      return {
        device_id: device.device_id,
        employee_id: assignment?.employee_id || null,
        employee_name: employee?.employee_name || h?.employee_name || null,
        profile_photo_updated_at: employee?.profile_photo_updated_at || null,
        company_phone_number: device.company_phone_number,
        device_name: device.device_name,
        phone_label: device.phone_label,
        ...status,
        // "Internet turned off" is deliberately strict: the phone itself must
        // still have fresh verified evidence, while both Wi-Fi and cellular are
        // disconnected and Android reports no validated internet. Unknown radio
        // states are not classified as internet-off.
        internet_disconnected: status.state === "ON CONFIRMED" &&
          h?.source_verified === true &&
          h.internet_available === false &&
          h.wifi_connected === false &&
          h.cellular_connected === false,
        department_id: employee?.department_id || null,
        department_name: departments.find(d => d.id === employee?.department_id)?.name || "Unassigned",
        device_model: h?.device_model || device.device_name,
        apk_version: h?.apk_version || null,
        lines: lines.filter(l => l.device_id === device.device_id),
        check,
        last_seen: h?.received_at || h?.heartbeat_at || null,
        ...(session.role === "ADMIN" ? { details: h } : {}),
      };
    });

    return NextResponse.json({
      devices: rows,
      generated_at: new Date(now).toISOString(),
      thresholds: { recent_signal_minutes: 12, shutdown_persists_until_verified_signal: true },
      admin_details: session.role === "ADMIN",
    });
  } catch (error) {
    console.error("[Fireblade /api/device-health]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load device health" },
      { status: 500 }
    );
  }
}
