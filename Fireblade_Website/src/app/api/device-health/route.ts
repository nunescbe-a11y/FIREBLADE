import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type {
  DeviceAssignment,
  DeviceHealthRecord,
  DeviceHealthView,
  DeviceUpdateInfo,
  FirebladeDevice,
  FirebladeEmployee,
} from "@/lib/types";

import { deviceStatus, type CheckRecord } from "@/lib/device-status";
import type { FirebladeDeviceLine } from "@/lib/types";

type AppReleaseRow = {
  id: string;
  version_name: string;
  version_code: number;
  status: string;
  target_device_id: string | null;
};

type UpdateStatusRow = {
  device_id: string;
  stage: string;
  app_version_code: number;
  release_id: string;
  last_checked_at: string;
  message: string;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Management or Admin access required" }, { status: 403 });
  }

  try {
    const [employees, devices, assignments, health, departments, checks, lines, exclusions, releases, updates] = await Promise.all([
      supabaseRest<FirebladeEmployee[]>("fireblade_employees?select=*&active=eq.true&order=employee_name.asc"),
      supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&active=eq.true&order=device_id.asc"),
      supabaseRest<DeviceAssignment[]>("fireblade_device_assignments?select=*&assigned_until=is.null&order=assigned_from.desc"),
      supabaseRest<DeviceHealthRecord[]>("fireblade_device_health?select=*&order=device_id.asc"),
      supabaseRest<Array<{id:string;name:string}>>("fireblade_departments?select=id,name"),
      supabaseRest<CheckRecord[]>("fireblade_latest_checks?select=request_id,device_id,requested_at,expires_at,responded_at,status,delivery_status"),
      supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&active=eq.true"),
      supabaseRest<Array<{device_id:string}>>("fireblade_dashboard_device_exclusions?select=device_id&active=eq.true"),
      supabaseRest<AppReleaseRow[]>("fireblade_app_releases?status=eq.PUBLISHED&order=version_code.desc"),
      supabaseRest<UpdateStatusRow[]>("fireblade_update_status?select=*"),
    ]);

    const employeeById = new Map(employees.map(e => [e.employee_id, e]));
    const assignmentByDevice = new Map<string, DeviceAssignment>();
    for (const assignment of assignments) {
      if (!assignmentByDevice.has(assignment.device_id)) assignmentByDevice.set(assignment.device_id, assignment);
    }
    const healthByDevice = new Map(health.map(h => [h.device_id, h]));
    const excludedDeviceIds = new Set(exclusions.map(x => x.device_id));
    const now = Date.now();

    // Operational visibility: show all active company devices not explicitly excluded.
    // Unassigned phones appear as "Unassigned" so administrators and managers can
    // immediately diagnose whether a phone is online, turned off, or not syncing.
    const visibleDevices = devices.filter(device => !excludedDeviceIds.has(device.device_id));

    const rows: DeviceHealthView[] = visibleDevices.map(device => {
      const assignment = assignmentByDevice.get(device.device_id);
      const employee = assignment ? employeeById.get(assignment.employee_id) : undefined;
      const h = healthByDevice.get(device.device_id) || null;
      const check = checks.find(c => c.device_id === device.device_id) || null;
      const status = deviceStatus(h, check, now);

      // Compute exact application update capability and stage
      const updateRecord = updates.find(u => u.device_id === device.device_id);
      const applicable = releases.find(r => !r.target_device_id || r.target_device_id === device.device_id);

      const installedCode = h?.app_version_code ?? null;
      const installedVersion = h?.apk_version || null;
      const targetCode = applicable?.version_code ?? null;
      const targetVersion = applicable?.version_name || null;

      let stage: DeviceUpdateInfo["stage"] = "UNKNOWN";
      let canUpdate = false;
      let message = updateRecord?.message || null;

      if (!h || !installedVersion) {
        stage = "NOT_INSTALLED";
      } else if (applicable && installedCode != null && installedCode >= applicable.version_code) {
        stage = "CURRENT";
      } else if (updateRecord?.message?.toLowerCase().includes("signing key")) {
        stage = "FAILED";
        message = "Key mismatch · Clean APK install needed";
      } else if (updateRecord?.stage === "AWAITING_INSTALL") {
        stage = "AWAITING_INSTALL";
        canUpdate = true;
        message = "Downloaded · Ready to install on device";
      } else if (updateRecord?.stage === "DOWNLOADING") {
        stage = "DOWNLOADING";
        canUpdate = true;
        message = "Downloading update package";
      } else if (applicable && installedCode != null && applicable.version_code > installedCode) {
        stage = "AVAILABLE";
        canUpdate = true;
        message = `Update available (v${applicable.version_name})`;
      } else if (applicable && !installedCode) {
        stage = "AVAILABLE";
        canUpdate = true;
        message = `Update available (v${applicable.version_name})`;
      } else {
        stage = "CURRENT";
      }

      const update_info: DeviceUpdateInfo = {
        stage,
        can_update: canUpdate,
        installed_version: installedVersion,
        installed_code: installedCode,
        target_version: targetVersion,
        target_code: targetCode,
        message,
        last_checked_at: updateRecord?.last_checked_at || null,
      };

      return {
        device_id: device.device_id,
        employee_id: assignment?.employee_id || null,
        employee_name: employee?.employee_name || h?.employee_name || "Unassigned",
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
        department_name: employee ? (departments.find(d => d.id === employee.department_id)?.name || "Unassigned") : "Unassigned",
        device_model: h?.device_model || device.device_name || "Unknown Model",
        apk_version: h?.apk_version || null,
        lines: lines.filter(l => l.device_id === device.device_id),
        check,
        last_seen: h?.received_at || h?.heartbeat_at || null,
        details: h,
        update_info,
      };
    });

    const summary = {
      total: rows.length,
      working: rows.filter(r => r.phone_working === "YES").length,
      up_to_date: rows.filter(r => r.update_info?.stage === "CURRENT").length,
      can_update: rows.filter(r => r.update_info?.can_update).length,
      needs_attention: rows.filter(r => r.update_info?.stage === "FAILED" || r.update_info?.stage === "NOT_INSTALLED").length,
    };

    return NextResponse.json({
      devices: rows,
      summary,
      generated_at: new Date(now).toISOString(),
      thresholds: { recent_signal_minutes: 12, shutdown_persists_until_verified_signal: true },
      admin_details: true,
    });
  } catch (error) {
    console.error("[Fireblade /api/device-health]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load device health" },
      { status: 500 }
    );
  }
}
