import { audit } from "@/lib/admin";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { DeviceAssignment, FirebladeDevice, FirebladeDeviceLine, FirebladeEmployee } from "@/lib/types";
import { FIREBLADE_VISIBLE_FROM_EPOCH_MS } from "@/lib/call-window";

function clean(value: unknown) { return String(value ?? "").trim(); }
function normalizeCompanyNumber(value: unknown) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits || raw;
}

async function adminSession() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.role !== "ADMIN") return { response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  return { session };
}

export async function GET() {
  const auth = await adminSession();
  if ("response" in auth) return auth.response;

  try {
    const [employees, devices, assignments, lines] = await Promise.all([
      supabaseRest<FirebladeEmployee[]>("fireblade_employees?select=*&order=employee_name.asc"),
      supabaseRest<FirebladeDevice[]>("fireblade_devices?select=*&order=device_id.asc"),
      supabaseRest<DeviceAssignment[]>("fireblade_device_assignments?select=*&order=assigned_from.desc"),
      supabaseRest<FirebladeDeviceLine[]>("fireblade_device_lines?select=*&order=device_id.asc,sim_slot_index.asc"),
    ]);
    return NextResponse.json({ employees, devices, assignments, lines });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load team registry" }, { status: 500 });
  }
}

async function closeActiveAssignments(deviceId: string, at: string) {
  await supabaseRest(
    `fireblade_device_assignments?device_id=eq.${encodeURIComponent(deviceId)}&assigned_until=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ assigned_until: at }),
    },
  );
}

async function setDeviceLinesActive(deviceId: string, active: boolean) {
  await supabaseRest(`fireblade_device_lines?device_id=eq.${encodeURIComponent(deviceId)}&active=eq.${active ? "false" : "true"}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active, updated_at: new Date().toISOString() }),
  });
}

