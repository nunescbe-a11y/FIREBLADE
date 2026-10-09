"use client";

import DashboardInformationSent from "@/components/DashboardInformationSent";
import DashboardShaneHandover from "@/components/DashboardShaneHandover";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DeviceHealthView, FirebladeEmployee, IncomingCall, SessionUser, TeamRegistry } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { when } from "@/lib/date";
import ManagementPerformanceClient from "@/components/ManagementPerformanceClient";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import ManagementWelcomeCard from "@/components/ManagementWelcomeCard";

const EMPTY_REGISTRY: TeamRegistry = { employees: [], devices: [], assignments: [], lines: [] };
type Department = { id: string; name: string };
type CallMetric = "INCOMING" | "ANSWERED" | "MISSED" | "PENDING" | "COMPLETED";
type DeviceMetric = "COMPANY" | "WORKING" | "OFF" | "CHECK";

type CountOption = { id: string; name: string; count: number };

function isDeviceOffForManagement(device: DeviceHealthView) {
  return device.state === "OFF CONFIRMED" || device.internet_disconnected === true;
}

function MetricCard({ label, value, active, clickable, onClick }: {
  label: string;
  value: number | string;
  active?: boolean;
  clickable?: boolean;
  onClick?: () => void;
}) {
  if (!clickable) return <div className="stat-card"><span>{label}</span><strong>{value}</strong></div>;
  return <button type="button" className={`stat-card dashboard-stat-button${active ? " selected" : ""}`} onClick={onClick} aria-pressed={active}>
    <span>{label}</span><strong>{value}</strong>
  </button>;
}

