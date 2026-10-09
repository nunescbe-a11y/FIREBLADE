"use client";

import { useEffect, useMemo, useState } from "react";
import InformationSentTable, { type InformationSentDisplayRow } from "@/components/InformationSentTable";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import type { HandoverScope, HandoverDepartment, HandoverDetail } from "@/lib/shane-handover";

type Recipient = {
  employee_id: string;
  employee_name: string;
  department: HandoverDepartment;
  profile_photo_updated_at: string | null;
  count: number;
};
type Roster = {
  departments: Record<HandoverDepartment, Recipient[]>;
  department_totals: Record<HandoverDepartment, number>;
};
type Customer = HandoverDetail & {
  assignment_event_id: string;
  assigned_to_employee_id: string;
  assigned_at_epoch_ms: number;
};
type CustomerResult = { total: number; page: number; pageSize: number; items: Customer[] };
type AssignmentHistory = { detail: HandoverDetail; events: Array<{
  event_id: string;
  event_type: string;
  assigned_to_employee_id: string;
  occurred_at_epoch_ms: number;
  recorded_at: string;
  whatsapp_recipient_number: string | null;
  form_snapshot: Record<string, unknown> | null;
}> };
const SOURCES = [
  { id: "original" as const, title: "Original Shane's Handover", device: "MKT-019",
    employee: "EMP-017", description: "Only real customers saved by Shane Sir" },
  { id: "test" as const, title: "Shane Test Handover", device: "MKT-001",
    employee: "TEST-SHANE-001", description: "Only customers saved on the dedicated QA phone" },
];
const endpoint = (query: Record<string, string>) =>
  "/api/management/shane-handover?" + new URLSearchParams(query).toString();

async function getJSON<T>(url: string, signal: AbortSignal): Promise<T> {
  const result = await fetch(url, { cache: "no-store", signal });
  const body = await result.json();
  if (!result.ok) throw new Error(body.error || "Could not load handover details");
  return body as T;
}