async function upsertLine(deviceId: string, simSlotIndex: number, phoneNumber: string, carrierName: string) {
  const existing = await supabaseRest<FirebladeDeviceLine[]>(
    `fireblade_device_lines?select=*&device_id=eq.${encodeURIComponent(deviceId)}&sim_slot_index=eq.${simSlotIndex}&limit=1`,
  );

  if (!phoneNumber) {
    if (existing[0]) {
      await supabaseRest(`fireblade_device_lines?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false, carrier_name: carrierName || existing[0].carrier_name || null, updated_at: new Date().toISOString() }),
      });
    }
    return;
  }

  if (existing[0]) {
    await supabaseRest(`fireblade_device_lines?id=eq.${existing[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        phone_number: phoneNumber,
        line_label: simSlotIndex === 0 ? "SIM 1" : "SIM 2",
        carrier_name: carrierName || null,
        active: true,
        updated_at: new Date().toISOString(),
      }),
    });
    return;
  }

  await supabaseRest("fireblade_device_lines", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      device_id: deviceId,
      sim_slot_index: simSlotIndex,
      phone_number: phoneNumber,
      line_label: simSlotIndex === 0 ? "SIM 1" : "SIM 2",
      carrier_name: carrierName || null,
      active: true,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function companyNumberConflict(phone: string, editingDeviceId: string) {
  if (!phone) return null;
  const conflicts = await supabaseRest<FirebladeDeviceLine[]>(
    `fireblade_device_lines?select=*&phone_number=eq.${encodeURIComponent(phone)}&active=eq.true&device_id=neq.${encodeURIComponent(editingDeviceId)}&limit=20`,
  );
  if (!conflicts.length) return null;

  for (const conflict of conflicts) {
    const devices = await supabaseRest<FirebladeDevice[]>(
      `fireblade_devices?select=*&device_id=eq.${encodeURIComponent(conflict.device_id)}&active=eq.true&limit=1`,
    );
    if (devices[0]) return conflict;
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await adminSession();
  if ("response" in auth) return auth.response;
  const session = auth.session;

  const body = await request.json().catch(() => ({}));
  const action = clean(body.action || "SAVE").toUpperCase();
  const deviceId = clean(body.deviceId || body.device_id).toUpperCase();

  try {
    if (action === "UNASSIGN_DEVICE") {
      if (!deviceId) return NextResponse.json({ error: "Device ID is required" }, { status: 400 });
      const now = new Date().toISOString();
      await closeActiveAssignments(deviceId, now);
      await audit(session.username, "DEVICE_UNASSIGNED", deviceId);
      return NextResponse.json({ ok: true });
    }

    if (action === "RETIRE_DEVICE") {
      if (!deviceId) return NextResponse.json({ error: "Device ID is required" }, { status: 400 });
      const now = new Date().toISOString();
      await closeActiveAssignments(deviceId, now);
      await supabaseRest(`fireblade_devices?device_id=eq.${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: false, updated_at: now }),
      });
      await setDeviceLinesActive(deviceId, false);
      await audit(session.username, "DEVICE_RETIRED", deviceId);
      return NextResponse.json({ ok: true });
    }

    if (action === "REACTIVATE_DEVICE") {
      if (!deviceId) return NextResponse.json({ error: "Device ID is required" }, { status: 400 });

      const oldLines = await supabaseRest<FirebladeDeviceLine[]>(
        `fireblade_device_lines?select=*&device_id=eq.${encodeURIComponent(deviceId)}&order=sim_slot_index.asc`,
      );
      for (const line of oldLines) {
        const conflict = await companyNumberConflict(line.phone_number, deviceId);
        if (conflict) {
          return NextResponse.json(
            { error: `Cannot reactivate ${deviceId}: company number ${line.phone_number} is now active on ${conflict.device_id}. Edit the retired device first.` },
            { status: 409 },
          );
        }
      }

      const now = new Date().toISOString();
      await supabaseRest(`fireblade_devices?device_id=eq.${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ active: true, updated_at: now }),
      });
      await audit(session.username, "DEVICE_REACTIVATED", deviceId);
      return NextResponse.json({ ok: true });
    }

    if (action !== "SAVE") {
      return NextResponse.json({ error: "Unknown team action" }, { status: 400 });
    }

    const employeeId = clean(body.employeeId).toUpperCase();
    const employeeName = clean(body.employeeName);
    const sim1PhoneNumber = normalizeCompanyNumber(body.sim1PhoneNumber || body.companyPhoneNumber);
    const sim2PhoneNumber = normalizeCompanyNumber(body.sim2PhoneNumber);
    const deviceName = clean(body.deviceName);
    const phoneLabel = clean(body.phoneLabel);
    const sim1Carrier = clean(body.sim1Carrier);
    const sim2Carrier = clean(body.sim2Carrier);

    if (!employeeId || !employeeName) {
      return NextResponse.json({ error: "Employee ID and Employee Name are mandatory." }, { status: 400 });
    }
    if (sim2PhoneNumber && sim2PhoneNumber === sim1PhoneNumber) {
      return NextResponse.json({ error: "SIM 1 and SIM 2 cannot use the same company phone number." }, { status: 400 });
    }

    const now = new Date().toISOString();

    await supabaseRest("fireblade_employees?on_conflict=employee_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ employee_id: employeeId, employee_name: employeeName, active: true, updated_at: now }),
    });

    // Saving an employee without a device is intentional. This lets Admin keep
    // employee identity current even between phone assignments.
    if (!deviceId) {
      await audit(session.username, "EMPLOYEE_SAVED", employeeId, { employee_name: employeeName });
      return NextResponse.json({ ok: true, employee_only: true });
    }

    for (const phone of [sim1PhoneNumber, sim2PhoneNumber].filter(Boolean)) {
      const conflict = await companyNumberConflict(phone, deviceId);
      if (conflict) {
        return NextResponse.json({ error: `Company number ${phone} is already active on ${conflict.device_id}. Retire or clear that old assignment first.` }, { status: 409 });
      }
    }

    // company_phone_number remains a backwards-compatible SIM-1 mirror.
    await supabaseRest("fireblade_devices?on_conflict=device_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        device_id: deviceId,
        company_phone_number: sim1PhoneNumber || null,
        device_name: deviceName || null,
        phone_label: phoneLabel || null,
        active: true,
        updated_at: now,
      }),
    });

    await upsertLine(deviceId, 0, sim1PhoneNumber, sim1Carrier);
    await upsertLine(deviceId, 1, sim2PhoneNumber, sim2Carrier);

    const active = await supabaseRest<DeviceAssignment[]>(
      `fireblade_device_assignments?select=*&device_id=eq.${encodeURIComponent(deviceId)}&assigned_until=is.null&order=assigned_from.desc&limit=1`,
    );
    const firstCall = await supabaseRest<Array<{ started_at_epoch_ms: number }>>(
      `phase0_calls?select=started_at_epoch_ms&device_id=eq.${encodeURIComponent(deviceId)}&started_at_epoch_ms=gte.${FIREBLADE_VISIBLE_FROM_EPOCH_MS}&order=started_at_epoch_ms.asc&limit=1`,
    );

    const earliestRelevant = firstCall[0]?.started_at_epoch_ms
      ? new Date(Math.max(Number(firstCall[0].started_at_epoch_ms), FIREBLADE_VISIBLE_FROM_EPOCH_MS)).toISOString()
      : now;

    if (active[0]?.employee_id !== employeeId) {
      if (active[0]) {
        await supabaseRest(`fireblade_device_assignments?id=eq.${active[0].id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ assigned_until: now }),
        });
      }
      await supabaseRest("fireblade_device_assignments", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          device_id: deviceId,
          employee_id: employeeId,
          assigned_from: active[0] ? now : earliestRelevant,
          assigned_until: null,
        }),
      });
    } else if (active[0] && new Date(earliestRelevant).getTime() < new Date(active[0].assigned_from).getTime()) {
      const history = await supabaseRest<Array<{ id: number }>>(
        `fireblade_device_assignments?select=id&device_id=eq.${encodeURIComponent(deviceId)}&limit=2`,
      );
      if (history.length === 1) {
        await supabaseRest(`fireblade_device_assignments?id=eq.${active[0].id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ assigned_from: earliestRelevant }),
        });
      }
    }

    await audit(session.username, "REGISTRATION_SAVED", deviceId, {
      employee_id: employeeId,
      previous_employee_id: active[0]?.employee_id || null,
      sim1: sim1PhoneNumber || null,
      sim2: sim2PhoneNumber || null,
      device_name: deviceName,
      phone_label: phoneLabel,
      sim1_carrier: sim1Carrier,
      sim2_carrier: sim2Carrier,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save team registration" }, { status: 500 });
  }
}