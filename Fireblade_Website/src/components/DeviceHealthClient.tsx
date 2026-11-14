"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DeviceHealthView, SessionUser } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { when } from "@/lib/date";
import EmployeeAvatar from "./EmployeeAvatar";

const truth = (v: boolean | null | undefined) => v == null ? "UNKNOWN" : v ? "ON" : "OFF";
type OffCategory = "INTERNET" | "PHONE";
type OffEmployee = {
  key: string;
  employee_id: string | null;
  employee_name: string;
  department_name: string;
  profile_photo_updated_at?: string | null;
  devices: DeviceHealthView[];
};

function isPhoneOff(row: DeviceHealthView) {
  return row.state === "OFF CONFIRMED";
}

function isInternetOff(row: DeviceHealthView) {
  return row.internet_disconnected === true && !isPhoneOff(row);
}

function groupAffectedEmployees(rows: DeviceHealthView[]): OffEmployee[] {
  const byEmployee = new Map<string, OffEmployee>();
  for (const row of rows) {
    const key = row.employee_id || `DEVICE:${row.device_id}`;
    const existing = byEmployee.get(key);
    if (existing) {
      existing.devices.push(row);
      continue;
    }
    byEmployee.set(key, {
      key,
      employee_id: row.employee_id,
      employee_name: row.employee_name || "Unassigned",
      department_name: row.department_name || "Unassigned",
      profile_photo_updated_at: row.profile_photo_updated_at,
      devices: [row],
    });
  }
  return [...byEmployee.values()]
    .map(employee => ({
      ...employee,
      devices: [...employee.devices].sort((a, b) => a.device_id.localeCompare(b.device_id)),
    }))
    .sort((a, b) => a.department_name.localeCompare(b.department_name) || a.employee_name.localeCompare(b.employee_name));
}

