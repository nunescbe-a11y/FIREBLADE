"use client";

import { useMemo } from "react";
import type { DeviceAssignment, FirebladeDeviceLine, FirebladeEmployee, IncomingCall } from "@/lib/types";
import EmployeeAvatar from "@/components/EmployeeAvatar";

type Props = {
  employees: FirebladeEmployee[];
  assignments: DeviceAssignment[];
  lines: FirebladeDeviceLine[];
  calls: IncomingCall[];
  selectedEmployeeId: string | null;
  onSelectEmployee: (employeeId: string | null) => void;
  isLoading?: boolean;
};

export default function EmployeeCircleBar({
  employees,
  assignments,
  lines,
  calls,
  selectedEmployeeId,
  onSelectEmployee,
  isLoading = false,
}: Props) {
  // Map device assignment to employee
  const activeAssignmentByEmployee = useMemo(() => {
    const map = new Map<string, string>(); // employee_id -> device_id
    for (const assignment of assignments.filter(a => !a.assigned_until)) {
      if (!map.has(assignment.employee_id)) {
        map.set(assignment.employee_id, assignment.device_id);
      }
    }
    return map;
  }, [assignments]);

  // Map device_id to primary phone number
  const phoneByDevice = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of lines.filter(l => l.active)) {
      if (!map.has(line.device_id) || line.sim_slot_index === 0) {
        map.set(line.device_id, line.phone_number);
      }
    }
    return map;
  }, [lines]);

  // Count calls and determine live speaking status for each employee
  const employeeStatusList = useMemo(() => {
    const now = Date.now();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    return employees.map(emp => {
      const deviceId = activeAssignmentByEmployee.get(emp.employee_id);
      const phoneNumber = deviceId ? phoneByDevice.get(deviceId) || deviceId : "Unassigned";

      // Filter calls for this employee
      const empCalls = calls.filter(c => {
        return (
          c.registered_employee_id === emp.employee_id ||
          (deviceId && c.device_id === deviceId) ||
          c.collector_employee === emp.employee_name
        );
      });

      const callCount = empCalls.length;
      const latestCall = empCalls[0]; // calls are sorted newest first

      // Check if employee is currently speaking on a call
      let isSpeaking = false;
      let lastCallAgoText = "Ready";

      if (latestCall) {
        const timeSinceStart = now - latestCall.started_at_epoch_ms;
        const callDurationMs = (latestCall.duration_seconds || 0) * 1000;

        // Ongoing call: duration is 0 or start was within 5m and elapsed time is less than duration + 30s
        if (
          (latestCall.duration_seconds === 0 && timeSinceStart < FIVE_MINUTES_MS) ||
          (latestCall.duration_seconds > 0 && timeSinceStart < callDurationMs + 45000)
        ) {
          isSpeaking = true;
          lastCallAgoText = "Speaking Now";
        } else if (timeSinceStart < 60 * 60 * 1000) {
          const mins = Math.max(1, Math.round(timeSinceStart / 60000));
          lastCallAgoText = `${mins}m ago`;
        } else if (timeSinceStart < 24 * 60 * 60 * 1000) {
          const hrs = Math.round(timeSinceStart / 3600000);
          lastCallAgoText = `${hrs}h ago`;
        }
      }

      return {
        employee: emp,
        deviceId,
        phoneNumber,
        callCount,
        isSpeaking,
        lastCallAgoText,
        latestCall,
      };
    }).sort((a, b) => {
      // Sort speaking employees first, then by callCount desc, then by name
      if (a.isSpeaking && !b.isSpeaking) return -1;
      if (!a.isSpeaking && b.isSpeaking) return 1;
      if (b.callCount !== a.callCount) return b.callCount - a.callCount;
      return a.employee.employee_name.localeCompare(b.employee.employee_name);
    });
  }, [employees, activeAssignmentByEmployee, phoneByDevice, calls]);

  const selectedEmployeeInfo = useMemo(() => {
    if (!selectedEmployeeId) return null;
    return employeeStatusList.find(e => e.employee.employee_id === selectedEmployeeId);
  }, [selectedEmployeeId, employeeStatusList]);

  const speakingCount = useMemo(() => {
    return employeeStatusList.filter(e => e.isSpeaking).length;
  }, [employeeStatusList]);

  return (
    <div className="employee-circle-container" style={{ marginBottom: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <strong style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            Field Telephony Staff &amp; Live Status
          </strong>
          {speakingCount > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                background: "#ecfdf5",
                color: "#059669",
                border: "1px solid #a7f3d0",
                padding: "2px 8px",
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "#10b981",
                  animation: "pulseSpeaking 1.5s infinite",
                }}
              />
              {speakingCount} Staff Speaking on Call Now
            </span>
          ) : (
            <span
              style={{
                fontSize: "11px",
                color: "var(--muted)",
                background: "var(--surface2)",
                padding: "2px 8px",
                borderRadius: "999px",
                border: "1px solid var(--line)",
              }}
            >
              All Staff Available
            </span>
          )}
        </div>

        <small style={{ color: "var(--muted)", fontSize: "12px" }}>
          Click any employee to filter calls and see their live phone activity
        </small>
      </div>

      {/* Horizontal Scrollable Circles Strip */}
      <div
        className="employee-circle-strip"
        style={{
          display: "flex",
          gap: "10px",
          overflowX: "auto",
          paddingBottom: "10px",
          scrollbarWidth: "thin",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* All Staff Chip */}
        <button
          type="button"
          onClick={() => onSelectEmployee(null)}
          className={`employee-circle-item ${selectedEmployeeId === null ? "selected" : ""}`}
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "10px 14px",
            background: selectedEmployeeId === null ? "var(--surface)" : "#ffffff",
            border: selectedEmployeeId === null ? "2px solid var(--primary)" : "1px solid var(--line)",
            borderRadius: "14px",
            cursor: "pointer",
            textAlign: "center",
            minWidth: "105px",
            boxShadow: selectedEmployeeId === null ? "0 4px 12px rgba(31, 95, 157, 0.14)" : "none",
            transition: "all 120ms ease",
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: selectedEmployeeId === null ? "var(--primary)" : "#f1f5f9",
              color: selectedEmployeeId === null ? "#ffffff" : "#475569",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: "13px",
              marginBottom: "6px",
              border: "1px solid var(--line)",
            }}
          >
            ALL
          </div>
          <strong style={{ fontSize: "12px", display: "block", color: "var(--text)" }}>
            All Staff
          </strong>
          <span style={{ fontSize: "10px", color: "var(--muted)", display: "block", marginTop: "2px" }}>
            19 Phones
          </span>
          <span
            style={{
              marginTop: "4px",
              fontSize: "10px",
              fontWeight: 700,
              background: "#f1f5f9",
              color: "var(--muted)",
              padding: "1px 6px",
              borderRadius: "999px",
            }}
          >
            {calls.length} calls
          </span>
        </button>

        {/* Individual Employee Circles */}
        {employeeStatusList.map(item => {
          const isSelected = selectedEmployeeId === item.employee.employee_id;
          const phoneDisplay = item.phoneNumber.startsWith("+91")
            ? item.phoneNumber.slice(3)
            : item.phoneNumber;

          return (
            <button
              key={item.employee.employee_id}
              type="button"
              onClick={() => onSelectEmployee(isSelected ? null : item.employee.employee_id)}
              className={`employee-circle-item ${isSelected ? "selected" : ""}`}
              style={{
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "10px 12px",
                background: isSelected ? "var(--surface)" : "#ffffff",
                border: isSelected ? "2px solid var(--primary)" : "1px solid var(--line)",
                borderRadius: "14px",
                cursor: "pointer",
                textAlign: "center",
                minWidth: "115px",
                boxShadow: isSelected
                  ? "0 4px 14px rgba(31, 95, 157, 0.16)"
                  : "0 2px 6px rgba(15, 23, 42, 0.03)",
                transition: "all 120ms ease",
                position: "relative",
              }}
            >
              {/* Avatar with Status Indicator Dot */}
              <div style={{ position: "relative", marginBottom: "6px" }}>
                <EmployeeAvatar
                  employeeId={item.employee.employee_id}
                  employeeName={item.employee.employee_name}
                  photoUpdatedAt={item.employee.profile_photo_updated_at}
                  size="md"
                />
                {item.isSpeaking ? (
                  <span
                    title="Speaking on call right now"
                    style={{
                      position: "absolute",
                      bottom: "-2px",
                      right: "-2px",
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: "#10b981",
                      border: "2px solid #ffffff",
                      animation: "pulseSpeaking 1.5s infinite",
                    }}
                  />
                ) : (
                  <span
                    title="Phone ready"
                    style={{
                      position: "absolute",
                      bottom: "-2px",
                      right: "-2px",
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#64748b",
                      border: "2px solid #ffffff",
                    }}
                  />
                )}
              </div>

              {/* Employee Name */}
              <strong
                style={{
                  fontSize: "12px",
                  display: "block",
                  color: isSelected ? "var(--primary)" : "var(--text)",
                  whiteSpace: "nowrap",
                  maxWidth: "100px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.employee.employee_name}
              </strong>

              {/* Phone Line */}
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                  fontVariantNumeric: "tabular-nums",
                  display: "block",
                  marginTop: "2px",
                  fontWeight: 500,
                }}
              >
                {phoneDisplay || item.deviceId || "No line"}
              </span>

              {/* Status Pill */}
              <div style={{ marginTop: "5px" }}>
                {item.isSpeaking ? (
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
                      padding: "1px 6px",
                      borderRadius: "999px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    ● Speaking
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "10px",
                      color: "var(--muted)",
                      background: "#f1f5f9",
                      padding: "1px 6px",
                      borderRadius: "999px",
                      fontWeight: 600,
                    }}
                  >
                    {item.callCount} calls
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Employee Filter Indicator */}
      {selectedEmployeeInfo && (
        <div
          style={{
            marginTop: "10px",
            padding: "10px 14px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <EmployeeAvatar
              employeeId={selectedEmployeeInfo.employee.employee_id}
              employeeName={selectedEmployeeInfo.employee.employee_name}
              photoUpdatedAt={selectedEmployeeInfo.employee.profile_photo_updated_at}
              size="xs"
            />
            <div>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e3a8a" }}>
                Viewing calls for {selectedEmployeeInfo.employee.employee_name} ({selectedEmployeeInfo.employee.employee_id})
              </span>
              <small style={{ display: "block", fontSize: "11px", color: "#3b82f6" }}>
                Assigned Device: {selectedEmployeeInfo.deviceId} · Phone Number: {selectedEmployeeInfo.phoneNumber} · Total {selectedEmployeeInfo.callCount} calls
              </small>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelectEmployee(null)}
            style={{
              border: "1px solid #93c5fd",
              background: "#ffffff",
              color: "#1d4ed8",
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ✕ Clear Filter (Show All)
          </button>
        </div>
      )}
    </div>
  );
}
