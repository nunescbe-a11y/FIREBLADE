"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import { formatDuration, formatIST } from "@/lib/format";

type SimPerformanceRow = {
  line_id: number;
  device_id: string;
  sim_slot_index: number | null;
  company_phone_number: string | null;
  line_label: string | null;
  carrier_name: string | null;
  total_incoming: number;
  answered_calls: number;
  missed_calls: number;
  called_back: number;
  pending_callbacks: number;
  callback_rate: number;
  average_callback_minutes: number | null;
};

type PerformanceRow = {
  employee_id: string;
  employee_name: string;
  department_id: string | null;
  department_name: string;
  profile_photo_updated_at: string | null;
  total_incoming: number;
  answered_calls: number;
  missed_calls: number;
  called_back: number;
  pending_callbacks: number;
  callback_rate: number;
  average_callback_minutes: number | null;
  department_total_incoming: number;
  sims: SimPerformanceRow[];
};

type Metric = "TOTAL" | "ANSWERED" | "MISSED" | "CALLED_BACK" | "PENDING";
type Preset = "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "CUSTOM";

type CallDetail = {
  call_id: number;
  device_id: string;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  contact_name: string | null;
  direction: string;
  started_at_epoch_ms: number;
  duration_seconds: number;
  line_id?: number | null;
  company_phone_number?: string | null;
  line_label?: string | null;
  sim_slot_index?: number | null;
};

type CallbackDetail = {
  missed_call_id: number;
  missed_device_id: string;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  missed_at_epoch_ms: number;
  callback_at_epoch_ms: number | null;
  callback_device_id: string | null;
  callback_duration_seconds: number | null;
  callback_status: string;
  callback_minutes: number | null;
  missed_line_id?: number | null;
  company_phone_number?: string | null;
  line_label?: string | null;
  sim_slot_index?: number | null;
};

function istDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function shiftDate(date: string, days: number) {
  return istDate(Date.parse(`${date}T12:00:00+05:30`) + days * 86_400_000);
}

function rangeFor(preset: Preset) {
  const today = istDate();
  if (preset === "TODAY") return { from: today, to: today };
  if (preset === "YESTERDAY") {
    const d = shiftDate(today, -1);
    return { from: d, to: d };
  }
  if (preset === "MONTH") return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === "WEEK") {
    const noon = new Date(`${today}T12:00:00+05:30`);
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
    }).format(noon);
    const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(day);
    return { from: shiftDate(today, -Math.max(index, 0)), to: today };
  }
  return { from: today, to: today };
}

const METRIC_LABEL: Record<Metric, string> = {
  TOTAL: "Total Incoming Calls",
  ANSWERED: "Answered Calls",
  MISSED: "Missed Calls",
  CALLED_BACK: "Resolved",
  PENDING: "Still Pending",
};

function simLabel(sim: SimPerformanceRow) {
  const slot = sim.sim_slot_index == null
    ? (sim.line_label || "SIM")
    : `SIM ${sim.sim_slot_index + 1}`;
  return `${slot} - ${sim.company_phone_number || sim.device_id}`;
}

