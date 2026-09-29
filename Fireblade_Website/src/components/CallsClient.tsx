"use client";

import { useEffect, useMemo, useState } from "react";
import type { IncomingCall, SessionUser, TeamRegistry } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";
import EnquiryModal from "@/components/EnquiryModal";
import EmployeeAvatar from "@/components/EmployeeAvatar";

const EMPTY_REGISTRY: TeamRegistry = { employees: [], devices: [], assignments: [], lines: [] };

export default function CallsClient({ user }: { user: SessionUser }) {
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [registry, setRegistry] = useState<TeamRegistry>(EMPTY_REGISTRY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [callType, setCallType] = useState("ALL");
  const [employeeId, setEmployeeId] = useState("ALL");
  const [lineFilter, setLineFilter] = useState("ALL");
  const [selected, setSelected] = useState<IncomingCall | null>(null);
  const [disqualifyingCallId, setDisqualifyingCallId] = useState<number | null>(null);
  const [recoveringCallId, setRecoveringCallId] = useState<number | null>(null);

  const load = async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/calls?limit=5000", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load calls");
      setCalls(data.calls || []);
      setRegistry(data.registry || EMPTY_REGISTRY);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load calls"); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { if (user.role !== "MARKETING") setEmployeeId(new URLSearchParams(window.location.search).get("employee") || "ALL"); void load(true); const t = setInterval(() => { if (!document.hidden) void load(false); }, 30000); return () => clearInterval(t); }, [user.role]);

  const isDisqualified = (call: IncomingCall) => call.resolution_outcome === "DISQUALIFIED" || (call.product_name === "Disqualified" && !call.contact_id);
  const isRecovered = (call: IncomingCall) => call.resolution_outcome === "RECOVERED";
  const hasHandledDetails = (call: IncomingCall) => Boolean(call.enquiry_id) && !isRecovered(call);

  const markDisqualified = async (call: IncomingCall) => {
    if (user.role !== "MARKETING" || hasHandledDetails(call) || disqualifyingCallId !== null || recoveringCallId !== null) return;
    const customer = call.phone_number_normalized || call.phone_number_raw || "this customer";
    if (!window.confirm(`Mark ${customer} as Disqualified? This will count as handled and remove it from pending details.`)) return;

    setDisqualifyingCallId(call.call_id);
    setError("");
    try {
      const response = await fetch("/api/enquiries/disqualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: call.call_id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not mark call as disqualified");
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark call as disqualified");
    } finally {
      setDisqualifyingCallId(null);
    }
  };

  const recoverDisqualified = async (call: IncomingCall) => {
    if (user.role !== "MARKETING" || !isDisqualified(call) || recoveringCallId !== null || disqualifyingCallId !== null) return;
    const customer = call.phone_number_normalized || call.phone_number_raw || "this customer";
    if (!window.confirm(`Recover ${customer} and return this call to Pending so customer details can be entered?`)) return;

    setRecoveringCallId(call.call_id);
    setError("");
    try {
      const response = await fetch("/api/enquiries/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: call.call_id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not recover disqualified call");
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not recover disqualified call");
    } finally {
      setRecoveringCallId(null);
    }
  };

  const employees = useMemo(
    () => registry.employees.filter(e => e.active).sort((a,b) => a.employee_name.localeCompare(b.employee_name)),
    [registry.employees]
  );

  const activeAssignments = useMemo(
    () => registry.assignments.filter(a => !a.assigned_until),
    [registry.assignments]
  );

  const selectedEmployee = useMemo(
    () => employees.find(e => e.employee_id === employeeId) || null,
    [employees, employeeId]
  );

  const assignedDeviceIds = useMemo(() => {
    if (employeeId === "ALL") return new Set(activeAssignments.map(a => a.device_id));
    return new Set(activeAssignments.filter(a => a.employee_id === employeeId).map(a => a.device_id));
  }, [activeAssignments, employeeId]);

  const lineOptions = useMemo(() => {
    const devices = registry.devices.filter(d => d.active && (employeeId === "ALL" || assignedDeviceIds.has(d.device_id)));
    const options: Array<{ value: string; label: string; deviceId: string; lineId: number | null }> = [];

    devices.forEach(device => {
      const lines = registry.lines
        .filter(l => l.active && l.device_id === device.device_id)
        .sort((a,b) => (a.sim_slot_index ?? 99) - (b.sim_slot_index ?? 99));
      if (lines.length === 0) {
        options.push({ value: `DEVICE:${device.device_id}`, label: device.company_phone_number ? `${device.company_phone_number} · ${device.device_id}` : device.device_id, deviceId: device.device_id, lineId: null });
      } else {
        lines.forEach(line => {
          const sim = line.sim_slot_index === 1 ? "SIM 2" : "SIM 1";
          options.push({
            value: `LINE:${line.id}`,
            label: `${line.phone_number} · ${device.device_id} · ${sim}`,
            deviceId: device.device_id,
            lineId: line.id,
          });
        });
      }
    });
    return options.sort((a,b) => a.label.localeCompare(b.label));
  }, [registry.devices, registry.lines, employeeId, assignedDeviceIds]);

  useEffect(() => {
    if (lineFilter !== "ALL" && !lineOptions.some(o => o.value === lineFilter)) setLineFilter("ALL");
  }, [lineOptions, lineFilter]);

  const callBelongsToEmployee = (call: IncomingCall) => {
    if (employeeId === "ALL") return true;
    if (call.registered_employee_id === employeeId) return true;
    // Fallback for historical rows that predate the registry assignment. The registry remains
    // authoritative; this fallback only applies when the call has no resolved employee yet.
    return !call.registered_employee_id && assignedDeviceIds.has(call.device_id) &&
      (!!selectedEmployee && (call.received_by || call.collector_employee || "").trim().toLowerCase() === selectedEmployee.employee_name.trim().toLowerCase());
  };

  const callBelongsToLine = (call: IncomingCall) => {
    if (lineFilter === "ALL") return true;
    const option = lineOptions.find(o => o.value === lineFilter);
    if (!option) return false;
    if (call.device_id !== option.deviceId) return false;
    if (option.lineId == null) return true;
    if (call.resolved_line_id === option.lineId) return true;
    // If a device has exactly one active line, older rows without SIM metadata belong to it.
    const deviceLines = registry.lines.filter(l => l.active && l.device_id === option.deviceId);
    return call.resolved_line_id == null && deviceLines.length === 1;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      const businessStatus = hasHandledDetails(c) ? "COMPLETED" : "PENDING";
      if (!callBelongsToEmployee(c)) return false;
      if (!callBelongsToLine(c)) return false;
      if (status !== "ALL" && businessStatus !== status) return false;
      if (callType !== "ALL" && c.direction !== callType) return false;
      if (!q) return true;
      return [
        c.phone_number_normalized, c.phone_number_raw, c.person_name, c.company_name,
        c.product_name, c.requirement_details, c.received_by, c.company_phone_number,
        c.device_id, c.resolved_line_label, c.resolved_line_carrier,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, search, status, callType, employeeId, lineFilter, assignedDeviceIds, selectedEmployee, lineOptions, registry.lines]);

  const pendingInFiltered = filtered.filter(c => !hasHandledDetails(c)).length;
  const exportQuery = new URLSearchParams();
  if (employeeId !== "ALL") exportQuery.set("employeeId", employeeId);
  if (lineFilter !== "ALL") exportQuery.set("lineFilter", lineFilter);
  const exportSuffix = exportQuery.toString() ? `&${exportQuery.toString()}` : "";

  const companyLineText = (call: IncomingCall) => {
    if (call.company_phone_number) {
      const sim = call.resolved_sim_slot_index === 1 ? "SIM 2" : call.resolved_sim_slot_index === 0 ? "SIM 1" : "";
      return [call.company_phone_number, sim].filter(Boolean).join(" · ");
    }
    const deviceLines = registry.lines.filter(l => l.active && l.device_id === call.device_id);
    if (deviceLines.length > 1) return "Multiple SIMs · line unknown";
    return call.phone_label || call.device_id;
  };

  return (
    <>
      <div className="page-header">
        <div><p className="eyebrow">Incoming activity</p><h1>{user.role === "MARKETING" ? "My Calls" : "Calls Dashboard"}</h1></div>
        <div className="header-actions">
          <a className="secondary-button" href={`/api/export?format=csv${exportSuffix}`}>Export CSV</a>
          <a className="primary-button" href={`/api/export?format=xlsx${exportSuffix}`}>Export Excel</a>
        </div>
      </div>

      <div className="health-summary-grid">{[["Calls in view", filtered.length],["Answered", filtered.filter(c=>c.direction==="INCOMING_ANSWERED").length],["Missed", filtered.filter(c=>c.direction==="INCOMING_MISSED").length],["Details pending", pendingInFiltered]].map(([k,n])=><div className="stat-card" key={k}><span>{k}</span><strong>{loading?"—":n}</strong></div>)}</div>
      <div className="filter-bar filter-bar-wide">
        <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, person, company or product..." />
        {user.role !== "MARKETING" && <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setLineFilter("ALL"); }}>
          <option value="ALL">All employees</option>
          {employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.employee_name} · {e.employee_id}</option>)}
        </select>}
        <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
          <option value="ALL">{employeeId === "ALL" ? "All Phones / SIMs" : "All Employee Phones / SIMs"}</option>
          {lineOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All details</option><option value="PENDING">Pending</option><option value="COMPLETED">Completed</option></select>
        <select value={callType} onChange={(e) => setCallType(e.target.value)}><option value="ALL">All incoming</option><option value="INCOMING_ANSWERED">Answered</option><option value="INCOMING_MISSED">Missed</option></select>
        <button className="secondary-button" disabled={refreshing} onClick={() => void load(false)}>{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div className="table-card">
        {error && <div className="error-banner table-error">{error}</div>}
        <div className="table-meta"><span>{filtered.length} calls shown</span><span>{pendingInFiltered} details pending</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date / Time</th><th>Customer Number</th><th>Received By</th><th>Company Line</th><th>Call</th><th>Duration</th><th>Person</th><th>Product / Requirement</th><th>Details</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="empty-state">Loading incoming calls...</td></tr> : filtered.length === 0 ? <tr><td colSpan={9} className="empty-state">No calls match these filters.</td></tr> : filtered.map((call) => (
                <tr key={call.call_id}>
                  <td><strong>{formatIST(call.started_at_epoch_ms)}</strong><small>{call.device_id}</small></td>
                  <td><strong className="phone">{call.phone_number_normalized || call.phone_number_raw || "Unknown"}</strong>{call.known_contact_count > 0 && !hasHandledDetails(call) && <small>{call.known_contact_count} known contact{call.known_contact_count > 1 ? "s" : ""}</small>}</td>
                  <td>{call.received_by ? (() => { const emp = registry.employees.find(e => e.employee_id === call.registered_employee_id); return <div className="employee-inline"><EmployeeAvatar employeeId={call.registered_employee_id} employeeName={call.received_by} photoUpdatedAt={emp?.profile_photo_updated_at} size="xs"/><div><strong>{call.received_by}</strong><small>{call.registered_employee_id || call.collector_employee || ""}</small></div></div>; })() : <><span className="muted">Unassigned</span><small>{call.device_id}</small></>}</td>
                  <td><strong className="phone">{companyLineText(call)}</strong><small>{call.device_id}{call.line_resolution === "MULTI_SIM_UNKNOWN" ? " · SIM not identified" : ""}</small></td>
                  <td><span className={`status-pill ${call.direction === "INCOMING_ANSWERED" ? "success" : "warning"}`}>{cleanStatus(call.direction).replace("Incoming ", "")}</span></td>
                  <td>{formatDuration(call.duration_seconds)}</td>
                  <td>{call.person_name ? <><strong>{call.person_name}</strong><small>{call.company_name || ""}</small></> : <span className="muted">Not entered</span>}</td>
                  <td>{call.product_name ? <><strong>{call.product_name}</strong>{call.updated_by && <small>Updated by {call.updated_by}</small>}</> : <span className="muted">Not entered</span>}</td>
                  <td>
                    <div className="call-actions">
                      {isDisqualified(call)
                        ? <span className="status-pill warning">Disqualified</span>
                        : hasHandledDetails(call) && user.role === "MANAGEMENT"
                          ? <span className="status-pill success">Completed</span>
                          : hasHandledDetails(call)
                            ? <button className="mini-button done" onClick={() => setSelected(call)}>Completed · Edit</button>
                            : user.role === "MANAGEMENT"
                              ? <span className="status-pill neutral">Pending</span>
                              : <button className="mini-button" onClick={() => setSelected(call)}>Add Details</button>}
                      {user.role === "MARKETING" && isDisqualified(call) && (
                        <button
                          className="mini-button"
                          disabled={recoveringCallId !== null || disqualifyingCallId !== null}
                          onClick={() => void recoverDisqualified(call)}
                        >
                          {recoveringCallId === call.call_id ? "Recovering…" : "Recover"}
                        </button>
                      )}
                      {user.role === "MARKETING" && !hasHandledDetails(call) && !isDisqualified(call) && (
                        <button
                          className="mini-button disqualify"
                          disabled={disqualifyingCallId !== null || recoveringCallId !== null}
                          onClick={() => void markDisqualified(call)}
                        >
                          {disqualifyingCallId === call.call_id ? "Saving…" : "Disqualified"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selected && user.role !== "MANAGEMENT" && <EnquiryModal call={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void load(false); }} />}
    </>
  );
}
