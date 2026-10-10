"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { IncomingCall, SessionUser, TeamRegistry } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";
import EnquiryModal from "@/components/EnquiryModal";
import EmployeeAvatar from "@/components/EmployeeAvatar";

const EMPTY_REGISTRY: TeamRegistry = { employees: [], devices: [], assignments: [], lines: [] };
const PAGE_SIZE = 50;

export default function CallsClient({ user }: { user: SessionUser }) {
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [registry, setRegistry] = useState<TeamRegistry>(EMPTY_REGISTRY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Pagination states
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [callType, setCallType] = useState("ALL");
  const [employeeId, setEmployeeId] = useState("ALL");
  const [lineFilter, setLineFilter] = useState("ALL");

  const [selected, setSelected] = useState<IncomingCall | null>(null);
  const [disqualifyingCallId, setDisqualifyingCallId] = useState<number | null>(null);
  const [recoveringCallId, setRecoveringCallId] = useState<number | null>(null);

  const isInitialMount = useRef(true);

  const fetchCalls = useCallback(
    async (targetPage: number, options: { initial?: boolean; skipRegistry?: boolean } = {}) => {
      const { initial = false, skipRegistry = false } = options;
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError("");

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(PAGE_SIZE),
        });

        if (status !== "ALL") params.set("status", status);
        if (callType !== "ALL") params.set("callType", callType);
        if (employeeId !== "ALL" && user.role !== "MARKETING") params.set("employeeId", employeeId);
        if (lineFilter !== "ALL") params.set("lineFilter", lineFilter);
        if (search.trim()) params.set("search", search.trim());
        if (skipRegistry) params.set("skipRegistry", "true");

        const response = await fetch(`/api/calls?${params.toString()}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load calls");

        setCalls(data.calls || []);
        setTotalCount(data.totalCount ?? (data.calls || []).length);
        setTotalPages(data.totalPages ?? 1);
        setPage(data.page ?? targetPage);
        if (data.registry) {
          setRegistry(data.registry);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load calls");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [status, callType, employeeId, lineFilter, search, user.role]
  );

  // Initial load and URL param parsing
  useEffect(() => {
    if (user.role !== "MARKETING") {
      const initialEmployee = new URLSearchParams(window.location.search).get("employee") || "ALL";
      setEmployeeId(initialEmployee);
    }
  }, [user.role]);

  // Load when filters change (reset to page 1)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      void fetchCalls(1, { initial: true });
      return;
    }
    setPage(1);
    void fetchCalls(1, { skipRegistry: true });
  }, [fetchCalls]);

  // Auto-refresh interval (every 30 seconds)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) {
        void fetchCalls(page, { skipRegistry: true });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchCalls, page]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page || loading || refreshing) return;
    setPage(newPage);
    void fetchCalls(newPage, { skipRegistry: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isDisqualified = (call: IncomingCall) =>
    call.resolution_outcome === "DISQUALIFIED" || (call.product_name === "Disqualified" && !call.contact_id);
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
      await fetchCalls(page, { skipRegistry: true });
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
      await fetchCalls(page, { skipRegistry: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not recover disqualified call");
    } finally {
      setRecoveringCallId(null);
    }
  };

  const employees = useMemo(
    () => registry.employees.filter((e) => e.active).sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
    [registry.employees]
  );

  const activeAssignments = useMemo(
    () => registry.assignments.filter((a) => !a.assigned_until),
    [registry.assignments]
  );

  const assignedDeviceIds = useMemo(() => {
    if (employeeId === "ALL") return new Set(activeAssignments.map((a) => a.device_id));
    return new Set(activeAssignments.filter((a) => a.employee_id === employeeId).map((a) => a.device_id));
  }, [activeAssignments, employeeId]);

  const lineOptions = useMemo(() => {
    const devices = registry.devices.filter((d) => d.active && (employeeId === "ALL" || assignedDeviceIds.has(d.device_id)));
    const options: Array<{ value: string; label: string; deviceId: string; lineId: number | null }> = [];

    devices.forEach((device) => {
      const lines = registry.lines
        .filter((l) => l.active && l.device_id === device.device_id)
        .sort((a, b) => (a.sim_slot_index ?? 99) - (b.sim_slot_index ?? 99));
      if (lines.length === 0) {
        options.push({
          value: `DEVICE:${device.device_id}`,
          label: device.company_phone_number ? `${device.company_phone_number} · ${device.device_id}` : device.device_id,
          deviceId: device.device_id,
          lineId: null,
        });
      } else {
        lines.forEach((line) => {
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
    if (lineFilter !== "ALL" && !lineOptions.some((o) => o.value === lineFilter)) {
      setLineFilter("ALL");
    }
  }, [lineOptions, lineFilter]);

  const exportQuery = new URLSearchParams();
  if (employeeId !== "ALL" && user.role !== "MARKETING") exportQuery.set("employeeId", employeeId);
  if (lineFilter !== "ALL") exportQuery.set("lineFilter", lineFilter);
  if (status !== "ALL") exportQuery.set("status", status);
  if (callType !== "ALL") exportQuery.set("callType", callType);
  if (search.trim()) exportQuery.set("search", search.trim());
  const exportSuffix = exportQuery.toString() ? `&${exportQuery.toString()}` : "";

  const companyLineText = (call: IncomingCall) => {
    if (call.company_phone_number) {
      const sim = call.resolved_sim_slot_index === 1 ? "SIM 2" : call.resolved_sim_slot_index === 0 ? "SIM 1" : "";
      return [call.company_phone_number, sim].filter(Boolean).join(" · ");
    }
    const deviceLines = registry.lines.filter((l) => l.active && l.device_id === call.device_id);
    if (deviceLines.length > 1) return "Multiple SIMs · line unknown";
    return call.phone_label || call.device_id;
  };

  const startRecord = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endRecord = Math.min(page * PAGE_SIZE, totalCount);

  // Current page counts for reference
  const answeredInPage = calls.filter((c) => c.direction === "INCOMING_ANSWERED").length;
  const missedInPage = calls.filter((c) => c.direction === "INCOMING_MISSED").length;
  const pendingInPage = calls.filter((c) => !hasHandledDetails(c)).length;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Incoming activity</p>
          <h1>{user.role === "MARKETING" ? "My Calls" : "Calls Dashboard"}</h1>
        </div>
        <div className="header-actions">
          <a className="secondary-button" href={`/api/export?format=csv${exportSuffix}`}>
            Export CSV
          </a>
          <a className="primary-button" href={`/api/export?format=xlsx${exportSuffix}`}>
            Export Excel
          </a>
        </div>
      </div>

      <div className="health-summary-grid">
        {[
          ["Total in view", totalCount],
          ["Page Answered", answeredInPage],
          ["Page Missed", missedInPage],
          ["Page Pending", pendingInPage],
        ].map(([k, n]) => (
          <div className="stat-card" key={String(k)}>
            <span>{String(k)}</span>
            <strong>{loading ? "—" : n}</strong>
          </div>
        ))}
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
            {employees.map((e) => (
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
          {lineOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
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
        <button className="secondary-button" disabled={refreshing || loading} onClick={() => void fetchCalls(page, { skipRegistry: true })}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="table-card">
        {error && <div className="error-banner table-error">{error}</div>}
        <div className="table-meta">
          <span>
            {totalCount > 0 ? `Showing ${startRecord}–${endRecord} of ${totalCount.toLocaleString()} calls` : "0 calls"}
          </span>
          <span>Page {page} of {totalPages}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
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
                <tr>
                  <td colSpan={9} className="empty-state">
                    Loading incoming calls...
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No calls match these filters.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr key={call.call_id}>
                    <td>
                      <strong>{formatIST(call.started_at_epoch_ms)}</strong>
                      <small>{call.device_id}</small>
                    </td>
                    <td>
                      <strong className="phone">
                        {call.phone_number_normalized || call.phone_number_raw || "Unknown"}
                      </strong>
                      {call.known_contact_count > 0 && !hasHandledDetails(call) && (
                        <small>
                          {call.known_contact_count} known contact{call.known_contact_count > 1 ? "s" : ""}
                        </small>
                      )}
                    </td>
                    <td>
                      {call.received_by ? (
                        (() => {
                          const emp = registry.employees.find((e) => e.employee_id === call.registered_employee_id);
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
                        })()
                      ) : (
                        <>
                          <span className="muted">Unassigned</span>
                          <small>{call.device_id}</small>
                        </>
                      )}
                    </td>
                    <td>
                      <strong className="phone">{companyLineText(call)}</strong>
                      <small>
                        {call.device_id}
                        {call.line_resolution === "MULTI_SIM_UNKNOWN" ? " · SIM not identified" : ""}
                      </small>
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
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Server-Side Pagination Bar */}
        <div className="pagination-bar">
          <div className="pagination-info">
            Showing {startRecord}–{endRecord} of {totalCount.toLocaleString()} calls
          </div>
          <div className="pagination-controls">
            <button
              className="pagination-btn"
              disabled={page <= 1 || loading || refreshing}
              onClick={() => handlePageChange(page - 1)}
            >
              ← Previous
            </button>
            <span className="pagination-info">
              Page {page} of {totalPages}
            </span>
            <button
              className="pagination-btn"
              disabled={page >= totalPages || loading || refreshing}
              onClick={() => handlePageChange(page + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {selected && user.role !== "MANAGEMENT" && (
        <EnquiryModal
          call={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void fetchCalls(page, { skipRegistry: true });
          }}
        />
      )}
    </>
  );
}
