"use client";

import { useEffect, useState } from "react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import type { HandoverDetail, HandoverScope, HandoverDepartment } from "@/lib/shane-handover";

type Recipient = {
  employee_id: string;
  employee_name: string;
  profile_photo_updated_at: string | null;
  department: HandoverDepartment;
  count: number;
};
type RosterResponse = {
  departments: Record<HandoverDepartment, Recipient[]>;
};
type HandoverItem = HandoverDetail & {
  assigned_to_employee_id: string;
  assignment_event_id: string;
  assignment_event_type: string;
  assigned_at_epoch_ms: number;
};
type CustomerResponse = {
  total: number;
  page: number;
  pageSize: number;
  items: HandoverItem[];
};
type HistoryEvent = {
  event_id: string;
  event_type: string;
  assigned_to_employee_id: string;
  occurred_at_epoch_ms: number;
  recorded_at: string;
  whatsapp_recipient_number: string | null;
  form_snapshot: Record<string, unknown> | null;
};
type HistoryResponse = { detail: HandoverDetail; events: HistoryEvent[] };
type Box = { id: HandoverScope; name: string; deviceId: string; source: string; description: string };
const BOXES: Box[] = [
  { id: "original", name: "Original Shane's Handover", deviceId: "MKT-019",
    source: "SHANE · EMP-017", description: "Only actual customer handovers saved on Shane Sir's phone." },
  { id: "test", name: "Shane Test Handover", deviceId: "MKT-001",
    source: "SHANE TEST · TEST-SHANE-001", description: "Only test-phone handovers. Never included in the original view." },
];

function fmtIST(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

async function readJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load the handover report");
  return data as T;
}

function api(params: Record<string, string>) {
  return "/api/management/shane-handover?" + new URLSearchParams(params).toString();
}

