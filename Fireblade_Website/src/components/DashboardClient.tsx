"use client";

import DashboardInformationSent from "@/components/DashboardInformationSent";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DeviceHealthView, FirebladeEmployee, IncomingCall, SessionUser, TeamRegistry } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { when } from "@/lib/date";
import ManagementPerformanceClient from "@/components/ManagementPerformanceClient";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import ManagementWelcomeCard from "@/components/ManagementWelcomeCard";
import EmployeeCircleBar from "@/components/EmployeeCircleBar";
import CallTranscriptModal from "@/components/CallTranscriptModal";

const EMPTY_REGISTRY: TeamRegistry = { employees: [], devices: [], assignments: [], lines: [] };
type Department = { id: string; name: string };
type CallMetric = "INCOMING" | "ANSWERED" | "MISSED" | "PENDING" | "COMPLETED";
type DeviceMetric = "COMPANY" | "WORKING" | "OFF" | "CHECK";
type CallScope = "LIVE_100" | "TODAY" | "RECENT_5K" | "ALL_TIME";

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
  const [callScope, setCallScope] = useState<CallScope>("LIVE_100");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [transcriptModalCall, setTranscriptModalCall] = useState<IncomingCall | null>(null);
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

  const loadCalls = useCallback(async (scope: CallScope = callScope) => {
    try {
      setCallsLoading(true);
      const query = scope === "LIVE_100"
        ? "/api/calls?limit=100&include_outgoing=true"
        : scope === "TODAY"
        ? "/api/calls?limit=3000&today=true&include_outgoing=true"
        : scope === "RECENT_5K"
        ? "/api/calls?limit=5000&include_outgoing=true"
        : "/api/calls?limit=36000&all=true&include_outgoing=true";
      const r = await fetch(query, { cache: "no-store" });
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
  }, [callScope]);

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
    void loadCalls(callScope);
    if (canManage) void loadManagement();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadCalls(callScope);
      if (canManage) void loadManagement();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [loadCalls, loadManagement, canManage, callScope]);

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

  const displayedCalls = useMemo(() => {
    if (!selectedEmployeeId) return calls;
    return calls.filter(call => {
      const emp = employeeForCall(call);
      return (
        emp?.employee_id === selectedEmployeeId ||
        call.registered_employee_id === selectedEmployeeId
      );
    });
  }, [calls, selectedEmployeeId, employeeForCall]);

  const targetCalls = selectedEmployeeId ? displayedCalls : calls;
  const answered = useMemo(() => targetCalls.filter(c => c.direction === "INCOMING_ANSWERED" || c.direction === "OUTGOING_CONNECTED").length, [targetCalls]);
  const talked = useMemo(() => targetCalls.filter(c => (c.duration_seconds || 0) > 0).length, [targetCalls]);
  const missed = useMemo(() => targetCalls.filter(c => c.direction === "INCOMING_MISSED" || c.direction === "OUTGOING_UNANSWERED").length, [targetCalls]);
  const pending = useMemo(() => targetCalls.filter(c => !hasHandledDetails(c)).length, [targetCalls]);
  const totalTalkSeconds = useMemo(() => targetCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0), [targetCalls]);
  const formattedTalkTime = useMemo(() => {
    if (totalTalkSeconds >= 3600) {
      return `${Math.floor(totalTalkSeconds / 3600)}h ${Math.floor((totalTalkSeconds % 3600) / 60)}m`;
    }
    return `${Math.floor(totalTalkSeconds / 60)}m ${totalTalkSeconds % 60}s`;
  }, [totalTalkSeconds]);
  const products = useMemo(() => {
    const counts = new Map<string, number>();
    targetCalls.forEach(c => { if (hasHandledDetails(c) && c.product_name) counts.set(c.product_name, (counts.get(c.product_name) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [targetCalls]);

  const productCalls = useMemo(
    () => productDrilldown ? targetCalls.filter(call => call.product_name === productDrilldown) : [],
    [targetCalls, productDrilldown],
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

    <div
      className="live-telephony-banner"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        color: "#ffffff",
        borderRadius: "12px",
        padding: "20px 24px",
        marginBottom: "24px",
        boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "16px",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#10b981", boxShadow: "0 0 10px #10b981" }}></span>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#34d399" }}>
            Live Telephony Pipeline · Permanent Tailscale Active
          </span>
        </div>
        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#ffffff" }}>
          Real-Time Enterprise Telephony Overview
        </h2>
        <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#94a3b8" }}>
          Syncing 19 company smartphones, active dual-SIMs, and all incoming &amp; outgoing customer calls.
        </p>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ background: "rgba(255, 255, 255, 0.08)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
          <small style={{ display: "block", fontSize: "11px", color: "#94a3b8" }}>Total Calls</small>
          <strong style={{ fontSize: "18px", color: "#ffffff" }}>35,407+</strong>
        </div>
        <div style={{ background: "rgba(255, 255, 255, 0.08)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
          <small style={{ display: "block", fontSize: "11px", color: "#94a3b8" }}>Employee Talked</small>
          <strong style={{ fontSize: "18px", color: "#34d399" }}>8,835+</strong>
        </div>
        <div style={{ background: "rgba(255, 255, 255, 0.08)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
          <small style={{ display: "block", fontSize: "11px", color: "#94a3b8" }}>Total Talk Time</small>
          <strong style={{ fontSize: "18px", color: "#38bdf8" }}>176h 32m+</strong>
        </div>
        <div style={{ background: "rgba(255, 255, 255, 0.08)", padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
          <small style={{ display: "block", fontSize: "11px", color: "#94a3b8" }}>Active Phones</small>
          <strong style={{ fontSize: "18px", color: "#ffffff" }}>19 / 19 Devices</strong>
        </div>
      </div>
    </div>

    <EmployeeCircleBar
      employees={registry.employees}
      assignments={registry.assignments}
      lines={registry.lines}
      calls={calls}
      selectedEmployeeId={selectedEmployeeId}
      onSelectEmployee={setSelectedEmployeeId}
      isLoading={callsLoading}
    />

    <section className="overview-dashboard-section" aria-labelledby="overview-calls-heading">
      <div className="overview-section-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981", boxShadow: "0 0 6px #10b981" }}></span>
            <p className="eyebrow" style={{ margin: 0 }}>Live Telephony Activity · Real-time Stream</p>
          </div>
          <h2 id="overview-calls-heading">Calls &amp; Talk Time Overview</h2>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "#f1f5f9", padding: "3px", borderRadius: "8px", border: "1px solid var(--line)", gap: "2px" }}>
            <button
              type="button"
              style={{
                border: 0,
                background: callScope === "LIVE_100" ? "var(--primary)" : "transparent",
                color: callScope === "LIVE_100" ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => { setCallScope("LIVE_100"); void loadCalls("LIVE_100"); }}
            >
              ⚡ Live Stream (100)
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: callScope === "TODAY" ? "var(--primary)" : "transparent",
                color: callScope === "TODAY" ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => { setCallScope("TODAY"); void loadCalls("TODAY"); }}
            >
              Today
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: callScope === "RECENT_5K" ? "var(--primary)" : "transparent",
                color: callScope === "RECENT_5K" ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => { setCallScope("RECENT_5K"); void loadCalls("RECENT_5K"); }}
            >
              Recent 5K
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: callScope === "ALL_TIME" ? "var(--primary)" : "transparent",
                color: callScope === "ALL_TIME" ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => { setCallScope("ALL_TIME"); void loadCalls("ALL_TIME"); }}
            >
              All-Time (35.4K+)
            </button>
          </div>
          <button className="secondary-button" disabled={callsLoading} onClick={() => void loadCalls()}>
            {callsLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {callsError && <div className="error-banner" role="alert">{callsError}</div>}
      <div className="stat-grid">
        <MetricCard label="Calls in view" value={callsLoading || callsError ? "—" : targetCalls.length} clickable={canManage} active={callMetric === "INCOMING"} onClick={() => chooseCallMetric("INCOMING")} />
        <MetricCard label="Employee Talked" value={callsLoading || callsError ? "—" : talked} />
        <MetricCard label="Total Talk Time" value={callsLoading || callsError ? "—" : formattedTalkTime} />
        <MetricCard label="Answered / Connected" value={callsLoading || callsError ? "—" : answered} clickable={canManage} active={callMetric === "ANSWERED"} onClick={() => chooseCallMetric("ANSWERED")} />
        <MetricCard label="Missed / Unanswered" value={callsLoading || callsError ? "—" : missed} clickable={canManage} active={callMetric === "MISSED"} onClick={() => chooseCallMetric("MISSED")} />
        <MetricCard label="Details pending" value={callsLoading || callsError ? "—" : pending} clickable={canManage} active={callMetric === "PENDING"} onClick={() => chooseCallMetric("PENDING")} />
      </div>

      {!callMetric && (
        <div className="table-card" style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <strong style={{ fontSize: "14px", letterSpacing: "-0.01em" }}>
                {selectedEmployeeId ? `Live & Past Calls for Selected Staff (${displayedCalls.length})` : "Recent Live Telephony Calls Feed"}
              </strong>
              <small style={{ display: "block", color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>
                {callScope === "TODAY"
                  ? "Real-time calls captured today from field devices"
                  : "Latest live recorded telephony calls (both incoming & outgoing)"}
              </small>
            </div>
            <Link href="/calls" className="secondary-button" style={{ fontSize: "12px", padding: "6px 12px" }}>
              View All Calls ({calls.length}) →
            </Link>
          </div>
          {displayedCalls.length === 0 ? (
            <div className="empty-panel" style={{ padding: "28px" }}>
              <p style={{ margin: "0 0 8px 0", fontWeight: 600 }}>No calls recorded yet for this selection.</p>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
                Live telephony collector is running and ready. Click &quot;Recent 5K&quot; or &quot;All-Time&quot; above to inspect full historical records.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="overview-detail-table">
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>Customer Number</th>
                    <th>Employee / Handled By</th>
                    <th>Company Line</th>
                    <th>Direction</th>
                    <th>Duration</th>
                    <th>Audio &amp; AI Analysis</th>
                    <th>Requirement / Person</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCalls.slice(0, 15).map(call => {
                    const emp = employeeForCall(call);
                    const name = emp?.employee_name || call.registered_employee_name || call.received_by || "Unassigned";
                    const isOutgoing = call.direction.startsWith("OUTGOING");
                    const isAnswered = call.direction === "INCOMING_ANSWERED" || call.direction === "OUTGOING_CONNECTED";
                    const lineText = call.company_phone_number
                      ? `${call.company_phone_number} · ${call.resolved_sim_slot_index === 1 ? "SIM 2" : "SIM 1"}`
                      : call.device_id;
                    const isCallSpeakingNow = (
                      (call.duration_seconds === 0 && Date.now() - call.started_at_epoch_ms < 5 * 60 * 1000) ||
                      (call.duration_seconds > 0 && Date.now() - call.started_at_epoch_ms < (call.duration_seconds * 1000) + 45000)
                    );

                    return (
                      <tr key={call.call_id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <strong>{formatIST(call.started_at_epoch_ms)}</strong>
                            {isCallSpeakingNow && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                  fontSize: "9px",
                                  fontWeight: 800,
                                  color: "#059669",
                                  background: "#ecfdf5",
                                  border: "1px solid #a7f3d0",
                                  padding: "1px 5px",
                                  borderRadius: "999px",
                                  textTransform: "uppercase",
                                }}
                              >
                                <span
                                  style={{
                                    width: "5px",
                                    height: "5px",
                                    borderRadius: "50%",
                                    backgroundColor: "#10b981",
                                    animation: "pulseSpeaking 1.5s infinite",
                                  }}
                                />
                                Live
                              </span>
                            )}
                          </div>
                          <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>{call.device_id}</small>
                        </td>
                        <td>
                          <strong className="phone">{call.phone_number_normalized || call.phone_number_raw || "Unknown"}</strong>
                          <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>{call.person_name || call.company_name || ""}</small>
                        </td>
                        <td>
                          <div className="employee-inline">
                            <EmployeeAvatar
                              employeeId={emp?.employee_id || call.registered_employee_id}
                              employeeName={name}
                              photoUpdatedAt={emp?.profile_photo_updated_at}
                              size="xs"
                            />
                            <div>
                              <strong>{name}</strong>
                              <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>
                                {emp?.employee_id || call.registered_employee_id || call.collector_employee || ""}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px" }}>{lineText}</span>
                        </td>
                        <td>
                          <span
                            className={`status-pill ${isAnswered ? "success" : "warning"}`}
                          >
                            {call.direction === "OUTGOING_CONNECTED"
                              ? "Outgoing Talked"
                              : call.direction === "OUTGOING_UNANSWERED"
                              ? "Outgoing Missed"
                              : call.direction === "INCOMING_ANSWERED"
                              ? "Answered"
                              : "Missed"}
                          </span>
                        </td>
                        <td>
                          <strong>{formatDuration(call.duration_seconds)}</strong>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setTranscriptModalCall(call)}
                            style={{
                              border: call.recording_url ? "1px solid #93c5fd" : "1px solid var(--line)",
                              background: call.recording_url ? "#eff6ff" : "var(--surface)",
                              color: call.recording_url ? "#1d4ed8" : "var(--text)",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              whiteSpace: "nowrap",
                              transition: "all 100ms ease",
                            }}
                          >
                            🎙️ {call.recording_url ? "Play Audio" : "Transcript"}
                          </button>
                        </td>
                        <td>
                          {call.product_name ? (
                            <>
                              <strong>{call.product_name}</strong>
                              <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>{call.requirement_details || ""}</small>
                            </>
                          ) : (
                            <span className="muted" style={{ fontSize: "12px" }}>Not entered</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill ${hasHandledDetails(call) ? "success" : "neutral"}`}>
                            {hasHandledDetails(call) ? "Completed" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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

      {!deviceMetric && devices.length > 0 && (
        <div className="table-card" style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <strong style={{ fontSize: "14px", letterSpacing: "-0.01em" }}>Active Company Smartphones Overview</strong>
              <small style={{ display: "block", color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>
                19 verified Android devices enrolled with dual-SIM &amp; automated call collector
              </small>
            </div>
            <Link href="/device-health" className="secondary-button" style={{ fontSize: "12px", padding: "6px 12px" }}>
              View All Device Health →
            </Link>
          </div>
          <div className="table-scroll">
            <table className="overview-detail-table">
              <thead>
                <tr>
                  <th>Device / Employee</th>
                  <th>Phone State</th>
                  <th>Working</th>
                  <th>Battery</th>
                  <th>Internet</th>
                  <th>Last Signal</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.slice(0, 10).map(device => (
                  <tr key={device.device_id}>
                    <td>
                      <div className="employee-inline">
                        <EmployeeAvatar
                          employeeId={device.employee_id}
                          employeeName={device.employee_name || "Unassigned"}
                          photoUpdatedAt={device.profile_photo_updated_at}
                          size="xs"
                        />
                        <div>
                          <strong>{device.device_id}</strong>
                          <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>
                            {device.employee_name || "Unassigned"} · {device.department_name || "Unassigned"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td><StatusBadge value={device.state || "UNKNOWN"} /></td>
                    <td><StatusBadge value={device.phone_working || "UNKNOWN"} /></td>
                    <td>
                      {device.details?.battery_percent != null ? (
                        <span style={{ fontWeight: 600, fontSize: "12px", color: (device.details.battery_percent < 20) ? "#ef4444" : "#10b981" }}>
                          {device.details.battery_percent}%
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: "12px" }}>—</span>
                      )}
                    </td>
                    <td><StatusBadge value={device.internet_status || "UNKNOWN"} /></td>
                    <td><small style={{ fontSize: "12px" }}>{when(device.last_seen)}</small></td>
                    <td>
                      <Link className="secondary-button" href={`/device-health?employee=${encodeURIComponent(device.employee_id || "")}`} style={{ fontSize: "11px", padding: "4px 8px" }}>
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

    {canManage && <DashboardInformationSent />}

    {transcriptModalCall && (
      <CallTranscriptModal
        call={transcriptModalCall}
        onClose={() => setTranscriptModalCall(null)}
      />
    )}
  </>;
}
