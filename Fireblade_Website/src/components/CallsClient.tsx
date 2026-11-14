"use client";

import { useEffect, useMemo, useState } from "react";
import type { IncomingCall, SessionUser, TeamRegistry } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";
import EnquiryModal from "@/components/EnquiryModal";
import EmployeeAvatar from "@/components/EmployeeAvatar";

const EMPTY_REGISTRY: TeamRegistry = { employees: [], devices: [], assignments: [], lines: [] };

type QuickFilterType = "ALL" | "BULK_3" | "BULK_5" | "TODAY" | "LONG" | "PENDING";

export default function CallsClient({ user }: { user: SessionUser }) {
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [registry, setRegistry] = useState<TeamRegistry>(EMPTY_REGISTRY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [callType, setCallType] = useState("ALL");
  const [employeeId, setEmployeeId] = useState("ALL");
  const [lineFilter, setLineFilter] = useState("ALL");
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>("ALL");
  const [selected, setSelected] = useState<IncomingCall | null>(null);
  const [disqualifyingCallId, setDisqualifyingCallId] = useState<number | null>(null);
  const [recoveringCallId, setRecoveringCallId] = useState<number | null>(null);

  // Bulk actions state
  const [selectedCallIds, setSelectedCallIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Smooth pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const load = async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/calls?limit=5000", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load calls");
      setCalls(data.calls || []);
      setRegistry(data.registry || EMPTY_REGISTRY);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calls");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user.role !== "MARKETING") {
      setEmployeeId(new URLSearchParams(window.location.search).get("employee") || "ALL");
    }
    void load(true);
    const t = setInterval(() => {
      if (!document.hidden) void load(false);
    }, 30000);
    return () => clearInterval(t);
  }, [user.role]);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [search, status, callType, employeeId, lineFilter, quickFilter, pageSize]);

  const isDisqualified = (call: IncomingCall) =>
    call.resolution_outcome === "DISQUALIFIED" || (call.product_name === "Disqualified" && !call.contact_id);
  const isRecovered = (call: IncomingCall) => call.resolution_outcome === "RECOVERED";
  const hasHandledDetails = (call: IncomingCall) => Boolean(call.enquiry_id) && !isRecovered(call);

  // Frequency mapping for bulk/repeat call analysis
  const callerFrequency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calls) {
      const num = c.phone_number_normalized || c.phone_number_raw;
      if (num) counts.set(num, (counts.get(num) || 0) + 1);
    }
    return counts;
  }, [calls]);

  const employees = useMemo(
    () => registry.employees.filter(e => e.active).sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
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
        .sort((a, b) => (a.sim_slot_index ?? 99) - (b.sim_slot_index ?? 99));
      if (lines.length === 0) {
        options.push({
          value: `DEVICE:${device.device_id}`,
          label: device.company_phone_number ? `${device.company_phone_number} · ${device.device_id}` : device.device_id,
          deviceId: device.device_id,
          lineId: null,
        });
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
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [registry.devices, registry.lines, employeeId, assignedDeviceIds]);

  useEffect(() => {
    if (lineFilter !== "ALL" && !lineOptions.some(o => o.value === lineFilter)) setLineFilter("ALL");
  }, [lineOptions, lineFilter]);

  const callBelongsToEmployee = (call: IncomingCall) => {
    if (employeeId === "ALL") return true;
    if (call.registered_employee_id === employeeId) return true;
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
    const deviceLines = registry.lines.filter(l => l.active && l.device_id === option.deviceId);
    return call.resolved_line_id == null && deviceLines.length === 1;
  };

  // Today start timestamp in IST
  const todayStartEpoch = useMemo(() => {
    const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return Date.parse(`${istDate}T00:00:00+05:30`);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      const businessStatus = hasHandledDetails(c) ? "COMPLETED" : "PENDING";
      if (!callBelongsToEmployee(c)) return false;
      if (!callBelongsToLine(c)) return false;
      if (status !== "ALL" && businessStatus !== status) return false;
      if (callType !== "ALL" && c.direction !== callType) return false;

      // Quick filter checks
      const num = c.phone_number_normalized || c.phone_number_raw || "";
      const freq = callerFrequency.get(num) || 0;
      if (quickFilter === "BULK_3" && freq < 3) return false;
      if (quickFilter === "BULK_5" && freq < 5) return false;
      if (quickFilter === "TODAY" && c.started_at_epoch_ms < todayStartEpoch) return false;
      if (quickFilter === "LONG" && c.duration_seconds < 180) return false;
      if (quickFilter === "PENDING" && hasHandledDetails(c)) return false;

      if (!q) return true;
      return [
        c.phone_number_normalized, c.phone_number_raw, c.person_name, c.company_name,
        c.product_name, c.requirement_details, c.received_by, c.company_phone_number,
        c.device_id, c.resolved_line_label, c.resolved_line_carrier,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, search, status, callType, employeeId, lineFilter, quickFilter, assignedDeviceIds, selectedEmployee, lineOptions, registry.lines, callerFrequency, todayStartEpoch]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paginatedCalls = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const pendingInFiltered = filtered.filter(c => !hasHandledDetails(c)).length;

  // Selection handlers
  const toggleSelectCall = (callId: number) => {
    setSelectedCallIds(prev => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  };

  const isPageAllSelected = paginatedCalls.length > 0 && paginatedCalls.every(c => selectedCallIds.has(c.call_id));

  const toggleSelectPage = () => {
    if (isPageAllSelected) {
      setSelectedCallIds(prev => {
        const next = new Set(prev);
        paginatedCalls.forEach(c => next.delete(c.call_id));
        return next;
      });
    } else {
      setSelectedCallIds(prev => {
        const next = new Set(prev);
        paginatedCalls.forEach(c => next.add(c.call_id));
        return next;
      });
    }
  };

  const selectAllFiltered = () => {
    setSelectedCallIds(new Set(filtered.map(c => c.call_id)));
  };

  const clearSelection = () => {
    setSelectedCallIds(new Set());
  };

  // Bulk Disqualify
  const handleBulkDisqualify = async () => {
    if (user.role !== "MARKETING") return;
    const selectedList = calls.filter(c => selectedCallIds.has(c.call_id) && !hasHandledDetails(c) && !isDisqualified(c));
    if (!selectedList.length) {
      alert("None of the selected calls are currently eligible for disqualification.");
      return;
    }
    if (!window.confirm(`Disqualify all ${selectedList.length} selected pending call${selectedList.length === 1 ? "" : "s"}? This will mark them as Disqualified and remove them from pending details.`)) {
      return;
    }

    setBulkBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/enquiries/disqualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callIds: selectedList.map(c => c.call_id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bulk disqualification failed");
      setNotice(`Successfully disqualified ${data.processed || selectedList.length} calls.`);
      clearSelection();
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk disqualification failed");
    } finally {
      setBulkBusy(false);
    }
  };

  // Export URLs
  const exportQuery = new URLSearchParams();
  if (employeeId !== "ALL") exportQuery.set("employeeId", employeeId);
  if (lineFilter !== "ALL") exportQuery.set("lineFilter", lineFilter);
  const baseExportSuffix = exportQuery.toString() ? `&${exportQuery.toString()}` : "";

  const handleExportSelected = (format: "csv" | "xlsx") => {
    if (selectedCallIds.size === 0) {
      window.location.href = `/api/export?format=${format}${baseExportSuffix}`;
      return;
    }
    const ids = Array.from(selectedCallIds).join(",");
    window.location.href = `/api/export?format=${format}&callIds=${encodeURIComponent(ids)}`;
  };

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
        <div>
          <p className="eyebrow">Incoming activity</p>
          <h1>{user.role === "MARKETING" ? "My Calls" : "Calls Dashboard"}</h1>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => handleExportSelected("csv")}>
            {selectedCallIds.size > 0 ? `Export Selected CSV (${selectedCallIds.size})` : "Export CSV"}
          </button>
          <button className="primary-button" onClick={() => handleExportSelected("xlsx")}>
            {selectedCallIds.size > 0 ? `Export Selected Excel (${selectedCallIds.size})` : "Export Excel"}
          </button>
        </div>
      </div>

      <div className="health-summary-grid">
        {[
          ["Calls in view", filtered.length],
          ["Answered", filtered.filter(c => c.direction === "INCOMING_ANSWERED").length],
          ["Missed", filtered.filter(c => c.direction === "INCOMING_MISSED").length],
          ["Details pending", pendingInFiltered],
        ].map(([k, n]) => (
          <div className="stat-card" key={k}>
            <span>{k}</span>
            <strong>{loading ? "—" : n}</strong>
          </div>
        ))}
      </div>

      {/* Quick Filter Pills for Bulk Calls & High-Volume Callers */}
      <div className="quick-filter-bar">
        <button
          type="button"
          className={`quick-filter-chip${quickFilter === "ALL" ? " active" : ""}`}
          onClick={() => setQuickFilter("ALL")}
        >
          All Calls
          <span className="quick-filter-badge">{calls.length}</span>
        </button>
        <button
          type="button"
          className={`quick-filter-chip${quickFilter === "BULK_3" ? " active" : ""}`}
          onClick={() => setQuickFilter("BULK_3")}
        >
          Frequent Callers (3+ calls)
          <span className="quick-filter-badge">
            {calls.filter(c => (callerFrequency.get(c.phone_number_normalized || c.phone_number_raw || "") || 0) >= 3).length}
          </span>
        </button>
        <button
          type="button"
          className={`quick-filter-chip${quickFilter === "BULK_5" ? " active" : ""}`}
          onClick={() => setQuickFilter("BULK_5")}
        >
          Heavy Bulk Callers (5+ calls)
          <span className="quick-filter-badge">
            {calls.filter(c => (callerFrequency.get(c.phone_number_normalized || c.phone_number_raw || "") || 0) >= 5).length}
          </span>
        </button>
        <button
          type="button"
          className={`quick-filter-chip${quickFilter === "TODAY" ? " active" : ""}`}
          onClick={() => setQuickFilter("TODAY")}
        >
          Today
          <span className="quick-filter-badge">
            {calls.filter(c => c.started_at_epoch_ms >= todayStartEpoch).length}
          </span>
        </button>
        <button
          type="button"
          className={`quick-filter-chip${quickFilter === "LONG" ? " active" : ""}`}
          onClick={() => setQuickFilter("LONG")}
        >
          Long Calls (&gt;3m)
          <span className="quick-filter-badge">
            {calls.filter(c => c.duration_seconds >= 180).length}
          </span>
        </button>
        <button
          type="button"
          className={`quick-filter-chip${quickFilter === "PENDING" ? " active" : ""}`}
          onClick={() => setQuickFilter("PENDING")}
        >
          Pending Details
          <span className="quick-filter-badge">
            {calls.filter(c => !hasHandledDetails(c)).length}
          </span>
        </button>
      </div>

      <div className="filter-bar filter-bar-wide">
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, person, company or product..."
        />
        {user.role !== "MARKETING" && (
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setLineFilter("ALL");
            }}
          >
            <option value="ALL">All employees</option>
            {employees.map(e => (
              <option key={e.employee_id} value={e.employee_id}>
                {e.employee_name} · {e.employee_id}
              </option>
            ))}
          </select>
        )}
        <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
          <option value="ALL">
            {employeeId === "ALL" ? "All Phones / SIMs" : "All Employee Phones / SIMs"}
          </option>
          {lineOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">All details</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
        </select>
        <select value={callType} onChange={(e) => setCallType(e.target.value)}>
          <option value="ALL">All incoming</option>
          <option value="INCOMING_ANSWERED">Answered</option>
          <option value="INCOMING_MISSED">Missed</option>
        </select>
        <button
          className="secondary-button"
          disabled={refreshing}
          onClick={() => void load(false)}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Floating Bulk Action Bar when calls are selected */}
      {selectedCallIds.size > 0 && (
        <div className="bulk-action-bar" role="region" aria-label="Bulk call actions">
          <div className="bulk-action-bar-left">
            <span className="bulk-count-badge">{selectedCallIds.size}</span>
            <span>calls selected</span>
            {selectedCallIds.size < filtered.length && (
              <button
                type="button"
                className="bulk-btn"
                onClick={selectAllFiltered}
              >
                Select all {filtered.length} matching calls
              </button>
            )}
          </div>
          <div className="bulk-action-bar-actions">
            <button
              type="button"
              className="bulk-btn bulk-btn-primary"
              onClick={() => handleExportSelected("csv")}
            >
              Export Selected (CSV)
            </button>
            <button
              type="button"
              className="bulk-btn"
              onClick={() => handleExportSelected("xlsx")}
            >
              Export Selected (Excel)
            </button>
            {user.role === "MARKETING" && (
              <button
                type="button"
                className="bulk-btn bulk-btn-danger"
                disabled={bulkBusy}
                onClick={handleBulkDisqualify}
              >
                {bulkBusy ? "Disqualifying…" : `Bulk Disqualify (${calls.filter(c => selectedCallIds.has(c.call_id) && !hasHandledDetails(c) && !isDisqualified(c)).length})`}
              </button>
            )}
            <button
              type="button"
              className="bulk-btn"
              onClick={clearSelection}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <div className="table-card">
        <div className="table-meta">
          <span>{filtered.length} calls in current view</span>
          <span>{pendingInFiltered} details pending</span>
          <span>
            Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
          </span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={isPageAllSelected}
                    onChange={toggleSelectPage}
                    aria-label="Select all calls on current page"
                  />
                </th>
                <th>Date / Time</th>
                <th>Customer Number</th>
                <th>Received By</th>
                <th>Company Line</th>
                <th>Call</th>
                <th>Duration</th>
                <th>Person</th>
                <th>Product / Requirement</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="empty-state">Loading incoming calls...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="empty-state">No calls match these filters.</td></tr>
              ) : (
                paginatedCalls.map((call) => {
                  const customerNumber = call.phone_number_normalized || call.phone_number_raw || "Unknown";
                  const totalCallerCalls = callerFrequency.get(customerNumber) || 0;
                  const isSelected = selectedCallIds.has(call.call_id);

                  return (
                    <tr key={call.call_id} style={{ background: isSelected ? "#f0f7ff" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectCall(call.call_id)}
                          aria-label={`Select call from ${customerNumber}`}
                        />
                      </td>
                      <td>
                        <strong>{formatIST(call.started_at_epoch_ms)}</strong>
                        <small>{call.device_id}</small>
                      </td>
                      <td>
                        <strong className="phone">{customerNumber}</strong>
                        {totalCallerCalls >= 3 && (
                          <div className="frequent-caller-pill">
                            <span>●</span>
                            <span>{totalCallerCalls} calls</span>
                          </div>
                        )}
                        {call.known_contact_count > 0 && !hasHandledDetails(call) && (
                          <small>{call.known_contact_count} known contact{call.known_contact_count > 1 ? "s" : ""}</small>
                        )}
                      </td>
                      <td>
                        {call.received_by ? (() => {
                          const emp = registry.employees.find(e => e.employee_id === call.registered_employee_id);
                          return (
                            <div className="employee-inline">
                              <EmployeeAvatar
                                employeeId={call.registered_employee_id}
                                employeeName={call.received_by}
                                photoUpdatedAt={emp?.profile_photo_updated_at}
                                size="xs"
                              />
                              <div>
                                <strong>{call.received_by}</strong>
                                <small>{call.registered_employee_id || call.collector_employee || ""}</small>
                              </div>
                            </div>
                          );
                        })() : (
                          <>
                            <span className="muted">Unassigned</span>
                            <small>{call.device_id}</small>
                          </>
                        )}
                      </td>
                      <td>
                        <strong className="phone">{companyLineText(call)}</strong>
                        <small>{call.device_id}{call.line_resolution === "MULTI_SIM_UNKNOWN" ? " · SIM not identified" : ""}</small>
                      </td>
                      <td>
                        <span className={`status-pill ${call.direction === "INCOMING_ANSWERED" ? "success" : "warning"}`}>
                          {cleanStatus(call.direction).replace("Incoming ", "")}
                        </span>
                      </td>
                      <td>{formatDuration(call.duration_seconds)}</td>
                      <td>
                        {call.person_name ? (
                          <>
                            <strong>{call.person_name}</strong>
                            <small>{call.company_name || ""}</small>
                          </>
                        ) : (
                          <span className="muted">Not entered</span>
                        )}
                      </td>
                      <td>
                        {call.product_name ? (
                          <>
                            <strong>{call.product_name}</strong>
                            {call.updated_by && <small>Updated by {call.updated_by}</small>}
                          </>
                        ) : (
                          <span className="muted">Not entered</span>
                        )}
                      </td>
                      <td>
                        <div className="call-actions">
                          {isDisqualified(call) ? (
                            <span className="status-pill warning">Disqualified</span>
                          ) : hasHandledDetails(call) && user.role === "MANAGEMENT" ? (
                            <span className="status-pill success">Completed</span>
                          ) : hasHandledDetails(call) ? (
                            <button className="mini-button done" onClick={() => setSelected(call)}>
                              Completed · Edit
                            </button>
                          ) : user.role === "MANAGEMENT" ? (
                            <span className="status-pill neutral">Pending</span>
                          ) : (
                            <button className="mini-button" onClick={() => setSelected(call)}>
                              Add Details
                            </button>
                          )}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Smooth Pagination Bar */}
        <div className="pagination-controls">
          <div>
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>
              Page <strong>{safePage}</strong> of <strong>{totalPages}</strong> ({filtered.length} total calls)
            </span>
          </div>

          <div className="pagination-nav">
            <button
              type="button"
              className="secondary-button"
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ padding: "6px 12px", minHeight: "34px", fontSize: "13px" }}
            >
              &larr; Previous
            </button>

            <span className="pagination-page-indicator">
              {safePage} / {totalPages}
            </span>

            <button
              type="button"
              className="secondary-button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              style={{ padding: "6px 12px", minHeight: "34px", fontSize: "13px" }}
            >
              Next &rarr;
            </button>

            <div style={{ marginLeft: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>Show:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ padding: "5px 8px", fontSize: "13px", borderRadius: "6px", border: "1px solid var(--line)" }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {selected && user.role !== "MANAGEMENT" && (
        <EnquiryModal
          call={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void load(false);
          }}
        />
      )}
    </>
  );
}