export default function DeviceHealthClient({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<DeviceHealthView[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const [department, setDepartment] = useState("ALL"), [employee, setEmployee] = useState("ALL"), [search, setSearch] = useState("");
  const [updateFilter, setUpdateFilter] = useState("ALL");
  const [refreshed, setRefreshed] = useState("");
  const [offDrillOpen, setOffDrillOpen] = useState(false);
  const [offCategory, setOffCategory] = useState<OffCategory | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/device-health", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Unable to retrieve status");
      setRows(j.devices || []); setRefreshed(j.generated_at); setError("");
    } catch(e) { setError(e instanceof Error ? e.message : "Unable to retrieve status"); }
    finally { setLoading(false); inFlight.current = false; }
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDepartment(p.get("department") || "ALL");
    setEmployee(p.get("employee") || "ALL");
    if (p.get("drill") === "off") setOffDrillOpen(true);
    if (p.get("category") === "internet") setOffCategory("INTERNET");
    if (p.get("category") === "phone") setOffCategory("PHONE");
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const check = async (device_id?: string) => {
    setBusy(device_id || "ALL"); setNotice("");
    try {
      const r = await fetch("/api/device-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(device_id ? { device_id } : { all: true }) });
      const j = await r.json(); if (!r.ok && !j.results) throw new Error(j.error || "Check failed");
      const ok = (j.results || []).filter((x: {error?:string}) => !x.error);
      const failed = (j.results || []).length - ok.length;
      setNotice(`${ok.length} check${ok.length === 1 ? "" : "s"} requested.${failed ? ` ${failed} could not be queued; wait briefly and retry.` : ""}${ok.some((x: {delivery_status:string}) => x.delivery_status !== "SENT") ? " Some phones will pick up the request on their next connection." : ""}`);
      await load();
    } catch(e) { setNotice(e instanceof Error ? e.message : "Check failed"); }
    finally { setBusy(""); }
  };

  const filtered = useMemo(() => rows.filter(r =>
    (department === "ALL" || (r.department_id || "UNASSIGNED") === department) &&
    (employee === "ALL" || r.employee_id === employee) &&
    (updateFilter === "ALL" ||
      (updateFilter === "UP_TO_DATE" && r.update_info?.stage === "CURRENT") ||
      (updateFilter === "CAN_UPDATE" && r.update_info?.can_update) ||
      (updateFilter === "ATTENTION" && (r.update_info?.stage === "FAILED" || r.update_info?.stage === "NOT_INSTALLED" || !r.update_info))
    ) &&
    [r.device_id, r.employee_name, r.company_phone_number, r.apk_version, r.update_info?.target_version].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  ), [rows, department, employee, updateFilter, search]);
  const visible = error ? filtered.map(r => ({...r, state:"UNKNOWN" as const,phone_working:"UNKNOWN" as const,internet_status:"UNKNOWN"})) : filtered;
  const departments = [...new Map(rows.map(r => [r.department_id || "UNASSIGNED", r.department_name || "Unassigned"])).entries()];
  const employees = [...new Map(rows.filter(r => r.employee_id && (department === "ALL" || (r.department_id || "UNASSIGNED") === department)).map(r => [r.employee_id!, r.employee_name])).entries()];

  // The OFF drill-down is deliberately company-wide. Main page department,
  // employee, and search filters do not hide affected staff from management.
  const phoneOffRows = useMemo(() => error ? [] : rows.filter(isPhoneOff), [rows, error]);
  const internetOffRows = useMemo(() => error ? [] : rows.filter(isInternetOff), [rows, error]);
  const allOffEmployees = useMemo(() => groupAffectedEmployees([...phoneOffRows, ...internetOffRows]), [phoneOffRows, internetOffRows]);
  const phoneOffEmployees = useMemo(() => groupAffectedEmployees(phoneOffRows), [phoneOffRows]);
  const internetOffEmployees = useMemo(() => groupAffectedEmployees(internetOffRows), [internetOffRows]);
  const drillEmployees = offCategory === "PHONE" ? phoneOffEmployees : offCategory === "INTERNET" ? internetOffEmployees : [];

  const toggleOffDrill = () => {
    setOffDrillOpen(current => {
      if (current) setOffCategory(null);
      return !current;
    });
  };

  return <>
    <div className="page-header"><div><p className="eyebrow">Company phones</p><h1>Device Health</h1></div><div className="header-actions"><button className="primary-button" disabled={!!busy || loading || !rows.length} onClick={() => void check()}>{busy === "ALL" ? "Requesting…" : "Check All Phones"}</button></div></div>

    <div className="health-summary-grid">
      <div className="stat-card"><span>Company phones</span><strong>{loading ? "—" : visible.length}</strong></div>
      <div className="stat-card"><span>Working</span><strong>{loading ? "—" : visible.filter(r => r.phone_working === "YES").length}</strong></div>
      <div className="stat-card"><span>Up to date</span><strong>{loading ? "—" : visible.filter(r => r.update_info?.stage === "CURRENT").length}</strong></div>
      <div className="stat-card"><span>Can update</span><strong>{loading ? "—" : visible.filter(r => r.update_info?.can_update).length}</strong></div>
      <button type="button" className={`stat-card device-health-off-button${offDrillOpen ? " selected" : ""}`} onClick={toggleOffDrill} aria-expanded={offDrillOpen}>
        <span>Off confirmed</span><strong>{loading || error ? "—" : allOffEmployees.length}</strong><small>Internet off + phone off</small>
      </button>
      <div className="stat-card"><span>Needs a check</span><strong>{loading ? "—" : visible.filter(r => r.phone_working === "UNKNOWN").length}</strong></div>
    </div>

    {offDrillOpen && <section className="health-off-drilldown" aria-label="Off confirmed employee drill-down">
      <div className="health-off-drill-heading">
        <div><p className="eyebrow">Company-wide drill-down</p><h2>Off Confirmed</h2><p>All departments are included. Main Device Health filters do not limit this list.</p></div>
        <button type="button" className="secondary-button" onClick={() => { setOffDrillOpen(false); setOffCategory(null); }}>Close</button>
      </div>

      <div className="health-off-category-grid">
        <button type="button" className={`health-off-category-card${offCategory === "INTERNET" ? " selected" : ""}`} onClick={() => setOffCategory("INTERNET")} aria-pressed={offCategory === "INTERNET"}>
          <span>Internet turned off</span><strong>{loading || error ? "—" : internetOffEmployees.length}</strong><small>Phone is reporting, but both Wi-Fi and cellular are disconnected.</small>
        </button>
        <button type="button" className={`health-off-category-card${offCategory === "PHONE" ? " selected" : ""}`} onClick={() => setOffCategory("PHONE")} aria-pressed={offCategory === "PHONE"}>
          <span>Phone off</span><strong>{loading || error ? "—" : phoneOffEmployees.length}</strong><small>Verified shutdown received. It stays here until newer verified phone activity arrives.</small>
        </button>
      </div>

      {!offCategory ? <div className="health-off-hint">Select <strong>Internet turned off</strong> or <strong>Phone off</strong> to see every affected employee.</div> : <>
        <div className="health-off-list-heading"><strong>{offCategory === "INTERNET" ? "Internet turned off" : "Phone off"}</strong><span>{drillEmployees.length} employee{drillEmployees.length === 1 ? "" : "s"}</span></div>
        {!drillEmployees.length ? <div className="empty-panel">No employees currently match this condition.</div> : <div className="health-off-employee-grid">
          {drillEmployees.map(person => <article className="health-off-employee-card" key={person.key}>
            <div className="health-off-person">
              <EmployeeAvatar employeeId={person.employee_id} employeeName={person.employee_name} photoUpdatedAt={person.profile_photo_updated_at} size="lg"/>
              <div><strong>{person.employee_name}</strong><span>{person.employee_id || "Employee ID unavailable"}</span><small>{person.department_name}</small></div>
              <StatusBadge value={offCategory === "INTERNET" ? "OFF" : "OFF CONFIRMED"}/>
            </div>
            <div className="health-off-device-list">
              {person.devices.map(device => {
                const simLines = [...(device.lines || [])].sort((a,b) => (a.sim_slot_index ?? 99) - (b.sim_slot_index ?? 99));
                return <div className="health-off-device" key={device.device_id}>
                  <div className="health-off-device-head"><div><span>Device</span><strong>{device.device_id}</strong></div><div><span>Last verified signal</span><strong>{when(device.last_seen)}</strong></div></div>
                  <div className="health-off-sims">
                    {simLines.length ? simLines.map((line,index) => <div key={line.id}><span>{line.line_label || `SIM ${(line.sim_slot_index ?? index) + 1}`}</span><strong>{line.phone_number}</strong><small>{line.carrier_name || "Carrier unavailable"}</small></div>) : device.company_phone_number ? <div><span>Company SIM</span><strong>{device.company_phone_number}</strong><small>SIM slot unavailable</small></div> : <div className="health-off-no-sim"><span>Company SIM</span><strong>Not registered</strong></div>}
                  </div>
                </div>;
              })}
            </div>
          </article>)}
        </div>}
      </>}
    </section>}

    <div className="filter-bar health-filters">
      <input aria-label="Search phones" placeholder="Find a phone, employee, or version" value={search} onChange={e => setSearch(e.target.value)}/>
      <select aria-label="Department" value={department} onChange={e => {setDepartment(e.target.value);setEmployee("ALL");}}>
        <option value="ALL">All departments</option>
        {departments.map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select>
      <select aria-label="Employee" value={employee} onChange={e=>setEmployee(e.target.value)}>
        <option value="ALL">All employees</option>
        {employees.map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select>
      <select aria-label="Update status" value={updateFilter} onChange={e=>setUpdateFilter(e.target.value)}>
        <option value="ALL">All update states</option>
        <option value="UP_TO_DATE">Up to date only</option>
        <option value="CAN_UPDATE">Can be updated</option>
        <option value="ATTENTION">Needs attention</option>
      </select>
    </div>
    {error && <div className="error-banner" role="alert">Current status unavailable. {error}</div>}{notice && <div className="notice-banner" role="status">{notice}</div>}
    <div className="table-card"><div className="table-meta"><span>{visible.length} phones</span><span>Updated {when(refreshed)} IST</span></div><div className="table-scroll"><table className="device-table"><thead><tr><th>Phone / Employee</th><th>Installed App & Update</th><th>Phone state</th><th>Working</th><th>Internet</th><th>Last signal</th><th>Manual check</th><th></th></tr></thead><tbody>
      {loading ? <tr><td colSpan={8} className="empty-state">Loading phones…</td></tr> : !visible.length ? <tr><td colSpan={8} className="empty-state">No phones match this view.</td></tr> : visible.map(row => <DeviceRow key={row.device_id} row={row} admin={user.role === "ADMIN"} busy={!!busy || row.check_status === "PENDING"} onCheck={() => void check(row.device_id)}/>)}
    </tbody></table></div></div>
  </>;
}

function DeviceRow({row,admin,busy,onCheck}:{row:DeviceHealthView;admin:boolean;busy:boolean;onCheck:()=>void}) {
  const [open,setOpen] = useState(false);
  const d = row.details;
  const u = row.update_info;
  const values: [string,unknown][] = [
    ["Phone model", row.device_model || d?.device_model || "Unknown model"],
    ["Fireblade App version", row.apk_version || d?.apk_version || "Not installed / unknown"],
    ["App build code", d?.app_version_code ? `Build ${d.app_version_code}` : "Unknown"],
    ["Collector state", d?.collector_state || "No signal"],
    ["Battery", d?.battery_percent == null ? "Unknown" : `${d.battery_percent}%${d?.charging ? " (Charging)" : ""}`],
    ["Network", d?.network_type || "Unknown"],
    ["Wi-Fi", truth(d?.wifi_connected)],
    ["Cellular", truth(d?.cellular_connected)],
    ["Mobile-data setting", row.mobile_data_status || "Unknown"],
    ["Pending uploads", d?.pending_uploads ?? 0],
    ["Last call sync", when(d?.last_call_sync_epoch_ms)],
    ["SIM 1 state", d?.sim1_state || "Unknown"],
    ["SIM 2 state", d?.sim2_state || "Unknown"],
    ["Default data SIM", d?.default_data_sim_slot == null ? "Unknown" : `SIM ${d.default_data_sim_slot + 1}`],
    ["Last phone boot", when(d?.boot_epoch_ms)],
    ["Android OS", d?.android_version ? `Android ${d.android_version}` : "Unknown"],
    ["Credential verified", d?.source_verified ? "Yes" : "No"],
    ["Last reported event", d?.event_type || "None"],
    ["Check request ID", row.check?.request_id || "None"],
    ["Check push delivery", row.check?.delivery_status || "None"],
    ["Check requested", when(row.check?.requested_at)],
    ["Check response", when(row.check?.responded_at)]
  ];

  const updateBadgeVal =
    u?.stage === "CURRENT" ? "UP TO DATE" :
    u?.stage === "AVAILABLE" ? "UPDATE AVAILABLE" :
    u?.stage === "AWAITING_INSTALL" ? "INSTALL PENDING" :
    u?.stage === "DOWNLOADING" ? "DOWNLOADING" :
    u?.stage === "FAILED" ? "FAILED" :
    u?.stage === "NOT_INSTALLED" ? "NOT INSTALLED" :
    u?.stage || "UNKNOWN";

  return (
    <>
      <tr>
        <td>
          <div className="employee-inline">
            <EmployeeAvatar employeeId={row.employee_id} employeeName={row.employee_name || "Unassigned"} photoUpdatedAt={row.profile_photo_updated_at} size="xs"/>
            <div>
              <button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
                {row.device_id}
              </button>
              <small>{row.employee_name || "Unassigned"} · {row.department_name}</small>
            </div>
          </div>
        </td>
        <td>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "13px" }}>{row.apk_version ? `v${row.apk_version}` : "Not installed"}</strong>
              <StatusBadge value={updateBadgeVal}/>
            </div>
            <small style={{ color: "var(--muted)", fontSize: "11px" }}>
              {u?.can_update && u.target_version
                ? `Can update → v${u.target_version}`
                : u?.stage === "CURRENT"
                ? `Up to date (Build ${u?.installed_code ?? "—"})`
                : u?.message || "No update info"}
            </small>
          </div>
        </td>
        <td><StatusBadge value={row.state || "UNKNOWN"}/></td>
        <td><StatusBadge value={row.phone_working || "UNKNOWN"}/></td>
        <td><StatusBadge value={row.internet_status || "UNKNOWN"}/></td>
        <td>{when(row.last_seen)}</td>
        <td><StatusBadge value={row.check_status === "NONE" ? "NOT CHECKED" : row.check_status || "NOT CHECKED"}/></td>
        <td>
          <button className="mini-button" disabled={busy} onClick={onCheck}>
            {row.check_status === "PENDING" ? "Checking…" : "Check Now"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={8}>
            <div className="detail-heading">
              <div>
                <h2>{row.device_id} · App & Phone Diagnostics</h2>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px" }}>
                  {row.device_model || "Phone model unknown"} · {row.apk_version ? `Fireblade App v${row.apk_version}` : "App version not reported"} · Assigned to {row.employee_name || "Unassigned"} ({row.department_name})
                </p>
              </div>
              <button className="secondary-button" onClick={() => setOpen(false)}>Close details</button>
            </div>

            {/* App Version & Update Status Diagnostics */}
            <div style={{
              background: "#fbfbfc",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              padding: "16px 20px",
              margin: "14px 0",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "14px"
            }}>
              <div>
                <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, display: "block" }}>
                  Installed App
                </span>
                <strong style={{ fontSize: "14px", marginTop: "2px", display: "block" }}>
                  {row.apk_version ? `Fireblade v${row.apk_version}` : "Not installed"}
                </strong>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  {u?.installed_code ? `Build code ${u.installed_code}` : "No build code reported"}
                </small>
              </div>

              <div>
                <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, display: "block" }}>
                  Can Update / Target
                </span>
                <strong style={{ fontSize: "14px", marginTop: "2px", display: "block" }}>
                  {u?.can_update
                    ? `Yes · Target v${u.target_version || "Latest"}`
                    : u?.stage === "CURRENT"
                    ? `No · Already up to date`
                    : "No update applicable"}
                </strong>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  {u?.target_code ? `Target build ${u.target_code}` : "—"}
                </small>
              </div>

              <div>
                <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, display: "block" }}>
                  Update Status
                </span>
                <div style={{ marginTop: "4px" }}>
                  <StatusBadge value={updateBadgeVal}/>
                </div>
                <small style={{ color: "var(--muted)", fontSize: "12px", display: "block", marginTop: "4px" }}>
                  {u?.message || (u?.stage === "CURRENT" ? "Running latest release" : "—")}
                </small>
              </div>

              <div>
                <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, display: "block" }}>
                  Last Update Check
                </span>
                <strong style={{ fontSize: "13px", marginTop: "2px", display: "block" }}>
                  {when(u?.last_checked_at)}
                </strong>
                <small style={{ color: "var(--muted)", fontSize: "12px" }}>
                  Signal: {when(row.last_seen)}
                </small>
              </div>
            </div>

            <div className="sim-lines">
              {row.lines?.length ? (
                row.lines.map(l => (
                  <div key={l.id}>
                    <strong>{l.phone_number}</strong>
                    <span>SIM {(l.sim_slot_index ?? 0) + 1} · {l.carrier_name || "Carrier unknown"}</span>
                  </div>
                ))
              ) : (
                <div style={{ background: "white", border: "1px solid var(--line)", borderRadius: "8px", padding: "14px 20px" }}>
                  <strong>{row.company_phone_number || "Company number not registered"}</strong>
                  <span style={{ display: "block", fontSize: "13px", color: "var(--muted)" }}>Registered company SIM</span>
                </div>
              )}
            </div>

            {d?.collector_message && d.collector_message !== "Normal" && (
              <div className="notice-banner" style={{ background: "#fff7eb", color: "#8a4b08", border: "1px solid #ffd699", margin: "14px 0" }}>
                <strong>Collector App Notice:</strong> {d.collector_message}
              </div>
            )}

            {!d ? (
              <div className="notice-banner" style={{ margin: "16px 0" }}>
                <strong>No telemetry received yet from the Fireblade Collector app on this phone.</strong>
                <p style={{ margin: "6px 0 0", fontSize: "13px" }}>
                  Ensure the Fireblade Collector APK is installed on this device, opened, and has active internet access. Click <strong>Check Now</strong> above to send an immediate status check.
                </p>
              </div>
            ) : (
              <>
                <dl className="diagnostic-grid">
                  {values.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v == null ? "Unknown" : String(v)}</dd>
                    </div>
                  ))}
                </dl>

                {d?.permission_state && (
                  <div style={{ margin: "18px 0" }}>
                    <span style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>
                      App Permissions Status
                    </span>
                    <div className="permission-list">
                      {Object.entries(d.permission_state).map(([k, v]) => (
                        <span key={k}>
                          {k.replaceAll("_", " ")} <StatusBadge value={v ? "GRANTED" : "MISSING"}/>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {admin && (
              <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
                <Link className="secondary-button" href={`/admin/audit?subject=${encodeURIComponent(row.device_id)}`}>
                  View audit & check history
                </Link>
                <Link className="secondary-button" href="/admin/updates">
                  Manage App Updates & Releases
                </Link>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
