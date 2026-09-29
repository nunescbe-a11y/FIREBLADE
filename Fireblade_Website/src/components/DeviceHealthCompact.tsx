"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DeviceHealthView } from "@/lib/types";
import HealthStatusPill from "@/components/HealthStatusPill";
import EmployeeAvatar from "@/components/EmployeeAvatar";

export default function DeviceHealthCompact() {
  const [rows, setRows] = useState<DeviceHealthView[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const r = await fetch("/api/device-health", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not load device health");
      setRows(data.devices || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load device health");
    }
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="panel health-compact-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Live phone monitoring</p><h2>Device Status</h2></div>
        <Link href="/device-health">View details</Link>
      </div>
      {error ? <div className="error-banner">{error}</div> : (
        <div className="table-scroll">
          <table className="health-table health-table-compact">
            <thead><tr><th>Device</th><th>Employee</th><th>Phone Status</th><th>Mobile Data</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={4} className="empty-state">No registered devices.</td></tr> : rows.map(row => (
                <tr key={row.device_id}>
                  <td><strong>{row.device_id}</strong></td>
                  <td>{row.employee_name ? <div className="employee-inline"><EmployeeAvatar employeeId={row.employee_id} employeeName={row.employee_name} photoUpdatedAt={row.profile_photo_updated_at} size="xs"/><span>{row.employee_name}</span></div> : <span className="muted">Unassigned</span>}</td>
                  <td><HealthStatusPill value={row.phone_status} /></td>
                  <td><HealthStatusPill value={row.mobile_data_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
