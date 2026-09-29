"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceAssignment, FirebladeDevice, FirebladeDeviceLine, FirebladeEmployee } from "@/lib/types";
import EmployeeAvatar from "@/components/EmployeeAvatar";

type RegistryResponse = {
  employees: FirebladeEmployee[];
  devices: FirebladeDevice[];
  assignments: DeviceAssignment[];
  lines: FirebladeDeviceLine[];
};

const emptyForm = {
  employeeId: "",
  employeeName: "",
  deviceId: "",
  sim1PhoneNumber: "",
  sim2PhoneNumber: "",
  deviceName: "",
  phoneLabel: "",
  sim1Carrier: "",
  sim2Carrier: "",
};

export default function AdminTeamClient() {
  const [data, setData] = useState<RegistryResponse>({ employees: [], devices: [], assignments: [], lines: [] });
  const [form, setForm] = useState(emptyForm);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/team", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load registry");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load registry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const activeAssignments = useMemo(() => data.assignments.filter(a => !a.assigned_until), [data.assignments]);
  const currentEmployee = useMemo(
    () => data.employees.find(e => e.employee_id === form.employeeId.trim().toUpperCase()) || null,
    [data.employees, form.employeeId],
  );

  const rows = useMemo(() => {
    return activeAssignments.map(a => {
      const employee = data.employees.find(e => e.employee_id === a.employee_id);
      const device = data.devices.find(d => d.device_id === a.device_id);
      const lines = data.lines
        .filter(l => l.device_id === a.device_id && l.active)
        .sort((x, y) => (x.sim_slot_index ?? 99) - (y.sim_slot_index ?? 99));
      return { assignment: a, employee, device, lines };
    }).sort((a, b) =>
      (a.employee?.employee_name || a.assignment.employee_id)
        .localeCompare(b.employee?.employee_name || b.assignment.employee_id)
    );
  }, [activeAssignments, data.employees, data.devices, data.lines]);

  const inventory = useMemo(() => {
    return [...data.devices].sort((a, b) => a.device_id.localeCompare(b.device_id)).map(device => {
      const assignment = activeAssignments.find(a => a.device_id === device.device_id) || null;
      const employee = assignment ? data.employees.find(e => e.employee_id === assignment.employee_id) || null : null;
      const lines = data.lines
        .filter(l => l.device_id === device.device_id)
        .sort((x, y) => (x.sim_slot_index ?? 99) - (y.sim_slot_index ?? 99));
      return { device, assignment, employee, lines };
    });
  }, [data.devices, data.employees, data.lines, activeAssignments]);

  const clearPhotoInput = () => {
    setPhotoFile(null);
    setPhotoKey(k => k + 1);
  };

  const clearAll = () => {
    setForm(emptyForm);
    setEditingDeviceId(null);
    clearPhotoInput();
    setError("");
    setSuccess("");
  };

  const lineAt = (deviceId: string, slot: number) => {
    const all = data.lines.filter(l => l.device_id === deviceId && l.sim_slot_index === slot);
    return all.find(l => l.active) || all[0];
  };

  const loadDevice = (device: FirebladeDevice, employee?: FirebladeEmployee | null) => {
    const sim1 = lineAt(device.device_id, 0);
    const sim2 = lineAt(device.device_id, 1);
    setForm({
      employeeId: employee?.employee_id || "",
      employeeName: employee?.employee_name || "",
      deviceId: device.device_id,
      sim1PhoneNumber: sim1?.phone_number || device.company_phone_number || "",
      sim2PhoneNumber: sim2?.phone_number || "",
      deviceName: device.device_name || "",
      phoneLabel: device.phone_label || "",
      sim1Carrier: sim1?.carrier_name || "",
      sim2Carrier: sim2?.carrier_name || "",
    });
    setEditingDeviceId(device.device_id);
    clearPhotoInput();
    setSuccess("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const editRow = (employee: FirebladeEmployee | undefined, device: FirebladeDevice | undefined) => {
    if (!employee || !device) return;
    loadDevice(device, employee);
  };

  const chooseEmployee = (employeeId: string) => {
    if (!employeeId) {
      clearAll();
      return;
    }

    const employee = data.employees.find(e => e.employee_id === employeeId);
    if (!employee) return;

    const employeeAssignments = activeAssignments.filter(a => a.employee_id === employeeId);
    if (employeeAssignments.length === 1) {
      const device = data.devices.find(d => d.device_id === employeeAssignments[0].device_id);
      if (device) {
        loadDevice(device, employee);
        return;
      }
    }

    setForm({
      ...emptyForm,
      employeeId: employee.employee_id,
      employeeName: employee.employee_name,
    });
    setEditingDeviceId(null);
    clearPhotoInput();
    setError("");
    setSuccess(employeeAssignments.length > 1 ? "Employee has multiple active devices. Choose Edit on the device you want to change, or Add Another Device." : "");
  };

  const addAnotherDevice = () => {
    if (!form.employeeId || !form.employeeName) return;
    setForm({
      ...emptyForm,
      employeeId: form.employeeId,
      employeeName: form.employeeName,
    });
    setEditingDeviceId(null);
    clearPhotoInput();
    setError("");
    setSuccess("Ready to add another device. Existing device assignments will remain unchanged.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const uploadPhoto = async (employeeId: string, file: File) => {
    const sign = await fetch("/api/employee-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sign_upload",
        employee_id: employeeId,
        filename: file.name,
        content_type: file.type,
        size: file.size,
      }),
    });
    const sj = await sign.json();
    if (!sign.ok) throw new Error(sj.error || "Could not prepare employee photo upload");

    const formData = new FormData();
    formData.append("cacheControl", "3600");
    formData.append("", file);
    const up = await fetch(sj.upload_url, { method: "PUT", headers: { "x-upsert": "false" }, body: formData });
    if (!up.ok) throw new Error(`Employee photo upload failed (${up.status})`);

    const final = await fetch("/api/employee-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finalize_upload", employee_id: employeeId, object_path: sj.object_path }),
    });
    const fj = await final.json();
    if (!final.ok) throw new Error(fj.error || "Could not finalize employee photo");
  };

  const removePhoto = async () => {
    if (!currentEmployee) return;
    setPhotoBusy(true);
    setError("");
    setSuccess("");
    try {
      const r = await fetch("/api/employee-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", employee_id: currentEmployee.employee_id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not remove employee photo");
      setSuccess("Employee profile photo removed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove employee photo");
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    setError("");
    setSuccess("");

    if (!form.employeeId.trim() || !form.employeeName.trim()) {
      setError("Employee ID and Employee Name are mandatory. Device and SIM details can be left blank when needed.");
      return;
    }
    if (editingDeviceId && form.deviceId.trim().toUpperCase() !== editingDeviceId) {
      setError("Existing Device ID cannot be renamed because it is part of call history. Use Add Another Device instead.");
      return;
    }

    setSaving(true);
    try {
      const employeeId = form.employeeId.trim().toUpperCase();
      const r = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SAVE", ...form }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save employee/device configuration");

      if (photoFile) await uploadPhoto(employeeId, photoFile);

      const what = form.deviceId.trim() ? "Employee, device and SIM configuration" : "Employee profile";
      setSuccess(photoFile ? `${what} and profile photo saved.` : `${what} saved.`);
      setForm(emptyForm);
      setEditingDeviceId(null);
      clearPhotoInput();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save employee/device configuration");
    } finally {
      setSaving(false);
    }
  };

  const deviceAction = async (action: "UNASSIGN_DEVICE" | "RETIRE_DEVICE" | "REACTIVATE_DEVICE", deviceId: string) => {
    const question =
      action === "RETIRE_DEVICE"
        ? `Retire ${deviceId}? Current assignment and active SIM configuration will be disabled. Call history is not deleted.`
        : action === "UNASSIGN_DEVICE"
          ? `Unassign ${deviceId} from its employee? The device stays available for future reassignment.`
          : "";
    if (question && !window.confirm(question)) return;

    setDeviceBusy(`${action}:${deviceId}`);
    setError("");
    setSuccess("");
    try {
      const r = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deviceId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Device action failed");

      setSuccess(
        action === "RETIRE_DEVICE"
          ? `${deviceId} retired. History remains available.`
          : action === "UNASSIGN_DEVICE"
            ? `${deviceId} is now unassigned and can be assigned again later.`
            : `${deviceId} reactivated. Assign it to an employee and confirm the SIM details before use.`,
      );
      if (editingDeviceId === deviceId) {
        setForm(emptyForm);
        setEditingDeviceId(null);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Device action failed");
    } finally {
      setDeviceBusy("");
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Employees & Devices</h1>
          <p>Admin is authoritative for employee identity, current devices and company SIM assignments.</p>
        </div>
      </div>

      <section className="panel admin-form-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Full control</p>
            <h2>Employee, Device & SIM Configuration</h2>
          </div>
        </div>

        <div className="admin-control-strip">
          <label>
            <span>Choose Existing Employee</span>
            <select value={currentEmployee?.employee_id || ""} onChange={e => chooseEmployee(e.target.value)}>
              <option value="">New employee / choose employee</option>
              {data.employees.map(employee => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.employee_name} - {employee.employee_id}{employee.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={clearAll}>New Employee</button>
          <button type="button" className="secondary-button" disabled={!form.employeeId || !form.employeeName} onClick={addAnotherDevice}>
            Add Another Device
          </button>
        </div>

        <div className="employee-photo-editor">
          <EmployeeAvatar
            employeeId={currentEmployee?.employee_id || form.employeeId || null}
            employeeName={form.employeeName || currentEmployee?.employee_name || "Employee"}
            photoUpdatedAt={currentEmployee?.profile_photo_updated_at}
            size="xl"
          />
          <div className="employee-photo-controls">
            <strong>Employee Profile Photo</strong>
            <span>Admin-managed. Employee photo is independent from the Management / MD profile photo.</span>
            <input ref={fileRef} key={photoKey} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhotoFile(e.target.files?.[0] || null)} />
            <small>{photoFile ? `Selected: ${photoFile.name}` : "JPEG / PNG / WebP - maximum 5 MB"}</small>
            {currentEmployee?.profile_photo_path && (
              <button type="button" className="text-button danger-text" disabled={photoBusy || saving} onClick={() => void removePhoto()}>
                {photoBusy ? "Removing..." : "Remove current photo"}
              </button>
            )}
          </div>
        </div>

        <div className="form-grid two-col">
          <label>
            <span>Employee ID *</span>
            <input
              value={form.employeeId}
              readOnly={Boolean(currentEmployee)}
              onChange={e => setForm({ ...form, employeeId: e.target.value })}
              placeholder="EMP-001"
            />
            {currentEmployee && <small className="field-help">Employee ID is locked to protect historical ownership.</small>}
          </label>

          <label>
            <span>Employee Name *</span>
            <input value={form.employeeName} onChange={e => setForm({ ...form, employeeName: e.target.value })} placeholder="Gayathri" />
          </label>

          <label>
            <span>Device ID</span>
            <input
              value={form.deviceId}
              readOnly={Boolean(editingDeviceId)}
              onChange={e => setForm({ ...form, deviceId: e.target.value })}
              placeholder="Optional - e.g. MKT-001"
            />
            <small className="field-help">Leave blank to save employee details only. Existing Device IDs are never renamed.</small>
          </label>

          <label>
            <span>Device Name</span>
            <input value={form.deviceName} onChange={e => setForm({ ...form, deviceName: e.target.value })} placeholder="Optional - e.g. Vivo 1820" />
          </label>

          <label>
            <span>Phone Label</span>
            <input value={form.phoneLabel} onChange={e => setForm({ ...form, phoneLabel: e.target.value })} placeholder="Optional - e.g. Main phone" />
          </label>

          <div className="form-spacer" />

          <label>
            <span>SIM 1 Company Number</span>
            <div className="input-action-row">
              <input value={form.sim1PhoneNumber} onChange={e => setForm({ ...form, sim1PhoneNumber: e.target.value })} placeholder="Optional - company SIM 1" />
              <button type="button" className="secondary-button compact-button" disabled={!form.sim1PhoneNumber} onClick={() => setForm({ ...form, sim1PhoneNumber: "", sim1Carrier: "" })}>Clear SIM 1</button>
            </div>
            <small className="field-help">Blank means this device currently has no active SIM 1 assignment in Fireblade.</small>
          </label>

          <label>
            <span>SIM 1 Carrier</span>
            <input value={form.sim1Carrier} onChange={e => setForm({ ...form, sim1Carrier: e.target.value })} placeholder="Optional - Vi / Airtel / Jio" />
          </label>

          <label>
            <span>SIM 2 Company Number</span>
            <div className="input-action-row">
              <input value={form.sim2PhoneNumber} onChange={e => setForm({ ...form, sim2PhoneNumber: e.target.value })} placeholder="Optional - second company SIM" />
              <button type="button" className="secondary-button compact-button" disabled={!form.sim2PhoneNumber} onClick={() => setForm({ ...form, sim2PhoneNumber: "", sim2Carrier: "" })}>Clear SIM 2</button>
            </div>
          </label>

          <label>
            <span>SIM 2 Carrier</span>
            <input value={form.sim2Carrier} onChange={e => setForm({ ...form, sim2Carrier: e.target.value })} placeholder="Optional - Vi / Airtel / Jio" />
          </label>
        </div>

        <div className="admin-safety-note">
          <strong>Current configuration only.</strong>
          <span>Clearing a SIM, unassigning a phone or retiring a device does not delete call records. Multiple devices and dual-SIM phones remain supported for future changes.</span>
        </div>

        {error && <div className="error-banner admin-message">{error}</div>}
        {success && <div className="success-banner admin-message">{success}</div>}

        <div className="modal-actions">
          <button className="secondary-button" disabled={saving} onClick={clearAll}>Clear Form</button>
          <button className="primary-button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving..." : form.deviceId.trim() ? "Save Employee + Device" : "Save Employee"}
          </button>
        </div>
      </section>

      <section className="table-card admin-registry">
        <div className="table-meta">
          <span>{rows.length} active phone assignments</span>
          <span>{data.employees.length} employees - {data.devices.filter(d => d.active).length} active devices - {data.lines.filter(l => l.active).length} active SIM lines</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Employee</th><th>Device ID</th><th>Current SIMs</th><th>Phone / Device</th><th>Assigned From</th><th>Status</th><th>Admin Control</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty-state">Loading team registry...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">No active phone assignments.</td></tr>
              ) : rows.map(({ assignment, employee, device, lines }) => (
                <tr key={assignment.id}>
                  <td>
                    <div className="employee-inline">
                      <EmployeeAvatar employeeId={assignment.employee_id} employeeName={employee?.employee_name || assignment.employee_id} photoUpdatedAt={employee?.profile_photo_updated_at} size="sm" />
                      <div><strong>{employee?.employee_name || assignment.employee_id}</strong><small>{assignment.employee_id}</small></div>
                    </div>
                  </td>
                  <td><strong>{assignment.device_id}</strong></td>
                  <td>
                    {lines.length ? lines.map(line => (
                      <div className="line-stack" key={line.id}>
                        <strong className="phone">{line.phone_number}</strong>
                        <small>{line.sim_slot_index === 1 ? "SIM 2" : "SIM 1"}{line.carrier_name ? ` - ${line.carrier_name}` : ""}</small>
                      </div>
                    )) : <span className="muted">No active SIM configured</span>}
                  </td>
                  <td><strong>{device?.phone_label || device?.device_name || "-"}</strong><small>{device?.phone_label && device?.device_name ? device.device_name : ""}</small></td>
                  <td>{new Date(assignment.assigned_from).toLocaleString("en-IN")}</td>
                  <td><span className="status-pill success">Active</span></td>
                  <td>
                    <div className="admin-action-row">
                      <button className="mini-button" onClick={() => editRow(employee, device)}>Edit</button>
                      <button className="mini-button" disabled={deviceBusy !== ""} onClick={() => void deviceAction("UNASSIGN_DEVICE", assignment.device_id)}>Unassign</button>
                      <button className="mini-button danger-mini" disabled={deviceBusy !== ""} onClick={() => void deviceAction("RETIRE_DEVICE", assignment.device_id)}>Retire</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="table-card admin-registry device-inventory-card">
        <div className="table-meta">
          <span>Device Inventory</span>
          <span>Active, unassigned and retired devices remain visible to Admin.</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Device</th><th>Current Employee</th><th>SIM Records</th><th>Device Status</th><th>Assignment</th><th>Control</th></tr>
            </thead>
            <tbody>
              {inventory.map(({ device, assignment, employee, lines }) => (
                <tr key={device.device_id}>
                  <td><strong>{device.device_id}</strong><small>{device.device_name || device.phone_label || "-"}</small></td>
                  <td>{employee ? <><strong>{employee.employee_name}</strong><small>{employee.employee_id}</small></> : <span className="muted">Unassigned</span>}</td>
                  <td>
                    {lines.length ? lines.map(line => (
                      <div className="line-stack" key={line.id}>
                        <strong className={line.active ? "phone" : "phone muted"}>{line.phone_number}</strong>
                        <small>{line.sim_slot_index === 1 ? "SIM 2" : "SIM 1"} - {line.active ? "active" : "inactive"}</small>
                      </div>
                    )) : <span className="muted">No SIM records</span>}
                  </td>
                  <td><span className={`status-pill ${device.active ? "success" : "neutral"}`}>{device.active ? "Active" : "Retired"}</span></td>
                  <td>{assignment ? <span className="status-pill success">Assigned</span> : <span className="status-pill neutral">Unassigned</span>}</td>
                  <td>
                    <div className="admin-action-row">
                      {device.active && <button className="mini-button" onClick={() => loadDevice(device, employee)}>Edit / Assign</button>}
                      {!device.active && <button className="mini-button" disabled={deviceBusy !== ""} onClick={() => void deviceAction("REACTIVATE_DEVICE", device.device_id)}>Reactivate</button>}
                      {device.active && <button className="mini-button danger-mini" disabled={deviceBusy !== ""} onClick={() => void deviceAction("RETIRE_DEVICE", device.device_id)}>Retire</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !inventory.length && <tr><td colSpan={6} className="empty-state">No devices registered.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}