export default function ManagementPerformanceClient() {
  const [preset, setPreset] = useState<Preset>("MONTH");
  const initial = rangeFor("MONTH");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("");
  const [employee, setEmployee] = useState("");
  const [simByEmployee, setSimByEmployee] = useState<Record<string, string>>({});
  const [detailMetric, setDetailMetric] = useState<Metric | null>(null);
  const [detailKind, setDetailKind] = useState<"CALL" | "CALLBACK" | null>(null);
  const [detailRows, setDetailRows] = useState<Array<CallDetail | CallbackDetail>>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setDetailMetric(null);
    setDetailRows([]);
    try {
      const q = new URLSearchParams({ from, to });
      const r = await fetch(`/api/management/performance?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load employee performance");
      setRows(j.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load employee performance");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const departments = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      people: number;
      total: number;
      missed: number;
      pending: number;
    }>();

    for (const r of rows) {
      const id = r.department_id || "UNASSIGNED";
      const current = map.get(id) || {
        id,
        name: r.department_name || "Unassigned",
        people: 0,
        total: Number(r.department_total_incoming || 0),
        missed: 0,
        pending: 0,
      };
      current.people += 1;
      current.total = Number(r.department_total_incoming || 0);
      current.missed += Number(r.missed_calls || 0);
      current.pending += Number(r.pending_callbacks || 0);
      map.set(id, current);
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const employees = useMemo(
    () =>
      rows
        .filter(r => (r.department_id || "UNASSIGNED") === department)
        .sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
    [rows, department],
  );

  const selected = rows.find(r => r.employee_id === employee) || null;
  const selectedDepartment = departments.find(d => d.id === department);
  const selectedLineId = selected ? (simByEmployee[selected.employee_id] || "") : "";
  const selectedSim = selected && selectedLineId
    ? selected.sims.find(sim => String(sim.line_id) === selectedLineId) || null
    : null;
  const selectedMetrics = selectedSim || selected;

  const choosePreset = (next: Preset) => {
    setPreset(next);
    setDepartment("");
    setEmployee("");
    setDetailMetric(null);
    if (next !== "CUSTOM") {
      const range = rangeFor(next);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const chooseSim = (employeeId: string, lineId: string) => {
    setSimByEmployee(current => ({ ...current, [employeeId]: lineId }));
    if (employee === employeeId) {
      setDetailMetric(null);
      setDetailRows([]);
    }
  };

  const openMetric = async (metric: Metric) => {
    if (!selected) return;
    setDetailMetric(metric);
    setDetailLoading(true);
    setDetailRows([]);
    setError("");

    try {
      const q = new URLSearchParams({ employee: selected.employee_id, metric, from, to });
      if (selectedLineId) q.set("line", selectedLineId);
      const r = await fetch(`/api/management/performance/details?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load call details");
      setDetailKind(j.kind);
      setDetailRows(j.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load call details");
    } finally {
      setDetailLoading(false);
    }
  };

  return <section className="management-performance" aria-labelledby="employee-performance-heading">
    <div className="overview-section-heading performance-heading">
      <div><p className="eyebrow">Admin & Management</p><h2 id="employee-performance-heading">Employee Call Performance</h2><p>Department - Employee - SIM - incoming, missed and callback performance.</p></div>
      <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</button>
    </div>

    <div className="performance-range-bar" style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "#f1f5f9", padding: "3px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          {(["TODAY", "YESTERDAY", "WEEK", "MONTH"] as const).map(p => (
            <button
              key={p}
              type="button"
              style={{
                border: 0,
                background: preset === p ? "var(--primary)" : "transparent",
                color: preset === p ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => choosePreset(p)}
            >
              {p === "TODAY" ? "Today" : p === "YESTERDAY" ? "Yesterday" : p === "WEEK" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
        <label>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>Period</span>
          <select value={preset} onChange={e => choosePreset(e.target.value as Preset)}>
            <option value="TODAY">Today</option>
            <option value="YESTERDAY">Yesterday</option>
            <option value="WEEK">This Week</option>
            <option value="MONTH">This Month</option>
            <option value="CUSTOM">Custom Range</option>
          </select>
        </label>
        {preset === "CUSTOM" && (
          <>
            <label><span>From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label><span>To</span><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
          </>
        )}
      </div>
      <div className="performance-date-caption">
        <span>Reporting period</span>
        <strong>{from === to ? from : `${from} - ${to}`}</strong>
        <small>India time</small>
      </div>
    </div>

    {error && <div className="error-banner" role="alert">{error}</div>}

    {!department && <div className="performance-step">
      <div className="performance-step-title"><div><span>1</span><div><strong>Select Department</strong><small>Choose the team you want to review.</small></div></div></div>
      <div className="department-grid performance-department-grid">{departments.map(d=><button type="button" className="department-card" key={d.id} onClick={()=>{setDepartment(d.id);setEmployee("");setDetailMetric(null)}}><h2>{d.name}</h2><strong>{loading ? "-" : d.total}</strong><span>unique incoming customers - {d.people} employees</span><small>{d.missed} missed - {d.pending} still pending</small></button>)}</div>
      {!loading && !departments.length && <div className="empty-panel">No active employees are available for this report.</div>}
    </div>}

    {department && !employee && <div className="performance-step">
      <div className="performance-step-title"><div><span>2</span><div><strong>{selectedDepartment?.name || "Department"} - Select Employee</strong><small>Select All SIMs or one company SIM to review exact line-wise data.</small></div></div><button className="text-button" onClick={()=>setDepartment("")}>Back to Departments</button></div>
      <div className="performance-employee-grid">{employees.map(e=>{
        const lineId=simByEmployee[e.employee_id]||"";
        const sim=lineId?e.sims.find(item=>String(item.line_id)===lineId)||null:null;
        const metrics=sim||e;
        return <div className="performance-employee-card" key={e.employee_id} role="button" tabIndex={0} onClick={()=>{setEmployee(e.employee_id);setDetailMetric(null)}} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setEmployee(e.employee_id);setDetailMetric(null)}}}>
          <EmployeeAvatar employeeId={e.employee_id} employeeName={e.employee_name} photoUpdatedAt={e.profile_photo_updated_at} size="lg"/>
          <div className="performance-employee-identity"><strong>{e.employee_name}</strong><span>{e.employee_id}</span><small>{e.sims.length?e.sims.map(item=>item.company_phone_number||item.device_id).join(" / "):"No active SIM mapped"}</small></div>
          <label style={{display:"grid",gap:4,minWidth:180}} onClick={event=>event.stopPropagation()}><small>SIM / Company Number</small><select value={lineId} onChange={event=>{event.stopPropagation();chooseSim(e.employee_id,event.target.value)}}><option value="">All SIMs</option>{e.sims.map(item=><option key={item.line_id} value={String(item.line_id)}>{simLabel(item)}</option>)}</select></label>
          <div className="performance-mini-metrics"><span><b>{metrics.total_incoming}</b>Total</span><span><b>{metrics.answered_calls}</b>Answered</span><span><b>{metrics.missed_calls}</b>Missed</span><span><b>{metrics.pending_callbacks}</b>Pending</span></div>
        </div>;
      })}</div>
    </div>}

    {selected && selectedMetrics && <div className="performance-step employee-performance-detail">
      <div className="performance-step-title"><div><span>3</span><div><strong>Employee Performance</strong><small>Click a metric to drill down to the actual calls.</small></div></div><button className="text-button" onClick={()=>{setEmployee("");setDetailMetric(null);setDetailRows([])}}>Back to Employees</button></div>
      <div className="employee-performance-hero">
        <EmployeeAvatar employeeId={selected.employee_id} employeeName={selected.employee_name} photoUpdatedAt={selected.profile_photo_updated_at} size="xl"/>
        <div><p className="eyebrow">{selected.department_name}</p><h3>{selected.employee_name}</h3><p>{selected.employee_id} - {from === to ? from : `${from} to ${to}`}</p><p>{selectedSim?`Selected: ${simLabel(selectedSim)}`:`All SIMs: ${selected.sims.map(sim=>sim.company_phone_number||sim.device_id).join(" / ")||"No mapped SIM"}`}</p></div>
        <label style={{marginLeft:"auto",display:"grid",gap:4,minWidth:220}}><span>SIM / Company Number</span><select value={selectedLineId} onChange={event=>chooseSim(selected.employee_id,event.target.value)}><option value="">All SIMs</option>{selected.sims.map(sim=><option key={sim.line_id} value={String(sim.line_id)}>{simLabel(sim)}</option>)}</select></label>
      </div>

      <div className="performance-metric-grid">
        <button className={`performance-metric ${detailMetric==="TOTAL"?"selected":""}`} onClick={()=>void openMetric("TOTAL")}><span>Total Incoming Calls</span><strong>{selectedMetrics.total_incoming}</strong></button>
        <button className={`performance-metric ${detailMetric==="ANSWERED"?"selected":""}`} onClick={()=>void openMetric("ANSWERED")}><span>Answered Calls</span><strong>{selectedMetrics.answered_calls}</strong></button>
        <button className={`performance-metric ${detailMetric==="MISSED"?"selected":""}`} onClick={()=>void openMetric("MISSED")}><span>Missed Calls</span><strong>{selectedMetrics.missed_calls}</strong></button>
        <button className={`performance-metric ${detailMetric==="CALLED_BACK"?"selected":""}`} onClick={()=>void openMetric("CALLED_BACK")}><span>Resolved</span><strong>{selectedMetrics.called_back}</strong></button>
        <button className={`performance-metric ${detailMetric==="PENDING"?"selected":""}`} onClick={()=>void openMetric("PENDING")}><span>Still Pending</span><strong>{selectedMetrics.pending_callbacks}</strong></button>
        <div className="performance-metric static"><span>Resolution Rate</span><strong>{selectedMetrics.callback_rate}%</strong></div>
        <div className="performance-metric static"><span>Avg. Resolution Time</span><strong className="text-stat">{selectedMetrics.average_callback_minutes==null?"-":`${selectedMetrics.average_callback_minutes} min`}</strong></div>
      </div>

      {detailMetric && <div className="performance-detail-table"><div className="panel-heading"><h3>{METRIC_LABEL[detailMetric]} - {selected.employee_name}{selectedSim?` - ${simLabel(selectedSim)}`:" - All SIMs"}</h3><span>{detailLoading?"Loading...":`${detailRows.length} record${detailRows.length===1?"":"s"}`}</span></div><div className="table-scroll">
        {detailKind==="CALL"?<table><thead><tr><th>Date / Time</th><th>Customer</th><th>Call</th><th>Duration</th><th>SIM / Device</th></tr></thead><tbody>{detailLoading?<tr><td colSpan={5} className="empty-state">Loading calls...</td></tr>:!detailRows.length?<tr><td colSpan={5} className="empty-state">No matching calls.</td></tr>:(detailRows as CallDetail[]).map(r=><tr key={r.call_id}><td>{formatIST(r.started_at_epoch_ms)}</td><td><strong className="phone">{r.phone_number_normalized||r.phone_number_raw||"Unknown"}</strong><small>{r.contact_name||""}</small></td><td><span className={`status-pill ${r.direction==="INCOMING_ANSWERED"?"success":"warning"}`}>{r.direction==="INCOMING_ANSWERED"?"Answered":"Missed"}</span></td><td>{formatDuration(r.duration_seconds)}</td><td><strong>{r.company_phone_number||r.device_id}</strong><small>{r.sim_slot_index==null?(r.line_label||""):`SIM ${r.sim_slot_index+1}`}</small></td></tr>)}</tbody></table>
        :<table><thead><tr><th>Missed At</th><th>Customer</th><th>Status</th><th>Resolved At</th><th>Response</th><th>SIM / Device</th></tr></thead><tbody>{detailLoading?<tr><td colSpan={6} className="empty-state">Loading callbacks...</td></tr>:!detailRows.length?<tr><td colSpan={6} className="empty-state">No matching callbacks.</td></tr>:(detailRows as CallbackDetail[]).map(r=><tr key={r.missed_call_id}><td>{formatIST(r.missed_at_epoch_ms)}</td><td><strong className="phone">{r.phone_number_normalized||r.phone_number_raw||"Unknown"}</strong></td><td><span className={`status-pill ${r.callback_status==="RESOLVED"?"success":"warning"}`}>{r.callback_status==="RESOLVED"?"Resolved":"Pending"}</span></td><td>{r.callback_at_epoch_ms?formatIST(r.callback_at_epoch_ms):"-"}</td><td>{r.callback_minutes==null?"-":`${r.callback_minutes} min`}</td><td><strong>{r.company_phone_number||r.missed_device_id}</strong><small>{r.sim_slot_index==null?(r.line_label||""):`SIM ${r.sim_slot_index+1}`}</small>{r.callback_device_id&&<small>Resolved via: {r.callback_device_id}</small>}</td></tr>)}</tbody></table>}
      </div></div>}
    </div>}
  </section>;
}