export default function ShaneHandoverClient() {
  const [scope, setScope] = useState<HandoverScope | null>(null);
  const [department, setDepartment] = useState<HandoverDepartment | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [customers, setCustomers] = useState<CustomerResponse | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    setRosterLoading(true);
    setRoster(null);
    setError("");
    readJSON<RosterResponse>(api({
      scope, mode: "roster", ...(from ? { from } : {}), ...(to ? { to } : {}),
    }), controller.signal)
      .then(data => { if (!controller.signal.aborted) setRoster(data); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setRosterLoading(false); });
    return () => controller.abort();
  }, [scope, from, to, reload]);

  useEffect(() => {
    if (!scope || !department || !employeeId) { setCustomers(null); return; }
    const controller = new AbortController();
    setCustomerLoading(true);
    setCustomers(null);
    setError("");
    readJSON<CustomerResponse>(api({
      scope, mode: "customers", department, employee: employeeId,
      page: String(page), ...(from ? { from } : {}), ...(to ? { to } : {}),
      ...(search ? { q: search } : {}),
    }), controller.signal)
      .then(data => { if (!controller.signal.aborted) setCustomers(data); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setCustomerLoading(false); });
    return () => controller.abort();
  }, [scope, department, employeeId, page, from, to, search, reload]);

  useEffect(() => {
    if (!scope || !historyId) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistory(null);
    setHistoryError("");
    readJSON<HistoryResponse>(api({ scope, mode: "history", detail_id: historyId }), controller.signal)
      .then(data => { if (!controller.signal.aborted) setHistory(data); })
      .catch(e => { if (!controller.signal.aborted) setHistoryError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [scope, historyId]);

  const chooseScope = (next: HandoverScope) => {
    setScope(next);
    setDepartment(null);
    setEmployeeId("");
    setCustomers(null);
    setPage(1);
    setSearch("");
    setHistoryId("");
  };
  const chooseDepartment = (next: HandoverDepartment) => {
    setDepartment(next);
    setEmployeeId("");
    setCustomers(null);
    setPage(1);
    setSearch("");
  };
  const selected = BOXES.find(box => box.id === scope);
  const employees = roster && department ? roster.departments[department] || [] : [];
  const employee = employees.find(row => row.employee_id === employeeId);
  const labelStyle = { display: "grid", gap: 5, fontSize: 13 } as const;
  const inputStyle = { border: "1px solid var(--line)", borderRadius: 8, padding: "10px", minWidth: 0, background: "var(--surface)" } as const;
  const buttonStyle = { cursor: "pointer", border: "1px solid var(--line)", borderRadius: 9, padding: "12px 15px", background: "var(--surface)" } as const;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin &amp; Management</p>
          <h1>Shane&apos;s Handover</h1>
          <p>Browse customer handovers by source phone, department, and assigned employee.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setReload(i => i + 1)} disabled={!scope}>
          Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16, marginBottom: 18 }}>
        {BOXES.map(box => (
          <button key={box.id} type="button" onClick={() => chooseScope(box.id)}
            aria-pressed={scope === box.id}
            style={{ ...buttonStyle, textAlign: "left", padding: 20,
              border: scope === box.id ? "2px solid var(--accent)" : "1px solid var(--line)",
              background: scope === box.id ? "var(--surface2)" : "var(--surface)" }}>
            <strong style={{ display: "block", fontSize: 19, marginBottom: 7 }}>{box.name}</strong>
            <span style={{ display: "block", fontSize: 13, marginBottom: 7 }}>{box.deviceId} · {box.source}</span>
            <span style={{ display: "block", fontSize: 13, color: "var(--muted)" }}>{box.description}</span>
          </button>
        ))}
      </div>

      {!scope ? (
        <section className="panel" style={{ padding: 24 }}>
          <p>Choose <strong>Original Shane&apos;s Handover</strong> or <strong>Shane Test Handover</strong>. Both have the same Marketing and Service employee drill-down. Records are isolated by device and source employee on the server.</p>
        </section>
      ) : (
        <>
          <section className="panel" style={{ padding: 18, marginBottom: 16 }}>
            <strong>{selected?.name}</strong>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Only {selected?.deviceId} / {selected?.source} · Assignment time is India Standard Time.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12, marginTop: 16 }}>
              <label style={labelStyle}><span>Assigned from (IST)</span>
                <input style={inputStyle} type="date" value={from} max={to || undefined}
                  onChange={e => { setFrom(e.target.value); setPage(1); }} />
              </label>
              <label style={labelStyle}><span>Assigned to (IST)</span>
                <input style={inputStyle} type="date" value={to} min={from || undefined}
                  onChange={e => { setTo(e.target.value); setPage(1); }} />
              </label>
              <button type="button" style={buttonStyle} onClick={() => { setFrom(""); setTo(""); setPage(1); }}>
                All dates
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <button type="button" style={{ ...buttonStyle, fontWeight: department === "MARKETING" ? 700 : 400 }}
                aria-pressed={department === "MARKETING"} onClick={() => chooseDepartment("MARKETING")}>
                Marketing {roster ? "(" + (roster.departments.MARKETING?.length || 0) + " employees)" : ""}
              </button>
              <button type="button" style={{ ...buttonStyle, fontWeight: department === "SERVICE" ? 700 : 400 }}
                aria-pressed={department === "SERVICE"} onClick={() => chooseDepartment("SERVICE")}>
                Service · Alagupriya
              </button>
            </div>
          </section>

          {error && <div className="error-banner" role="alert">{error}</div>}
          {rosterLoading && <p>Loading eligible employees and verified handover counts...</p>}

          {department && !rosterLoading && roster && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", alignItems: "start", gap: 16 }}>
              <section className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 19, marginTop: 0 }}>{department === "SERVICE" ? "Service" : "Marketing"} employees</h2>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>All eligible active employees appear, including those with no recorded handovers.</p>
                {!employees.length && <p>No eligible employees are active in this department.</p>}
                {employees.map(person => (
                  <button key={person.employee_id} type="button" onClick={() => { setEmployeeId(person.employee_id); setPage(1); setSearch(""); }}
                    aria-pressed={employeeId === person.employee_id}
                    style={{ ...buttonStyle, display: "flex", width: "100%", gap: 12, alignItems: "center",
                      marginTop: 9, textAlign: "left", background: employeeId === person.employee_id ? "var(--surface2)" : "var(--surface)" }}>
                    <EmployeeAvatar employeeId={person.employee_id} employeeName={person.employee_name}
                      photoUpdatedAt={person.profile_photo_updated_at} size="sm" />
                    <span style={{ flex: 1 }}><strong style={{ display: "block" }}>{person.employee_name}</strong>
                      <small style={{ color: "var(--muted)" }}>{person.employee_id}</small></span>
                    <strong title="Current assigned customer count">{person.count}</strong>
                  </button>
                ))}
              </section>

              <section className="panel" style={{ padding: 16 }}>
                {!employee ? (
                  <p>Select an employee to view the customers assigned by {scope === "test" ? "the Shane test device" : "Shane Sir"}.</p>
                ) : (
                  <>
                    <h2 style={{ fontSize: 19, marginTop: 0 }}>{employee.employee_name}&apos;s handover customers</h2>
                    <p style={{ fontSize: 12, color: "var(--muted)" }}>{selected?.deviceId} · {department} · {employee.employee_id}</p>
                    <label style={labelStyle}><span>Search customer, phone, product or location</span>
                      <input style={{ ...inputStyle, width: "100%" }} value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                        placeholder="Search assigned customers..." />
                    </label>
                    {customerLoading && <p>Loading assigned customers...</p>}
                    {!customerLoading && customers && (
                      <>
                        <p style={{ fontSize: 13, color: "var(--muted)" }}>{customers.total} assigned customer{customers.total === 1 ? "" : "s"}</p>
                        {!customers.items.length && <p>No recorded handovers match these filters. Unassigned historical customer records are not attributed to employees.</p>}
                        <div style={{ display: "grid", gap: 12 }}>
                          {customers.items.map(item => (
                            <article key={item.detail_id} style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10 }}>
                              <strong style={{ fontSize: 16 }}>{item.customer_name || "Customer name not recorded"}</strong>
                              {item.very_urgent && <span style={{ marginLeft: 9, color: "var(--danger)", fontWeight: 700 }}>Very urgent</span>}
                              <p style={{ margin: "9px 0", fontSize: 13 }}>
                                <strong>Product:</strong> {item.product_asked || "Not recorded"}<br/>
                                <strong>Location:</strong> {item.location || "Not recorded"}<br/>
                                <strong>Call date/time (IST):</strong> {fmtIST(item.call_started_at_epoch_ms)}<br/>
                                <strong>Assigned to:</strong> {employee.employee_name}<br/>
                                <strong>Assigned at (IST):</strong> {fmtIST(item.assigned_at_epoch_ms)}
                              </p>
                              <button type="button" className="mini-button" onClick={() => setHistoryId(item.detail_id)}>View details &amp; history</button>
                            </article>
                          ))}
                        </div>
                        {customers.total > customers.pageSize && (
                          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
                            <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button>
                            <span>Page {page} of {Math.ceil(customers.total / customers.pageSize)}</span>
                            <button type="button" className="secondary-button" disabled={page * customers.pageSize >= customers.total}
                              onClick={() => setPage(n => n + 1)}>Next</button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {historyId && scope && (
        <div role="presentation" onClick={() => setHistoryId("")}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.55)",
            display: "grid", placeItems: "center", padding: 15 }}>
          <div role="dialog" aria-modal="true" aria-label="Customer details and handover history"
            onClick={e => e.stopPropagation()}
            style={{ width: "min(720px,100%)", maxHeight: "88vh", overflowY: "auto",
              background: "var(--surface)", padding: 22, borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 15 }}>
              <h2 style={{ marginTop: 0 }}>Customer details &amp; assignment history</h2>
              <button type="button" className="secondary-button" onClick={() => setHistoryId("")}>Close</button>
            </div>
            {historyLoading && <p>Loading history...</p>}
            {historyError && <p className="error-banner">{historyError}</p>}
            {history && (
              <>
                <p><strong>Customer:</strong> {history.detail.customer_name || "Not recorded"}<br/>
                  <strong>Phone:</strong> {history.detail.phone_number_normalized || history.detail.phone_number_raw || "Not recorded"}<br/>
                  <strong>Product:</strong> {history.detail.product_asked || "Not recorded"}<br/>
                  <strong>Location:</strong> {history.detail.location || "Not recorded"}<br/>
                  <strong>Notes:</strong> {history.detail.notes || "Not recorded"}<br/>
                  <strong>Call:</strong> {fmtIST(history.detail.call_started_at_epoch_ms)} IST</p>
                <h3>Recorded assignment and WhatsApp actions</h3>
                {!history.events.length && <p>No assignment event has been recorded for this customer.</p>}
                {history.events.map(event => (
                  <details key={event.event_id} style={{ borderTop: "1px solid var(--line)", padding: "11px 0" }}>
                    <summary>{event.event_type} · {event.assigned_to_employee_id} · {fmtIST(event.occurred_at_epoch_ms)} IST</summary>
                    <small>Event ID: {event.event_id}</small>
                    <p style={{ fontSize: 13 }}>Recorded: {fmtIST(event.recorded_at)} IST<br/>
                      WhatsApp recipient: {event.whatsapp_recipient_number || "Not recorded"}</p>
                    {event.form_snapshot && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>
                      {JSON.stringify(event.form_snapshot, null, 2)}
                    </pre>}
                  </details>
                ))}
                <small>Opening WhatsApp is not confirmation the message was sent. History shows up to 200 recent events.</small>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
