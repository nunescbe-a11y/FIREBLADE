"use client";

import DashboardInformationSent from "@/components/DashboardInformationSent";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type CallScope = "TODAY" | "YESTERDAY" | "WEEK" | "ALL_TIME";
type OutcomeFilter = "ALL" | "ONGOING" | "MISSED" | "ANSWERED" | "OUTGOING";

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
  const [callScope, setCallScope] = useState<CallScope>("TODAY");
  const [callOutcomeFilter, setCallOutcomeFilter] = useState<OutcomeFilter>("ALL");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [transcriptModalCall, setTranscriptModalCall] = useState<IncomingCall | null>(null);
  const [newCallNotice, setNewCallNotice] = useState<string | null>(null);
  const latestCallIdRef = useRef<number>(0);
  const isPollingRef = useRef<boolean>(false);
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

  // Update latest call_id watermark whenever calls state changes
  useEffect(() => {
    if (calls.length > 0) {
      const maxId = Math.max(...calls.map(c => c.call_id || 0), 0);
      if (maxId > latestCallIdRef.current) {
        latestCallIdRef.current = maxId;
      }
    }
  }, [calls]);

  const loadCalls = useCallback(async (scope: CallScope = callScope) => {
    try {
      setCallsLoading(true);
      const query = scope === "TODAY"
        ? "/api/calls?range=today&include_outgoing=true"
        : scope === "YESTERDAY"
        ? "/api/calls?range=yesterday&include_outgoing=true"
        : scope === "WEEK"
        ? "/api/calls?range=week&include_outgoing=true"
        : "/api/calls?range=all&limit=36000&include_outgoing=true";
      const r = await fetch(query, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not load calls");
      const fetchedCalls: IncomingCall[] = j.calls || [];
      setCalls(fetchedCalls);
      if (fetchedCalls.length > 0) {
        latestCallIdRef.current = Math.max(...fetchedCalls.map(c => c.call_id || 0), 0);
      }
      setRegistry(j.registry || EMPTY_REGISTRY);
      setCallsError("");
    } catch (e) {
      setCallsError(e instanceof Error ? e.message : "Could not load calls");
    } finally {
      setCallsLoading(false);
    }
  }, [callScope]);

  // High-performance delta poll: only fetches strictly NEW calls since latestCallId
  // Runs in <15ms with ZERO screen re-render if no new calls arrive
  const pollNewCalls = useCallback(async () => {
    if (isPollingRef.current || document.hidden) return;
    if (latestCallIdRef.current <= 0) return;
    try {
      isPollingRef.current = true;
      const res = await fetch(`/api/calls?since_id=${latestCallIdRef.current}&range=today&include_outgoing=true`, {
        cache: "no-store",
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return;
      const data = await res.json();
      const incomingNew: IncomingCall[] = data.calls || [];
      if (incomingNew.length > 0) {
        setCalls(prev => {
          const existingIds = new Set(prev.map(c => c.call_id));
          const strictlyNew = incomingNew.filter(c => !existingIds.has(c.call_id));
          if (strictlyNew.length === 0) return prev;

          const caller = strictlyNew[0].phone_number_normalized || strictlyNew[0].phone_number_raw || "New caller";
          setNewCallNotice(`🔔 ${strictlyNew.length} new call${strictlyNew.length > 1 ? "s" : ""} received (${caller})`);
          setTimeout(() => setNewCallNotice(null), 5000);

          return [...strictlyNew, ...prev];
        });
      }
    } catch {
      // Ignore background delta poll errors safely
    } finally {
      isPollingRef.current = false;
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
    void loadCalls(callScope);
    if (canManage) void loadManagement();

    // Fast 6-second incremental check for new incoming/outgoing calls (instant delta prepend)
    const deltaTimer = window.setInterval(() => {
      void pollNewCalls();
    }, 6000);

    // Management device health poll (every 30 seconds)
    const mgmtTimer = window.setInterval(() => {
      if (!document.hidden && canManage) void loadManagement();
    }, 30000);

    return () => {
      window.clearInterval(deltaTimer);
      window.clearInterval(mgmtTimer);
    };
  }, [loadCalls, loadManagement, canManage, callScope, pollNewCalls]);

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

  const isCallOngoing = useCallback((c: IncomingCall) => {
    const isAnswered = c.direction === "INCOMING_ANSWERED" || c.direction === "OUTGOING_CONNECTED" || c.direction === "ONGOING";
    if (!isAnswered) return false;
    const now = Date.now();
    const elapsed = (now - c.started_at_epoch_ms) / 1000;
    if (c.duration_seconds === 0 && elapsed >= 0 && elapsed < 900) return true;
    if (c.duration_seconds > 0 && elapsed < c.duration_seconds + 30) return true;
    return false;
  }, []);

  const ongoingCalls = useMemo(() => calls.filter(isCallOngoing), [calls, isCallOngoing]);

  const displayedCalls = useMemo(() => {
    let list = calls;
    if (selectedEmployeeId) {
      list = list.filter(call => {
        const emp = employeeForCall(call);
        return (
          emp?.employee_id === selectedEmployeeId ||
          call.registered_employee_id === selectedEmployeeId
        );
      });
    }
    if (callOutcomeFilter === "ONGOING") {
      list = list.filter(isCallOngoing);
    } else if (callOutcomeFilter === "MISSED") {
      list = list.filter(call =>
        call.direction.includes("MISSED") ||
        call.direction.includes("REJECTED") ||
        call.direction.includes("UNANSWERED")
      );
    } else if (callOutcomeFilter === "ANSWERED") {
      list = list.filter(call =>
        call.direction === "INCOMING_ANSWERED" ||
        call.direction === "OUTGOING_CONNECTED"
      );
    } else if (callOutcomeFilter === "OUTGOING") {
      list = list.filter(call => call.direction.startsWith("OUTGOING"));
    }
    return list;
  }, [calls, selectedEmployeeId, callOutcomeFilter, employeeForCall, isCallOngoing]);

  const targetCalls = selectedEmployeeId ? displayedCalls : calls;
  const answered = useMemo(() => targetCalls.filter(c => c.direction === "INCOMING_ANSWERED" || c.direction === "OUTGOING_CONNECTED").length, [targetCalls]);
  const talked = useMemo(() => targetCalls.filter(c => (c.duration_seconds || 0) > 0).length, [targetCalls]);
  const missed = useMemo(() => targetCalls.filter(c => c.direction.includes("MISSED") || c.direction.includes("REJECTED") || c.direction.includes("UNANSWERED")).length, [targetCalls]);
  const pending = useMemo(() => targetCalls.filter(c => !hasHandledDetails(c)).length, [targetCalls]);
  const totalTalkSeconds = useMemo(() => targetCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0), [targetCalls]);

  const missedCount = useMemo(() => calls.filter(c =>
    c.direction.includes("MISSED") || c.direction.includes("REJECTED") || c.direction.includes("UNANSWERED")
  ).length, [calls]);

  const answeredCount = useMemo(() => calls.filter(c =>
    c.direction === "INCOMING_ANSWERED" || c.direction === "OUTGOING_CONNECTED"
  ).length, [calls]);

  const outgoingCount = useMemo(() => calls.filter(c => c.direction.startsWith("OUTGOING")).length, [calls]);
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
      {newCallNotice && (
        <div
          style={{
            background: "#059669",
            color: "#ffffff",
            padding: "10px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 700,
            marginBottom: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>⚡</span>
            <span>{newCallNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNewCallNotice(null)}
            style={{ background: "transparent", border: 0, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}
          >
            ✕
          </button>
        </div>
      )}
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
              ⚡ Today's Live Calls
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: callScope === "YESTERDAY" ? "var(--primary)" : "transparent",
                color: callScope === "YESTERDAY" ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => { setCallScope("YESTERDAY"); void loadCalls("YESTERDAY"); }}
            >
              Yesterday
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: callScope === "WEEK" ? "var(--primary)" : "transparent",
                color: callScope === "WEEK" ? "#fff" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
                transition: "all 120ms ease"
              }}
              onClick={() => { setCallScope("WEEK"); void loadCalls("WEEK"); }}
            >
              This Week (Active)
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
              All-Time Archive (35.4K+)
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

      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "14px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: "4px" }}>
          Filter Calls:
        </span>
        <button
          type="button"
          onClick={() => setCallOutcomeFilter("ALL")}
          style={{
            border: callOutcomeFilter === "ALL" ? "1px solid var(--primary)" : "1px solid var(--line)",
            background: callOutcomeFilter === "ALL" ? "var(--primary)" : "var(--surface)",
            color: callOutcomeFilter === "ALL" ? "#ffffff" : "var(--text)",
            padding: "5px 12px",
            borderRadius: "999px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
        >
          All Calls ({calls.length})
        </button>
        <button
          type="button"
          onClick={() => setCallOutcomeFilter("ONGOING")}
          style={{
            border: callOutcomeFilter === "ONGOING" ? "1px solid #10b981" : "1px solid #a7f3d0",
            background: callOutcomeFilter === "ONGOING" ? "#10b981" : "#ecfdf5",
            color: callOutcomeFilter === "ONGOING" ? "#ffffff" : "#047857",
            padding: "5px 12px",
            borderRadius: "999px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 120ms ease",
          }}
        >
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: callOutcomeFilter === "ONGOING" ? "#ffffff" : "#10b981", animation: ongoingCalls.length > 0 ? "pulseSpeaking 1.2s infinite" : undefined }} />
          ⚡ Ongoing Calls ({ongoingCalls.length})
        </button>
        <button
          type="button"
          onClick={() => setCallOutcomeFilter("MISSED")}
          style={{
            border: callOutcomeFilter === "MISSED" ? "1px solid #ef4444" : "1px solid #fecaca",
            background: callOutcomeFilter === "MISSED" ? "#ef4444" : "#fef2f2",
            color: callOutcomeFilter === "MISSED" ? "#ffffff" : "#b91c1c",
            padding: "5px 12px",
            borderRadius: "999px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 120ms ease",
          }}
        >
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: callOutcomeFilter === "MISSED" ? "#ffffff" : "#ef4444" }} />
          🔴 Missed Calls Only ({missedCount})
        </button>
        <button
          type="button"
          onClick={() => setCallOutcomeFilter("ANSWERED")}
          style={{
            border: callOutcomeFilter === "ANSWERED" ? "1px solid #10b981" : "1px solid #a7f3d0",
            background: callOutcomeFilter === "ANSWERED" ? "#10b981" : "#ecfdf5",
            color: callOutcomeFilter === "ANSWERED" ? "#ffffff" : "#047857",
            padding: "5px 12px",
            borderRadius: "999px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 120ms ease",
          }}
        >
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: callOutcomeFilter === "ANSWERED" ? "#ffffff" : "#10b981" }} />
          🟢 Answered ({answeredCount})
        </button>
        <button
          type="button"
          onClick={() => setCallOutcomeFilter("OUTGOING")}
          style={{
            border: callOutcomeFilter === "OUTGOING" ? "1px solid #3b82f6" : "1px solid #bfdbfe",
            background: callOutcomeFilter === "OUTGOING" ? "#3b82f6" : "#eff6ff",
            color: callOutcomeFilter === "OUTGOING" ? "#ffffff" : "#1d4ed8",
            padding: "5px 12px",
            borderRadius: "999px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 120ms ease",
          }}
        >
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: callOutcomeFilter === "OUTGOING" ? "#ffffff" : "#3b82f6" }} />
          📤 Outgoing ({outgoingCount})
        </button>
      </div>

      {!callMetric && (
        <>
          {ongoingCalls.length > 0 && (
            <div
              style={{
                background: "linear-gradient(135deg, #064e3b 0%, #065f46 100%)",
                color: "#ffffff",
                borderRadius: "12px",
                padding: "16px 20px",
                marginTop: "16px",
                boxShadow: "0 6px 18px rgba(6, 78, 59, 0.35)",
                border: "1px solid #059669",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#34d399", boxShadow: "0 0 10px #34d399", animation: "pulseSpeaking 1.2s infinite" }} />
                  <strong style={{ fontSize: "14px", letterSpacing: "-0.01em" }}>
                    Ongoing Live Telephony Calls in Progress ({ongoingCalls.length})
                  </strong>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#a7f3d0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Active Real-Time
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                {ongoingCalls.map(c => {
                  const emp = employeeForCall(c);
                  const name = emp?.employee_name || c.registered_employee_name || c.received_by || "Staff";
                  const customerPhone = c.phone_number_normalized || c.phone_number_raw || "Unknown";
                  const cleanPhone = customerPhone.replace(/\D/g, "");
                  const elapsedSec = Math.floor(Math.max(1, (Date.now() - c.started_at_epoch_ms) / 1000));
                  const durationText = elapsedSec >= 60
                    ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
                    : `${elapsedSec}s`;

                  return (
                    <div
                      key={c.call_id}
                      style={{
                        background: "rgba(255, 255, 255, 0.12)",
                        backdropFilter: "blur(4px)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        border: "1px solid rgba(255, 255, 255, 0.2)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        <EmployeeAvatar
                          employeeId={emp?.employee_id || c.registered_employee_id}
                          employeeName={name}
                          photoUpdatedAt={emp?.profile_photo_updated_at}
                          size="sm"
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <strong style={{ fontSize: "13px", color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {name}
                            </strong>
                            <span style={{ fontSize: "10px", fontWeight: 800, background: "#059669", color: "#ecfdf5", padding: "1px 6px", borderRadius: "999px" }}>
                              {c.direction.startsWith("OUTGOING") ? "OUTGOING" : "INCOMING"}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#d1fae5", marginTop: "2px", fontWeight: 600 }}>
                            {customerPhone} {c.person_name ? `· ${c.person_name}` : ""}
                          </div>
                          <div style={{ fontSize: "11px", color: "#a7f3d0", marginTop: "2px" }}>
                            ⏱️ {durationText} live
                          </div>
                        </div>
                      </div>
                      {cleanPhone && (
                        <a
                          href={`https://wa.me/${cleanPhone.startsWith("91") ? cleanPhone : "91" + cleanPhone}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            background: "#25D366",
                            color: "#ffffff",
                            padding: "5px 10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 700,
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          💬 WhatsApp
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
            <div className="empty-panel" style={{ padding: "32px 20px", textAlign: "center" }}>
              <p style={{ margin: "0 0 8px 0", fontWeight: 700, fontSize: "14px", color: "var(--text)" }}>
                {callScope === "TODAY"
                  ? "No calls recorded yet today"
                  : callOutcomeFilter === "MISSED"
                  ? "No missed calls found in current view"
                  : selectedEmployeeId
                  ? "No calls found for this employee in current view"
                  : "No calls match current filter"}
              </p>
              <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "var(--muted)" }}>
                {callScope === "TODAY"
                  ? "Live telephony collector is running and ready. Switch to 'This Week (Active)' or 'Yesterday' to inspect telephony calls."
                  : "Try selecting a broader time scope or clearing filters above."}
              </p>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                {callScope === "TODAY" && (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ fontSize: "12px", padding: "6px 14px" }}
                    onClick={() => { setCallScope("WEEK"); void loadCalls("WEEK"); }}
                  >
                    View This Week (Active Calls) →
                  </button>
                )}
                {callOutcomeFilter !== "ALL" && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: "12px", padding: "6px 14px" }}
                    onClick={() => setCallOutcomeFilter("ALL")}
                  >
                    Show All Calls
                  </button>
                )}
                {selectedEmployeeId && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: "12px", padding: "6px 14px" }}
                    onClick={() => setSelectedEmployeeId(null)}
                  >
                    Clear Employee Filter
                  </button>
                )}
              </div>
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
                    <th>Call Direction</th>
                    <th>Duration</th>
                    <th>Voice Audio &amp; Spoken Notes</th>
                    <th>Requirement / Product</th>
                    <th>Status</th>
                    <th>Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCalls.slice(0, 25).map(call => {
                    const emp = employeeForCall(call);
                    const name = emp?.employee_name || call.registered_employee_name || call.received_by || "Unassigned";
                    const isOutgoing = call.direction.startsWith("OUTGOING");
                    const isAnswered = call.direction === "INCOMING_ANSWERED" || call.direction === "OUTGOING_CONNECTED";
                    const isMissed = call.direction.includes("MISSED") || call.direction.includes("REJECTED") || call.direction.includes("UNANSWERED");
                    const lineText = call.company_phone_number
                      ? `${call.company_phone_number} · ${call.resolved_sim_slot_index === 1 ? "SIM 2" : "SIM 1"}`
                      : call.device_id;
                    const isCallSpeakingNow = isCallOngoing(call);
                    const customerPhone = call.phone_number_normalized || call.phone_number_raw || "Unknown";
                    const cleanPhone = customerPhone.replace(/\D/g, "");

                    return (
                      <tr key={call.call_id} style={isMissed ? { background: "rgba(254, 242, 242, 0.45)" } : undefined}>
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
                          <strong className="phone">{customerPhone}</strong>
                          <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>{call.person_name || call.phone_contact_name || call.company_name || ""}</small>
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
                          {isMissed ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "11px",
                                fontWeight: 800,
                                color: "#b91c1c",
                                background: "#fef2f2",
                                border: "1px solid #fecaca",
                                padding: "3px 8px",
                                borderRadius: "999px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
                              🔴 {call.direction === "OUTGOING_UNANSWERED" ? "Outgoing Missed" : "Missed Call"}
                            </span>
                          ) : isOutgoing ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                color: "#1d4ed8",
                                background: "#eff6ff",
                                border: "1px solid #dbeafe",
                                padding: "3px 8px",
                                borderRadius: "999px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              📤 Outgoing Connected
                            </span>
                          ) : (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                color: "#047857",
                                background: "#ecfdf5",
                                border: "1px solid #a7f3d0",
                                padding: "3px 8px",
                                borderRadius: "999px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              🟢 Answered
                            </span>
                          )}
                        </td>
                        <td>
                          {isCallSpeakingNow ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 800,
                                  color: "#059669",
                                  background: "#ecfdf5",
                                  border: "1px solid #a7f3d0",
                                  padding: "2px 6px",
                                  borderRadius: "999px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  width: "fit-content",
                                }}
                              >
                                <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#10b981", animation: "pulseSpeaking 1.2s infinite" }} />
                                Speaking Now
                              </span>
                              <strong style={{ fontVariantNumeric: "tabular-nums", fontSize: "12px", color: "#065f46" }}>
                                ⏱️ {Math.floor(Math.max(1, (Date.now() - call.started_at_epoch_ms) / 1000))}s live
                              </strong>
                            </div>
                          ) : (
                            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatDuration(call.duration_seconds)}</strong>
                          )}
                        </td>
                        <td>
                          {call.recording_url ? (
                            <button
                              type="button"
                              onClick={() => setTranscriptModalCall(call)}
                              style={{
                                border: "1px solid #93c5fd",
                                background: "#eff6ff",
                                color: "#1d4ed8",
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
                              title="Listen to Real Audio Recording"
                            >
                              ▶️ Play Audio
                            </button>
                          ) : (call.notes || call.product_name) ? (
                            <button
                              type="button"
                              onClick={() => setTranscriptModalCall(call)}
                              style={{
                                border: "1px solid #a7f3d0",
                                background: "#ecfdf5",
                                color: "#047857",
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
                              title="View Spoken Notes"
                            >
                              📝 Spoken Notes
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setTranscriptModalCall(call)}
                              style={{
                                border: "1px solid var(--line)",
                                background: "var(--surface)",
                                color: "var(--muted)",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                whiteSpace: "nowrap",
                                transition: "all 100ms ease",
                              }}
                              title="Add What Was Spoken"
                            >
                              + Add Notes
                            </button>
                          )}
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
                        <td>
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            {cleanPhone && (
                              <a
                                href={`https://wa.me/${cleanPhone.startsWith("91") ? cleanPhone : "91" + cleanPhone}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                  background: "#25D366",
                                  color: "#ffffff",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  textDecoration: "none",
                                  whiteSpace: "nowrap",
                                }}
                                title="Chat on WhatsApp"
                              >
                                💬 WhatsApp
                              </a>
                            )}
                            <a
                              href={`tel:${customerPhone}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "3px",
                                background: "#f1f5f9",
                                border: "1px solid var(--line)",
                                color: "var(--text)",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 700,
                                textDecoration: "none",
                                whiteSpace: "nowrap",
                              }}
                              title="Call Back"
                            >
                              📞 Call
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
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