export default function DashboardClient({ user }: { user: SessionUser }) {
  const canManage = user.role === "ADMIN" || user.role === "MANAGEMENT";
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [registry, setRegistry] = useState<TeamRegistry>(EMPTY_REGISTRY);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [devices, setDevices] = useState<DeviceHealthView[]>([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] = useState(canManage);
  const [callsError, setCallsError] = useState("");
  const [devicesError, setDevicesError] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkNotice, setCheckNotice] = useState("");

  const [callMetric, setCallMetric] = useState<CallMetric | null>(null);
  const [callDepartment, setCallDepartment] = useState("");
  const [callEmployee, setCallEmployee] = useState("");
  const [deviceMetric, setDeviceMetric] = useState<DeviceMetric | null>(null);
  const [deviceDepartment, setDeviceDepartment] = useState("");
  const [deviceEmployee, setDeviceEmployee] = useState("");
  const [productDrilldown, setProductDrilldown] = useState("");
  const [productDepartment, setProductDepartment] = useState("");
  const [productEmployee, setProductEmployee] = useState("");

  const loadCalls = useCallback(async () => {
    try {
      const r = await fetch("/api/calls?limit=5000&today=true", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not load calls");
      setCalls(j.calls || []);
      setRegistry(j.registry || EMPTY_REGISTRY);
      setCallsError("");
    } catch (e) {
      setCallsError(e instanceof Error ? e.message : "Could not load calls");
    } finally {
      setCallsLoading(false);
    }
  }, []);

  const loadManagement = useCallback(async () => {
    if (!canManage) return;
    try {
      const [healthResponse, departmentResponse] = await Promise.all([
        fetch("/api/device-health", { cache: "no-store", signal: AbortSignal.timeout(12000) }),
        fetch("/api/departments", { cache: "no-store", signal: AbortSignal.timeout(12000) }),
      ]);
      const health = await healthResponse.json();
      const departmentData = await departmentResponse.json();
      if (!healthResponse.ok) throw new Error(health.error || "Unable to retrieve device status");
      if (!departmentResponse.ok) throw new Error(departmentData.error || "Unable to retrieve departments");
      setDevices(health.devices || []);
      setDepartments(departmentData.departments || []);
      setDevicesError("");
    } catch (e) {
      setDevicesError(e instanceof Error ? e.message : "Unable to retrieve device status");
    } finally {
      setDevicesLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void loadCalls();
    if (canManage) void loadManagement();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadCalls();
      if (canManage) void loadManagement();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadCalls, loadManagement, canManage]);

  const checkAllPhones = async () => {
    setCheckBusy(true);
    setCheckNotice("");
    try {
      const response = await fetch("/api/device-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await response.json();
      if (!response.ok && !data.results) throw new Error(data.error || "Check failed");
      const results = data.results || [];
      const queued = results.filter((x: { error?: string }) => !x.error).length;
      const failed = results.length - queued;
      setCheckNotice(`${queued} phone check${queued === 1 ? "" : "s"} requested.${failed ? ` ${failed} could not be queued.` : ""} Statuses will refresh as phones respond.`);
      await loadManagement();
      // A short follow-up refresh catches normal FCM replies without making MD press another button.
      window.setTimeout(() => void loadManagement(), 3500);
      window.setTimeout(() => void loadManagement(), 8000);
    } catch (e) {
      setCheckNotice(e instanceof Error ? e.message : "Check failed");
    } finally {
      setCheckBusy(false);
    }
  };

  const hasHandledDetails = (call: IncomingCall) => Boolean(call.enquiry_id) && call.resolution_outcome !== "RECOVERED";
  const answered = calls.filter(c => c.direction === "INCOMING_ANSWERED").length;
  const pending = calls.filter(c => !hasHandledDetails(c)).length;
  const products = useMemo(() => {
    const counts = new Map<string, number>();
    calls.forEach(c => { if (hasHandledDetails(c) && c.product_name) counts.set(c.product_name, (counts.get(c.product_name) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [calls]);

  const employeeById = useMemo(() => new Map(registry.employees.map(e => [e.employee_id, e])), [registry.employees]);
  const activeAssignmentByDevice = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of registry.assignments.filter(a => !a.assigned_until)) {
      if (!map.has(assignment.device_id)) map.set(assignment.device_id, assignment.employee_id);
    }
    return map;
  }, [registry.assignments]);
  const departmentName = useMemo(() => new Map(departments.map(d => [d.id, d.name])), [departments]);

  const employeeForCall = useCallback((call: IncomingCall): FirebladeEmployee | undefined => {
    const id = call.registered_employee_id || activeAssignmentByDevice.get(call.device_id);
    return id ? employeeById.get(id) : undefined;
  }, [activeAssignmentByDevice, employeeById]);

  const productCalls = useMemo(
    () => productDrilldown ? calls.filter(call => call.product_name === productDrilldown) : [],
    [calls, productDrilldown],
  );

  const productDepartmentOptions = useMemo<CountOption[]>(() => {
    const counts = new Map<string, number>();
    for (const call of productCalls) {
      const employee = employeeForCall(call);
      const id = employee?.department_id || "UNASSIGNED";
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({
        id,
        name: id === "UNASSIGNED" ? "Unassigned" : departmentName.get(id) || "Department",
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [productCalls, employeeForCall, departmentName]);

  const productCallsInDepartment = useMemo(
    () => productCalls.filter(call => {
      if (!productDepartment) return false;
      const employee = employeeForCall(call);
      return (employee?.department_id || "UNASSIGNED") === productDepartment;
    }),
    [productCalls, productDepartment, employeeForCall],
  );

  const productEmployeeOptions = useMemo<CountOption[]>(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const call of productCallsInDepartment) {
      const employee = employeeForCall(call);
      const id = employee?.employee_id || "UNASSIGNED";
      const name = employee?.employee_name || call.registered_employee_name || call.received_by || "Unassigned";
      const old = counts.get(id);
      counts.set(id, { name, count: (old?.count || 0) + 1 });
    }
    return [...counts.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [productCallsInDepartment, employeeForCall]);

  const selectedProductCalls = useMemo(
    () => productCallsInDepartment.filter(call => {
      if (!productEmployee) return false;
      const employee = employeeForCall(call);
      return (employee?.employee_id || "UNASSIGNED") === productEmployee;
    }),
    [productCallsInDepartment, productEmployee, employeeForCall],
  );

  const callsForMetric = useMemo(() => {
    if (!callMetric) return [];
    return calls.filter(call => {
      if (callMetric === "INCOMING") return true;
      if (callMetric === "ANSWERED") return call.direction === "INCOMING_ANSWERED";
      if (callMetric === "MISSED") return call.direction === "INCOMING_MISSED";
      if (callMetric === "PENDING") return !hasHandledDetails(call);
      return hasHandledDetails(call);
    });
  }, [calls, callMetric]);

  const callDepartmentOptions = useMemo<CountOption[]>(() => {
    const counts = new Map<string, number>();
    for (const call of callsForMetric) {
      const employee = employeeForCall(call);
      const id = employee?.department_id || "UNASSIGNED";
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({ id, name: id === "UNASSIGNED" ? "Unassigned" : departmentName.get(id) || "Department", count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [callsForMetric, employeeForCall, departmentName]);

  const callsInSelectedDepartment = useMemo(() => callsForMetric.filter(call => {
    if (!callDepartment) return false;
    const employee = employeeForCall(call);
    return (employee?.department_id || "UNASSIGNED") === callDepartment;
  }), [callsForMetric, callDepartment, employeeForCall]);

  const callEmployeeOptions = useMemo<CountOption[]>(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const call of callsInSelectedDepartment) {
      const employee = employeeForCall(call);
      const id = employee?.employee_id || "UNASSIGNED";
      const name = employee?.employee_name || call.registered_employee_name || call.received_by || "Unassigned";
      const old = counts.get(id);
      counts.set(id, { name, count: (old?.count || 0) + 1 });
    }
    return [...counts.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [callsInSelectedDepartment, employeeForCall]);

  const selectedCalls = useMemo(() => callsInSelectedDepartment.filter(call => {
    if (!callEmployee) return false;
    const employee = employeeForCall(call);
    return (employee?.employee_id || "UNASSIGNED") === callEmployee;
  }), [callsInSelectedDepartment, callEmployee, employeeForCall]);

  const devicesForMetric = useMemo(() => {
    if (!deviceMetric) return [];
    return devices.filter(device => {
      if (deviceMetric === "COMPANY") return true;
      if (deviceMetric === "WORKING") return device.phone_working === "YES";
      if (deviceMetric === "OFF") return isDeviceOffForManagement(device);
      return device.phone_working === "UNKNOWN";
    });
  }, [devices, deviceMetric]);

  const deviceDepartmentOptions = useMemo<CountOption[]>(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const device of devicesForMetric) {
      const id = device.department_id || "UNASSIGNED";
      const name = device.department_name || "Unassigned";
      const old = counts.get(id);
      counts.set(id, { name, count: (old?.count || 0) + 1 });
    }
    return [...counts.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [devicesForMetric]);

  const devicesInSelectedDepartment = useMemo(() => devicesForMetric.filter(device => (device.department_id || "UNASSIGNED") === deviceDepartment), [devicesForMetric, deviceDepartment]);
  const deviceEmployeeOptions = useMemo<CountOption[]>(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const device of devicesInSelectedDepartment) {
      const id = device.employee_id || "UNASSIGNED";
      const name = device.employee_name || "Unassigned";
      const old = counts.get(id);
      counts.set(id, { name, count: (old?.count || 0) + 1 });
    }
    return [...counts.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [devicesInSelectedDepartment]);
  const selectedDevices = useMemo(() => devicesInSelectedDepartment.filter(device => (device.employee_id || "UNASSIGNED") === deviceEmployee), [devicesInSelectedDepartment, deviceEmployee]);

  const chooseCallMetric = (metric: CallMetric) => {
    setCallMetric(current => current === metric ? null : metric);
    setCallDepartment("");
    setCallEmployee("");
  };
  const chooseDeviceMetric = (metric: DeviceMetric) => {
    setDeviceMetric(current => current === metric ? null : metric);
    setDeviceDepartment("");
    setDeviceEmployee("");
  };

  const chooseProduct = (name: string) => {
    setProductDrilldown(current => current === name ? "" : name);
    setProductDepartment("");
    setProductEmployee("");
  };

  const callMetricLabel: Record<CallMetric, string> = { INCOMING: "Incoming Calls", ANSWERED: "Answered", MISSED: "Missed", PENDING: "Details Pending", COMPLETED: "Completed" };
  const deviceMetricLabel: Record<DeviceMetric, string> = { COMPANY: "Company Phones", WORKING: "Working", OFF: "Off Confirmed", CHECK: "Needs a Check" };

  return <>
    {user.role === "MANAGEMENT"
      ? <ManagementWelcomeCard user={user} />
      : <div className="page-header"><div><p className="eyebrow">Today - India time</p><h1>Overview</h1></div></div>}

    {canManage && <ManagementPerformanceClient />}

    <section className="overview-dashboard-section" aria-labelledby="overview-calls-heading">
      <div className="overview-section-heading"><div><p className="eyebrow">Incoming activity</p><h2 id="overview-calls-heading">Calls</h2></div><button className="secondary-button" disabled={callsLoading} onClick={() => void loadCalls()}>Refresh</button></div>
      {callsError && <div className="error-banner" role="alert">{callsError}</div>}
      <div className="stat-grid">
        <MetricCard label="Incoming calls" value={callsLoading || callsError ? "—" : calls.length} clickable={canManage} active={callMetric === "INCOMING"} onClick={() => chooseCallMetric("INCOMING")} />
        <MetricCard label="Answered" value={callsLoading || callsError ? "—" : answered} clickable={canManage} active={callMetric === "ANSWERED"} onClick={() => chooseCallMetric("ANSWERED")} />
        <MetricCard label="Missed" value={callsLoading || callsError ? "—" : calls.length - answered} clickable={canManage} active={callMetric === "MISSED"} onClick={() => chooseCallMetric("MISSED")} />
        <MetricCard label="Details pending" value={callsLoading || callsError ? "—" : pending} clickable={canManage} active={callMetric === "PENDING"} onClick={() => chooseCallMetric("PENDING")} />
        <MetricCard label="Completed" value={callsLoading || callsError ? "—" : calls.length - pending} clickable={canManage} active={callMetric === "COMPLETED"} onClick={() => chooseCallMetric("COMPLETED")} />
      </div>

      {canManage && callMetric && <section className="dashboard-drilldown" aria-label={`${callMetricLabel[callMetric]} drill-down`}>
        <div className="drilldown-title"><strong>{callMetricLabel[callMetric]}</strong><span>{callsForMetric.length} calls</span></div>
        {!callDepartmentOptions.length ? <div className="empty-panel">No departments have {callMetricLabel[callMetric].toLowerCase()} today.</div> : <>
          <div className="drilldown-controls">
            <label><span>Department</span><select value={callDepartment} onChange={e => { setCallDepartment(e.target.value); setCallEmployee(""); }}><option value="">Select department</option>{callDepartmentOptions.map(option => <option key={option.id} value={option.id}>{option.name} · {option.count}</option>)}</select></label>
            {callDepartment && <label><span>Employee</span><select value={callEmployee} onChange={e => setCallEmployee(e.target.value)}><option value="">Select employee</option>{callEmployeeOptions.map(option => <option key={option.id} value={option.id}>{option.name} · {option.count}</option>)}</select></label>}
          </div>
          {callDepartment && !callEmployee && <div className="drilldown-hint">Select an employee to see the matching calls.</div>}
          {callEmployee && <div className="table-scroll"><table className="overview-detail-table"><thead><tr><th>Date / Time</th><th>Customer Number</th><th>Employee</th><th>Call</th><th>Duration</th><th>Details</th></tr></thead><tbody>{selectedCalls.map(call => <tr key={call.call_id}><td>{formatIST(call.started_at_epoch_ms)}</td><td><strong>{call.phone_number_normalized || call.phone_number_raw || "Unknown"}</strong><small>{call.person_name || call.company_name || ""}</small></td><td>{(() => { const emp = employeeForCall(call); const name = emp?.employee_name || call.received_by || "Unassigned"; return <div className="employee-inline"><EmployeeAvatar employeeId={emp?.employee_id || call.registered_employee_id} employeeName={name} photoUpdatedAt={emp?.profile_photo_updated_at} size="xs"/><span>{name}</span></div>; })()}</td><td><span className={`status-pill ${call.direction === "INCOMING_ANSWERED" ? "success" : "warning"}`}>{cleanStatus(call.direction).replace("Incoming ", "")}</span></td><td>{formatDuration(call.duration_seconds)}</td><td>{hasHandledDetails(call) ? "Completed" : "Pending"}</td></tr>)}</tbody></table></div>}
        </>}
      </section>}
    </section>

    {canManage && <section className="overview-dashboard-section" aria-labelledby="overview-health-heading">
      <div className="overview-section-heading"><div><p className="eyebrow">Company phones</p><h2 id="overview-health-heading">Device Health</h2></div><button className="primary-button" disabled={checkBusy || devicesLoading || !devices.length} onClick={() => void checkAllPhones()}>{checkBusy ? "Requesting…" : "Check All Phones"}</button></div>
      {devicesError && <div className="error-banner" role="alert">{devicesError}</div>}
      {checkNotice && <div className="notice-banner" role="status">{checkNotice}</div>}
      <div className="health-summary-grid">
        <MetricCard label="Company phones" value={devicesLoading || devicesError ? "—" : devices.length} clickable active={deviceMetric === "COMPANY"} onClick={() => chooseDeviceMetric("COMPANY")} />
        <MetricCard label="Working" value={devicesLoading || devicesError ? "—" : devices.filter(d => d.phone_working === "YES").length} clickable active={deviceMetric === "WORKING"} onClick={() => chooseDeviceMetric("WORKING")} />
        <MetricCard label="Off confirmed" value={devicesLoading || devicesError ? "—" : devices.filter(isDeviceOffForManagement).length} clickable active={false} onClick={() => { window.location.href = "/device-health?drill=off"; }} />
        <MetricCard label="Needs a check" value={devicesLoading || devicesError ? "—" : devices.filter(d => d.phone_working === "UNKNOWN").length} clickable active={deviceMetric === "CHECK"} onClick={() => chooseDeviceMetric("CHECK")} />
      </div>

      {deviceMetric && <section className="dashboard-drilldown" aria-label={`${deviceMetricLabel[deviceMetric]} drill-down`}>
        <div className="drilldown-title"><strong>{deviceMetricLabel[deviceMetric]}</strong><span>{devicesForMetric.length} phones</span></div>
        {!deviceDepartmentOptions.length ? <div className="empty-panel">No departments currently match {deviceMetricLabel[deviceMetric].toLowerCase()}.</div> : <>
          <div className="drilldown-controls">
            <label><span>Department</span><select value={deviceDepartment} onChange={e => { setDeviceDepartment(e.target.value); setDeviceEmployee(""); }}><option value="">Select department</option>{deviceDepartmentOptions.map(option => <option key={option.id} value={option.id}>{option.name} · {option.count}</option>)}</select></label>
            {deviceDepartment && <label><span>Employee</span><select value={deviceEmployee} onChange={e => setDeviceEmployee(e.target.value)}><option value="">Select employee</option>{deviceEmployeeOptions.map(option => <option key={option.id} value={option.id}>{option.name} · {option.count}</option>)}</select></label>}
          </div>
          {deviceDepartment && !deviceEmployee && <div className="drilldown-hint">Select an employee to see the matching phone.</div>}
          {deviceEmployee && <div className="table-scroll"><table className="overview-detail-table"><thead><tr><th>Phone / Employee</th><th>Phone State</th><th>Working</th><th>Internet</th><th>Last Signal</th><th></th></tr></thead><tbody>{selectedDevices.map(device => <tr key={device.device_id}><td><div className="employee-inline"><EmployeeAvatar employeeId={device.employee_id} employeeName={device.employee_name || "Unassigned"} photoUpdatedAt={device.profile_photo_updated_at} size="xs"/><div><strong>{device.device_id}</strong><small>{device.employee_name || "Unassigned"} · {device.department_name || "Unassigned"}</small></div></div></td><td><StatusBadge value={device.state || "UNKNOWN"}/></td><td><StatusBadge value={device.phone_working || "UNKNOWN"}/></td><td><StatusBadge value={device.internet_status || "UNKNOWN"}/></td><td>{when(device.last_seen)}</td><td><Link className="secondary-button" href={`/device-health?employee=${encodeURIComponent(device.employee_id || "")}`}>View details</Link></td></tr>)}</tbody></table></div>}
        </>}
      </section>}
    </section>}

    {canManage && <DashboardShaneHandover />}
    {canManage && <DashboardInformationSent />}
  </>;
}
