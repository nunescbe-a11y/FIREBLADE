"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  answered_by: string | null;
  updated_at: string | null;
};

type ReportRow = {
  enquiry_id: string;
  call_id: number;
  call_at: string;
  employee_id: string;
  employee_name: string;
  device_id: string;
  source_kind: string;
  very_urgent: boolean | null;
  customer_name: string;
  customer_company: string;
  customer_phone: string;
  product_name: string;
  location?: string | null;
  requirement_details: string | null;
  notes: string | null;
  information_items: InformationItem[];
};

function istDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function callTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function InformationSentReportClient() {
  const today = istDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [types, setTypes] = useState<InformationType[]>([]);
  const [employee, setEmployee] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ from, to });
      const response = await fetch(`/api/management/information-sent?${q}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Information Sent report");
      setRows(data.rows || []);
      setTypes(data.types || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Information Sent report");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

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
        row.device_id,
        row.very_urgent === true ? "very urgent" : "",
        row.customer_name,
        row.customer_company,
        row.customer_phone,
        row.product_name,
        row.location,
        row.requirement_details,
        row.notes,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }, [employee, rows, search]);

  const exportUrl = (format: "csv" | "xlsx") => {
    const q = new URLSearchParams({ from, to, format });
    if (employee) q.set("employee", employee);
    return `/api/management/information-sent?${q.toString()}`;
  };

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin & Management</p>
          <h1>Information Sent Report</h1>
          <p>Review saved call details from employee phones, including Shane's enquiries. Material selections do not prove WhatsApp delivery.</p>
        </div>
        <div className="header-actions">
          <a className="secondary-button" href={exportUrl("csv")}>Export CSV</a>
          <a className="primary-button" href={exportUrl("xlsx")}>Export Excel</a>
        </div>
      </div>

      <section className="panel information-report-controls">
        <label><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span>To</span><input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          <span>Employee</span>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">All employees</option>
            {employees.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
          </select>
        </label>
        <label className="information-report-search">
          <span>Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer, product, location, phone..." />
        </label>
        <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <div className="table-card information-report-card">
        <div className="table-meta">
          <span>{loading ? "Loading..." : `${visible.length} enquiries`}</span>
          <span>{from === to ? from : `${from} to ${to}`} · India time</span>
        </div>
        <div className="table-scroll">
          <table className="information-report-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Location</th>
                <th>Very Urgent</th>
                <th>Device</th>
                {types.map((type) => <th key={type.id}>{type.label} Sent</th>)}
                <th>Call Date / Time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7 + types.length} className="empty-state">Loading report...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7 + types.length} className="empty-state">No saved enquiry details match this period.</td></tr>
              ) : visible.map((row) => {
                const itemById = new Map((row.information_items || []).map((item) => [item.id, item]));
                return (
                  <tr key={row.enquiry_id}>
                    <td><strong>{row.employee_name || "Unassigned"}</strong><small>{row.employee_id}</small>{row.source_kind === "SAVED_PHONE_DETAILS" && <small>Saved on phone</small>}</td>
                    <td><strong>{row.customer_name || "Customer"}</strong><small>{row.customer_company || row.customer_phone}</small>{row.customer_company && <small>{row.customer_phone}</small>}</td>
                    <td><strong>{row.product_name}</strong>{row.requirement_details && <small>{row.requirement_details}</small>}{row.notes && <small>Notes: {row.notes}</small>}</td>
                    <td><strong>{row.location || "—"}</strong></td>
                    <td>{row.very_urgent === true ? <span className="status-pill warning">VERY URGENT</span> : row.very_urgent === false ? "No" : "—"}</td>
                    <td><small>{row.device_id || "—"}</small></td>
                    {types.map((type) => {
                      const item = itemById.get(type.id);
                      return (
                        <td key={type.id}>
                          {!item ? <span className="status-pill neutral">Not recorded</span> : item.sent ? (
                            <span className="status-pill success">Yes</span>
                          ) : (
                            <>
                              <span className="status-pill warning">No</span>
                              {item.remarks && <small className="information-no-remark">{item.remarks}</small>}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td><strong>{callTime(row.call_at)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}