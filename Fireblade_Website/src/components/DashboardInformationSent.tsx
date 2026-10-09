"use client";

import { useMemo, useState } from "react";
import { useVisiblePolling } from "@/lib/use-visible-polling";
import InformationSentTable from "@/components/InformationSentTable";

type InformationType = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
};

type InformationItem = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  sent: boolean;
  remarks: string | null;
};

type ReportRow = {
  enquiry_id: string;
  call_id: number;
  call_at: string;
  employee_id: string;
  employee_name: string;
  customer_name: string;
  customer_company: string;
  customer_phone: string;
  product_name: string;
  requirement_details: string | null;
  notes: string | null;
  information_items: InformationItem[];
  source?: "SHANE" | "ENQUIRY";
  location?: string;
  very_urgent?: boolean;
  assigned_to_employee_id?: string | null;
  assigned_to_employee_name?: string | null;
  assigned_at?: string | null;
  assigned_at_epoch_ms?: number | null;
};

function istDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export default function DashboardInformationSent() {
  const today = istDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [employee, setEmployee] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const {
    data, loading, error, refresh,
  } = useVisiblePolling<{ rows: ReportRow[]; types: InformationType[] }>(
    `/api/management/information-sent?${new URLSearchParams({ from, to, source: "ENQUIRY" }).toString()}`,
    "Could not load Information Sent",
    { enabled: expanded },
  );
  const rows = data?.rows || [];
  const types = data?.types || [];

  const employees = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.employee_id) map.set(row.employee_id, row.employee_name || row.employee_id);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (employee && row.employee_id !== employee) return false;
      if (!q) return true;
      return [
        row.employee_name,
        row.employee_id,
        row.customer_name,
        row.customer_company,
        row.customer_phone,
        row.product_name,
        row.requirement_details,
        row.notes,
        row.location,
        row.source,
        row.assigned_to_employee_name,
        row.assigned_to_employee_id,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }, [employee, rows, search]);

  const exportUrl = (format: "csv" | "xlsx") => {
    const q = new URLSearchParams({ from, to, format, source: "ENQUIRY" });
    if (employee) q.set("employee", employee);
    return `/api/management/information-sent?${q.toString()}`;
  };

  return (
    <section className="overview-dashboard-section overview-information-sent" aria-labelledby="overview-information-sent-heading">
      <div className="overview-section-heading overview-information-sent-heading">
        <div>
          <p className="eyebrow">Customer follow-up</p>
          <h2 id="overview-information-sent-heading">Other Employee Information Sent</h2>
          <p className="muted">Regular employee enquiries. Shane original and test handovers are available in the two boxes above.</p>
          <small style={{ color: "var(--muted)" }}>Automatically refreshes every 5 seconds while this tab is visible.</small>
        </div>

        <div className="overview-information-actions">
          <a className="secondary-button" href={exportUrl("csv")}>CSV</a>
          <a className="secondary-button" href={exportUrl("xlsx")}>Excel</a>
          <button type="button" className="secondary-button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="overview-information-controls">
            <label>
              <span>From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>

            <label>
              <span>To</span>
              <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>

            <label>
              <span>Employee</span>
              <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
                <option value="">All employees</option>
                {employees.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.id}</option>
                ))}
              </select>
            </label>

            <label className="overview-information-search">
              <span>Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer, product, phone..." />
            </label>

            <button type="button" className="secondary-button" disabled={loading} onClick={refresh}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="overview-information-meta">
            <span>{loading ? "Loading..." : `${visible.length} enquir${visible.length === 1 ? "y" : "ies"}`}</span>
            <span>{from === to ? from : `${from} to ${to}`} · India time</span>
          </div>

          <InformationSentTable rows={visible} types={types} loading={loading} className="overview-information-table" />
        </>
      )}
    </section>
  );
}