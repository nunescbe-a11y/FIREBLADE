"use client";

import { useState, useMemo } from "react";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import type { HandoverEmployee, HandoverCallDetail } from "@/app/api/shane-handover/route";

function formatIST(epochMs: number | string | null | undefined): string {
  if (!epochMs) return "N/A";
  const num = typeof epochMs === "number" ? epochMs : new Date(epochMs).getTime();
  if (isNaN(num) || num <= 0) return "N/A";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(num));
}

type AssignmentItem = HandoverEmployee["assignments"][0];

export default function ShaneHandoverClient({
  initialData,
}: {
  initialData: {
    marketing_employees: HandoverEmployee[];
    service_employees: HandoverEmployee[];
  };
}) {
  const [departmentTab, setDepartmentTab] = useState<"MARKETING" | "SERVICE">("MARKETING");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    initialData.marketing_employees[0]?.employee_id || ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showTestRecords, setShowTestRecords] = useState(true);
  const [activeModalItem, setActiveModalItem] = useState<AssignmentItem | null>(null);

  const currentEmployees = departmentTab === "MARKETING" ? initialData.marketing_employees : initialData.service_employees;

  // Ensure an active employee is selected when switching tabs
  const handleTabSwitch = (tab: "MARKETING" | "SERVICE") => {
    setDepartmentTab(tab);
    const targetList = tab === "MARKETING" ? initialData.marketing_employees : initialData.service_employees;
    if (targetList.length > 0) {
      setSelectedEmployeeId(targetList[0].employee_id);
    } else {
      setSelectedEmployeeId("");
    }
  };

  const selectedEmployee = useMemo(() => {
    return currentEmployees.find((e) => e.employee_id === selectedEmployeeId) || currentEmployees[0] || null;
  }, [currentEmployees, selectedEmployeeId]);

  const filteredAssignments = useMemo(() => {
    if (!selectedEmployee) return [];
    let list = selectedEmployee.assignments;

    if (!showTestRecords) {
      list = list.filter((item) => {
        const name = (item.call_detail.customer_name || "").toUpperCase();
        return !name.startsWith("TEST-");
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((item) => {
        const d = item.call_detail;
        return (
          d.customer_name.toLowerCase().includes(q) ||
          d.phone_number_raw.includes(q) ||
          d.phone_number_normalized.includes(q) ||
          d.product_asked.toLowerCase().includes(q) ||
          d.location.toLowerCase().includes(q) ||
          d.notes.toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [selectedEmployee, searchQuery, showTestRecords]);

  return (
    <div className="handover-container" style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        className="handover-header"
        style={{
          background: "linear-gradient(135deg, #0D253F 0%, #1A365D 100%)",
          color: "#FFFFFF",
          padding: "1.75rem 2rem",
          borderRadius: "14px",
          marginBottom: "1.75rem",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.12)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Shane&apos;s Handover Overview
          </h1>
          <p style={{ margin: "0.35rem 0 0 0", opacity: 0.88, fontSize: "0.95rem" }}>
            Customer assignment event records &amp; handover tracking for Marketing &amp; Service departments
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem", opacity: 0.95, cursor: "pointer", background: "rgba(255,255,255,0.1)", padding: "0.4rem 0.8rem", borderRadius: "8px" }}>
            <input
              type="checkbox"
              checked={showTestRecords}
              onChange={(e) => setShowTestRecords(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Include Test Customer Records
          </label>
        </div>
      </div>

      {/* Department Navigation Tabs */}
      <div
        className="department-tabs"
        style={{
          display: "flex",
          gap: "0.75rem",
          marginBottom: "1.5rem",
          borderBottom: "2px solid var(--border-color, #E2E8F0)",
          paddingBottom: "0.5rem",
        }}
      >
        <button
          type="button"
          onClick={() => handleTabSwitch("MARKETING")}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            fontWeight: 600,
            borderRadius: "8px 8px 0 0",
            border: "none",
            cursor: "pointer",
            background: departmentTab === "MARKETING" ? "#1E40AF" : "transparent",
            color: departmentTab === "MARKETING" ? "#FFFFFF" : "var(--text-color, #475569)",
            transition: "all 0.2s ease",
          }}
        >
          Marketing Department ({initialData.marketing_employees.length} Employees)
        </button>
        <button
          type="button"
          onClick={() => handleTabSwitch("SERVICE")}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            fontWeight: 600,
            borderRadius: "8px 8px 0 0",
            border: "none",
            cursor: "pointer",
            background: departmentTab === "SERVICE" ? "#047857" : "transparent",
            color: departmentTab === "SERVICE" ? "#FFFFFF" : "var(--text-color, #475569)",
            transition: "all 0.2s ease",
          }}
        >
          Service Department (Alagupriya - EMP-008)
        </button>
      </div>

      {/* Main Layout Grid: Sidebar Employee List + Customer Details Pane */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem", alignItems: "start" }}>
        {/* Left Sidebar: Employee Roster */}
        <div
          style={{
            background: "var(--card-bg, #FFFFFF)",
            borderRadius: "12px",
            border: "1px solid var(--border-color, #E2E8F0)",
            padding: "1rem",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          }}
        >
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "0.95rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748B" }}>
            Select Employee ({currentEmployees.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "650px", overflowY: "auto" }}>
            {currentEmployees.map((emp) => {
              const isSelected = selectedEmployeeId === emp.employee_id;
              return (
                <button
                  key={emp.employee_id}
                  type="button"
                  onClick={() => setSelectedEmployeeId(emp.employee_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.75rem 1rem",
                    borderRadius: "10px",
                    border: isSelected ? "2px solid #2563EB" : "1px solid var(--border-color, #E2E8F0)",
                    background: isSelected ? "rgba(37, 99, 235, 0.08)" : "var(--item-bg, #F8FAFC)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <EmployeeAvatar
                      employeeId={emp.employee_id}
                      employeeName={emp.employee_name}
                      photoUpdatedAt={emp.profile_photo_updated_at}
                      size="sm"
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem", color: isSelected ? "#1E40AF" : "inherit" }}>
                        {emp.employee_name}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#64748B" }}>{emp.employee_id}</div>
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "0.2rem 0.6rem",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      background: emp.assignments_count > 0 ? (isSelected ? "#2563EB" : "#3B82F6") : "#94A3B8",
                      color: "#FFFFFF",
                    }}
                  >
                    {emp.assignments_count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Content Pane: Handover Details for Selected Employee */}
        <div>
          {selectedEmployee ? (
            <div
              style={{
                background: "var(--card-bg, #FFFFFF)",
                borderRadius: "12px",
                border: "1px solid var(--border-color, #E2E8F0)",
                padding: "1.5rem",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
              }}
            >
              {/* Employee Overview Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingBottom: "1.25rem",
                  marginBottom: "1.25rem",
                  borderBottom: "1px solid var(--border-color, #E2E8F0)",
                  flexWrap: "wrap",
                  gap: "1rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <EmployeeAvatar
                    employeeId={selectedEmployee.employee_id}
                    employeeName={selectedEmployee.employee_name}
                    photoUpdatedAt={selectedEmployee.profile_photo_updated_at}
                    size="lg"
                  />
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700 }}>
                      {selectedEmployee.employee_name}&apos;s Handover Customers
                    </h2>
                    <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.88rem", color: "#64748B" }}>
                      Employee ID: <strong>{selectedEmployee.employee_id}</strong> • Department: <strong>{selectedEmployee.department_name}</strong>
                    </p>
                  </div>
                </div>
                <div style={{ width: "280px" }}>
                  <input
                    type="text"
                    placeholder="Search customers, products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.6rem 0.9rem",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color, #CBD5E1)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>
              </div>

              {/* Assignment Cards List */}
              {filteredAssignments.length === 0 ? (
                <div
                  style={{
                    padding: "3rem 1.5rem",
                    textAlign: "center",
                    color: "#64748B",
                    background: "var(--item-bg, #F8FAFC)",
                    borderRadius: "10px",
                    border: "1px dashed #CBD5E1",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📋</div>
                  <h4 style={{ margin: "0 0 0.4rem 0", fontSize: "1.1rem", color: "#334155" }}>
                    No assigned customers found for {selectedEmployee.employee_name}
                  </h4>
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>
                    {searchQuery ? "Try adjusting your search query." : "Shane Sir has not created any assignment events for this employee yet."}
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {filteredAssignments.map((item) => {
                    const d = item.call_detail;
                    return (
                      <div
                        key={item.event_id}
                        style={{
                          background: "var(--card-sub-bg, #FFFFFF)",
                          border: d.very_urgent ? "2px solid #EF4444" : "1px solid var(--border-color, #E2E8F0)",
                          borderRadius: "10px",
                          padding: "1.25rem",
                          boxShadow: "0 2px 5px rgba(0, 0, 0, 0.03)",
                          transition: "transform 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#0F172A" }}>
                                {d.customer_name || "Unspecified Customer"}
                              </h3>
                              {d.very_urgent && (
                                <span style={{ background: "#EF4444", color: "#FFFFFF", padding: "0.15rem 0.55rem", borderRadius: "10px", fontSize: "0.72rem", fontWeight: 700 }}>
                                  VERY URGENT
                                </span>
                              )}
                              <span style={{ background: "#3B82F6", color: "#FFFFFF", padding: "0.15rem 0.55rem", borderRadius: "10px", fontSize: "0.72rem", fontWeight: 600 }}>
                                {item.event_type}
                              </span>
                            </div>
                            <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.92rem", color: "#334155" }}>
                              📞 <strong>{d.phone_number_raw || d.phone_number_normalized}</strong>
                              {d.location && <span> • 📍 {d.location}</span>}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveModalItem(item)}
                            style={{
                              padding: "0.55rem 1.1rem",
                              fontSize: "0.88rem",
                              fontWeight: 600,
                              color: "#2563EB",
                              background: "rgba(37, 99, 235, 0.1)",
                              border: "1px solid rgba(37, 99, 235, 0.2)",
                              borderRadius: "8px",
                              cursor: "pointer",
                            }}
                          >
                            View Details
                          </button>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                            gap: "0.75rem",
                            marginTop: "1rem",
                            paddingTop: "0.85rem",
                            borderTop: "1px solid var(--border-color, #F1F5F9)",
                            fontSize: "0.86rem",
                          }}
                        >
                          <div>
                            <span style={{ color: "#64748B" }}>Product / Requirement:</span>
                            <div style={{ fontWeight: 600, color: "#1E293B" }}>{d.product_asked || "Not specified"}</div>
                          </div>
                          <div>
                            <span style={{ color: "#64748B" }}>Assigned Employee:</span>
                            <div style={{ fontWeight: 600, color: "#1E293B" }}>
                              {selectedEmployee.employee_name} ({selectedEmployee.employee_id})
                            </div>
                          </div>
                          <div>
                            <span style={{ color: "#64748B" }}>Call Date / Time (IST):</span>
                            <div style={{ fontWeight: 600, color: "#1E293B" }}>{formatIST(d.call_started_at_epoch_ms)}</div>
                          </div>
                          <div>
                            <span style={{ color: "#64748B" }}>Actual Assignment Time (IST):</span>
                            <div style={{ fontWeight: 600, color: "#047857" }}>{formatIST(item.occurred_at_epoch_ms)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "2rem", textAlign: "center", color: "#64748B" }}>Select an employee from the sidebar.</div>
          )}
        </div>
      </div>

      {/* View Details Modal */}
      {activeModalItem && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(3px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => setActiveModalItem(null)}
        >
          <div
            style={{
              background: "var(--modal-bg, #FFFFFF)",
              borderRadius: "14px",
              padding: "1.75rem",
              maxWidth: "680px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", borderBottom: "1px solid var(--border-color, #E2E8F0)", paddingBottom: "0.75rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700 }}>Handover Customer Details</h2>
              <button
                type="button"
                onClick={() => setActiveModalItem(null)}
                style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#64748B" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", fontSize: "0.92rem" }}>
              <div style={{ background: "var(--item-bg, #F8FAFC)", padding: "1rem", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "#1E293B" }}>Customer Overview</h4>
                <div><strong>Name:</strong> {activeModalItem.call_detail.customer_name}</div>
                <div><strong>Phone:</strong> {activeModalItem.call_detail.phone_number_raw || activeModalItem.call_detail.phone_number_normalized}</div>
                <div><strong>Product Asked:</strong> {activeModalItem.call_detail.product_asked}</div>
                <div><strong>Location:</strong> {activeModalItem.call_detail.location || "N/A"}</div>
                {activeModalItem.call_detail.notes && <div><strong>Notes:</strong> {activeModalItem.call_detail.notes}</div>}
              </div>

              <div style={{ background: "var(--item-bg, #F8FAFC)", padding: "1rem", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "#1E293B" }}>Assignment Event Record</h4>
                <div><strong>Event ID:</strong> <code style={{ fontSize: "0.85rem" }}>{activeModalItem.event_id}</code></div>
                <div><strong>Event Type:</strong> {activeModalItem.event_type}</div>
                <div><strong>Assigned Employee ID:</strong> {activeModalItem.assigned_to_employee_id}</div>
                <div><strong>Actual Assignment Time (IST):</strong> {formatIST(activeModalItem.occurred_at_epoch_ms)}</div>
                <div><strong>Recorded in Database:</strong> {formatIST(activeModalItem.recorded_at)}</div>
                {activeModalItem.whatsapp_recipient_number && (
                  <div><strong>WhatsApp Recipient Number:</strong> {activeModalItem.whatsapp_recipient_number}</div>
                )}
              </div>

              {Object.keys(activeModalItem.form_snapshot || {}).length > 0 && (
                <div style={{ background: "var(--item-bg, #F8FAFC)", padding: "1rem", borderRadius: "8px" }}>
                  <h4 style={{ margin: "0 0 0.5rem 0", color: "#1E293B" }}>Form Snapshot Payload</h4>
                  <pre style={{ background: "#0F172A", color: "#38BDF8", padding: "0.75rem", borderRadius: "6px", fontSize: "0.8rem", overflowX: "auto" }}>
                    {JSON.stringify(activeModalItem.form_snapshot, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div style={{ marginTop: "1.5rem", textAlign: "right" }}>
              <button
                type="button"
                onClick={() => setActiveModalItem(null)}
                style={{ padding: "0.6rem 1.25rem", background: "#475569", color: "#FFFFFF", border: "none", borderRadius: "8px", fontWeight: 600, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