function istTime(value: number | string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

/**
 * This renders inside Overview, not in the sidebar.
 * All source and employee isolation happens in /api/management/shane-handover.
 */
export default function DashboardShaneHandover() {
  const [source, setSource] = useState<HandoverScope | null>(null);
  const [department, setDepartment] = useState<HandoverDepartment | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [records, setRecords] = useState<CustomerResult | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [requestVersion, setRequestVersion] = useState(0);
  const [tableExpanded, setTableExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [history, setHistory] = useState<AssignmentHistory | null>(null);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!source) { setRoster(null); return; }
    const controller = new AbortController();
    setRoster(null);
    setBusy(true);
    setError("");
    void getJSON<Roster>(endpoint({
      scope: source, mode: "roster", ...(from ? { from } : {}), ...(to ? { to } : {}),
    }), controller.signal)
      .then(data => { if (!controller.signal.aborted) setRoster(data); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [source, from, to, requestVersion]);

  useEffect(() => {
    if (!source || !department || !employeeId) { setRecords(null); return; }
    const controller = new AbortController();
    setRecords(null);
    setBusy(true);
    setError("");
    void getJSON<CustomerResult>(endpoint({
      scope: source, mode: "customers", department, employee: employeeId, page: String(page),
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { q: search } : {}),
    }), controller.signal)
      .then(data => { if (!controller.signal.aborted) setRecords(data); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [source, department, employeeId, from, to, search, page, requestVersion]);

  useEffect(() => {
    if (!source || !historyId) { setHistory(null); return; }
    const controller = new AbortController();
    setHistory(null);
    setHistoryError("");
    void getJSON<AssignmentHistory>(endpoint({ scope: source, mode: "history", detail_id: historyId }), controller.signal)
      .then(data => { if (!controller.signal.aborted) setHistory(data); })
      .catch(e => { if (!controller.signal.aborted) setHistoryError(String(e.message)); });
    return () => controller.abort();
  }, [source, historyId]);

  const employees = roster && department ? roster.departments[department] || [] : [];
  const departmentCards: HandoverDepartment[] = ["MARKETING", "SERVICE"];
  const employee = employees.find(item => item.employee_id === employeeId) || null;
  const activeSource = SOURCES.find(item => item.id === source);
  const rows: InformationSentDisplayRow[] = useMemo(() => (records?.items || []).map(item => ({
    enquiry_id: item.detail_id,
    detail_id: item.detail_id,
    call_at: new Date(item.call_started_at_epoch_ms).toISOString(),
    employee_id: source === "original" ? "EMP-017" : "TEST-SHANE-001",
    employee_name: source === "original" ? "SHANE" : "SHANE TEST",
    customer_name: item.customer_name || "",
    customer_company: "",
    customer_phone: item.phone_number_normalized || item.phone_number_raw || "",
    product_name: item.product_asked || "",
    requirement_details: null,
    notes: item.notes,
    information_items: [],
    source: "SHANE" as const,
    location: item.location || "",
    very_urgent: Boolean(item.very_urgent),
    assigned_to_employee_id: item.assigned_to_employee_id,
    assigned_to_employee_name: employee?.employee_name || item.assigned_to_employee_id,
    assigned_at_epoch_ms: item.assigned_at_epoch_ms,
  })), [records, source, employee]);

  const chooseSource = (next: HandoverScope) => {
    setSource(next); setDepartment(null); setEmployeeId(""); setPage(1); setSearch("");
    setRecords(null); setHistoryId(""); setTableExpanded(true);
  };
  const chooseDepartment = (next: HandoverDepartment) => {
    setDepartment(next); setEmployeeId(""); setRecords(null); setSearch(""); setPage(1);
    setHistoryId(""); setTableExpanded(true);
  };
  const chooseEmployee = (next: string) => {
    setEmployeeId(next); setRecords(null); setSearch(""); setPage(1);
    setHistoryId(""); setTableExpanded(true);
  };
  const query = employeeId && department && source ? {
    scope: source, mode: "customers", department, employee: employeeId,
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { q: search } : {}),
  } : null;

  return (
    <section className="overview-dashboard-section overview-information-sent" aria-labelledby="overview-shane-handover">
      <div className="overview-section-heading overview-information-sent-heading">
        <div>
          <p className="eyebrow">Customer follow-up</p>
          <h2 id="overview-shane-handover">Shane&apos;s Handover · Information Sent</h2>
          <p className="muted">Select Original or Test, then Marketing or Service and an employee to see Shane&apos;s customer details.</p>
        </div>
        <div className="overview-information-actions">
          {query && <>
            <a className="secondary-button" href={endpoint({ ...query, format: "csv" })}>CSV</a>
            <a className="secondary-button" href={endpoint({ ...query, format: "xlsx" })}>Excel</a>
          </>}
          {query && <button type="button" className="secondary-button"
            onClick={() => setTableExpanded(value => !value)}>{tableExpanded ? "Hide" : "Show"}</button>}
          <button type="button" className="secondary-button" onClick={() => setRequestVersion(value => value + 1)}
            disabled={!source || busy}>Refresh</button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {SOURCES.map(box => (
          <button type="button" key={box.id} className={`stat-card dashboard-stat-button${source === box.id ? " selected" : ""}`}
            aria-pressed={source === box.id} onClick={() => chooseSource(box.id)}>
            <strong style={{ fontSize: 17 }}>{box.title}</strong>
            <span>{box.device} · {box.employee}</span>
            <small>{box.description}</small>
          </button>
        ))}
      </div>

      {source && <div className="dashboard-drilldown" style={{ marginBottom: 14 }}>
        <div className="drilldown-title">
          <strong>{activeSource?.title}</strong>
          <small>{activeSource?.device} · {activeSource?.employee} · India time</small>
        </div>
        <div className="drilldown-controls" style={{ marginBottom: 16 }}>
          <label><span>Assigned from</span><input type="date" max={to || undefined} value={from}
            onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
          <label><span>Assigned to</span><input type="date" min={from || undefined} value={to}
            onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        </div>

        <div className="department-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 16 }}>
          {departmentCards.map(dept => {
            const isSelected = department === dept;
            const members = roster?.departments[dept] || [];
            const uniqueCustomers = roster?.department_totals?.[dept];
            return <button type="button" key={dept}
              className={`department-card${isSelected ? " selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => chooseDepartment(dept)}>
              <h2>{dept}</h2>
              <strong>{uniqueCustomers === undefined ? "—" : uniqueCustomers}</strong>
              <span>unique assigned customers - {roster ? members.length : "—"} employees</span>
              <small>Tap to see {dept === "SERVICE" ? "Alagupriya" : "Marketing employees"} and their profile photos</small>
            </button>;
          })}
        </div>

        {department && roster && <div className="dashboard-drilldown" style={{ marginBottom: 16, boxShadow: "none" }}>
          <div className="drilldown-title">
            <strong>{department === "MARKETING" ? "Marketing" : "Service"} employees</strong>
            <button type="button" className="secondary-button"
              onClick={() => { setDepartment(null); chooseEmployee(""); }}>
              Back to departments
            </button>
          </div>
          {!employees.length && <div className="drilldown-hint">No eligible active employees in this department.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {employees.map(person => <button type="button" key={person.employee_id}
              aria-pressed={employeeId === person.employee_id}
              onClick={() => chooseEmployee(person.employee_id)}
              className={`department-card${employeeId === person.employee_id ? " selected" : ""}`}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, textAlign: "left" }}>
              <EmployeeAvatar employeeId={person.employee_id} employeeName={person.employee_name}
                photoUpdatedAt={person.profile_photo_updated_at} size="md" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 14, overflowWrap: "anywhere" }}>{person.employee_name}</strong>
                <small style={{ display: "block", fontSize: 12 }}>{person.employee_id}</small>
                <small style={{ display: "block", fontSize: 12 }}>{person.count} assigned customer{person.count === 1 ? "" : "s"}</small>
              </span>
            </button>)}
          </div>
        </div>}

        {employee && <div className="drilldown-controls">
          <label style={{ gridColumn: "1 / -1" }}><span>Search {employee.employee_name}&apos;s assigned customers</span>
            <input value={search} placeholder="Customer, product, phone..." type="search"
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </label>
        </div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {busy && <div className="drilldown-hint">Loading handovers...</div>}
        {!department && <div className="drilldown-hint">Tap the Marketing or Service card to see employees and their profile photos.</div>}
        {department && !employeeId && Boolean(employees.length) && <div className="drilldown-hint">
          Tap an employee's photo/name to view the customers Shane assigned to that employee.
        </div>}
        {employee && tableExpanded && <>
          <div className="overview-information-meta">
            <span>{records ? `${records.total} customer${records.total === 1 ? "" : "s"} assigned to ${employee.employee_name}` : "Loading..."}</span>
            <span>{from || "All dates"} – {to || "All dates"} · Assignment time (IST)</span>
          </div>
          <InformationSentTable key={`${source}:${department}:${employeeId}`} rows={rows} types={[]}
            loading={busy} className="overview-information-table"
            onViewShaneDetails={detailId => setHistoryId(detailId)} />
          {records && records.total > records.pageSize && <div className="overview-information-actions" style={{ padding: 12, justifyContent: "flex-end" }}>
            <button type="button" className="secondary-button" disabled={page <= 1 || busy}
              onClick={() => setPage(p => p - 1)}>Previous</button>
            <span>Page {page} of {Math.ceil(records.total / records.pageSize)}</span>
            <button type="button" className="secondary-button" disabled={page * records.pageSize >= records.total || busy}
              onClick={() => setPage(p => p + 1)}>Next</button>
          </div>}
        </>}
      </div>}

      {historyId && source && <div role="presentation" onClick={() => setHistoryId("")}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100,
          display: "grid", placeItems: "center", padding: 16 }}>
        <section role="dialog" aria-modal="true" aria-label="Shane customer assignment history"
          onClick={e => e.stopPropagation()}
          style={{ background: "var(--surface)", width: "min(720px,100%)", maxHeight: "88vh",
            overflowY: "auto", padding: 22, borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <h3>Customer assignment history</h3>
            <button className="secondary-button" type="button" onClick={() => setHistoryId("")}>Close</button>
          </div>
          {historyError && <p className="error-banner">{historyError}</p>}
          {!history && !historyError && <p>Loading history...</p>}
          {history && <>
            <p><strong>{history.detail.customer_name || "Not recorded"}</strong> · {activeSource?.device}</p>
            <p>Phone: {history.detail.phone_number_raw || history.detail.phone_number_normalized || "Not recorded"}</p>
            {history.events.map(event => <details key={event.event_id} style={{ borderTop: "1px solid var(--line)", padding: 10 }}>
              <summary>{event.event_type} · {event.assigned_to_employee_id} · {istTime(event.occurred_at_epoch_ms)}</summary>
              <small>Event ID: {event.event_id} · Recorded {istTime(event.recorded_at)}</small>
              {event.whatsapp_recipient_number && <p>WhatsApp recipient: {event.whatsapp_recipient_number}</p>}
              {event.form_snapshot && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(event.form_snapshot, null, 2)}
              </pre>}
            </details>)}
            {!history.events.length && <p>No recorded assignment events.</p>}
            <small>Opening WhatsApp does not confirm a message was sent.</small>
          </>}
        </section>
      </div>}
    </section>
  );
}
