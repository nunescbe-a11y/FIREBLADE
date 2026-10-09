"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

export type InformationSentColumnType = {
  id: string;
  label: string;
};

export type InformationSentColumnItem = {
  id: string;
  sent: boolean;
  remarks: string | null;
};

export type InformationSentDisplayRow = {
  enquiry_id: string;
  call_at: string;
  employee_id: string;
  employee_name: string;
  customer_name: string;
  customer_company: string;
  customer_phone: string;
  product_name: string;
  requirement_details: string | null;
  notes: string | null;
  information_items: InformationSentColumnItem[];
  source?: "SHANE" | "ENQUIRY";
  location?: string;
  very_urgent?: boolean;
  detail_id?: string;
  assigned_to_employee_id?: string | null;
  assigned_to_employee_name?: string | null;
  assigned_at?: string | null;
  assigned_at_epoch_ms?: number | null;
};

const COLUMN_LABELS = [
  "Employee", "Customer", "Product", "Call Date / Time",
  "Location", "Assigned To", "Assigned Date / Time",
] as const;

function indiaTime(value: number | string | null | undefined): string {
  if (value == null || value === "") return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function assignmentName(row: InformationSentDisplayRow): string {
  // The call-handling employee is not automatically the person assigned the customer.
  return row.assigned_to_employee_name?.trim()
    || row.assigned_to_employee_id?.trim()
    || "Not recorded";
}

function assignmentTime(row: InformationSentDisplayRow): string {
  if (typeof row.assigned_at_epoch_ms === "number" && row.assigned_at_epoch_ms > 0) {
    return indiaTime(row.assigned_at_epoch_ms);
  }
  return indiaTime(row.assigned_at);
}

export default function InformationSentTable({
  rows, types, loading, className, onViewShaneDetails,
}: {
  rows: InformationSentDisplayRow[];
  types: InformationSentColumnType[];
  loading: boolean;
  className: string;
  onViewShaneDetails?: (detailId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="table-scroll">
      <table className={className}>
        <thead>
          <tr>
            {COLUMN_LABELS.map(label => <th key={label}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="empty-state">Loading information sent...</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="empty-state">No saved enquiry details match this period.</td></tr>
          ) : rows.map(row => {
            const itemById = new Map((row.information_items || []).map(item => [item.id, item]));
            const expanded = expandedId === row.enquiry_id;
            return (
              <Fragment key={row.enquiry_id}>
                <tr>
                  <td>
                    <strong>{row.employee_name || row.employee_id || "Not recorded"}</strong>
                    {row.employee_id && <small>{row.employee_id}</small>}
                  </td>
                  <td>
                    <strong>{row.customer_name || "Not recorded"}</strong>
                    <div style={{ marginTop: 6 }}>
                      <button type="button" className="mini-button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : row.enquiry_id)}>
                        {expanded ? "Hide details" : "View details"}
                      </button>
                    </div>
                  </td>
                  <td><strong>{row.product_name || "Not recorded"}</strong></td>
                  <td>{indiaTime(row.call_at)}</td>
                  <td>{row.location || "Not recorded"}</td>
                  <td>{assignmentName(row)}</td>
                  <td>{assignmentTime(row)}</td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={7}>
                      <div style={{ padding: 12 }}>
                        <strong>Additional customer information</strong>
                        <p style={{ marginTop: 8 }}>
                          Phone: {row.customer_phone || "Not recorded"}
                          {row.customer_company && <> · Company: {row.customer_company}</>}
                        </p>
                        {row.requirement_details && <p>Requirement: {row.requirement_details}</p>}
                        {row.notes && <p>Notes: {row.notes}</p>}
                        {row.source === "SHANE" && <p>Priority: {row.very_urgent ? "Very urgent" : "Normal"}</p>}
                        {row.source !== "SHANE" && types.map(type => {
                          const item = itemById.get(type.id);
                          return (
                            <div key={type.id}>
                              {type.label}: {item ? (item.sent ? "Yes" : "No") : "Not recorded"}
                              {item?.remarks && <> · Remarks: {item.remarks}</>}
                            </div>
                          );
                        })}
                        {row.source === "SHANE" && (
                          <p style={{ marginTop: 8 }}>
                            {onViewShaneDetails && row.detail_id
                              ? <button type="button" className="mini-button"
                                  onClick={() => onViewShaneDetails(row.detail_id!)}>View assignment history</button>
                              : <Link href="/shane-call-details">Open Shane Call Details</Link>}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
