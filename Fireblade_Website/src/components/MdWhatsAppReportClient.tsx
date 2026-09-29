"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Group = { id: string; name: string };
type MdStatus = {
  status?: string;
  number?: string | null;
  qr_data_url?: string | null;
  error?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  first_delivery_date_ist?: string | null;
  delivery_date_ist?: string | null;
  report_date_ist?: string | null;
  report_status?: string | null;
  report_sent_at?: string | null;
  report_pending_count?: number;
  report_employee_count?: number;
  report_message_count?: number;
  schedule?: string;
  groups?: Group[];
  group_error?: string | null;
};

function statusClass(status?: string | null) {
  if (status === "READY" || status === "SENT" || status === "ALREADY_SENT") return "success";
  if (status === "QR_READY" || status === "WAITING_FOR_WHATSAPP" || status === "DUE" || status === "FAILED") return "warning";
  return "neutral";
}

function reportLabel(status?: string | null) {
  switch (status) {
    case "SENT":
    case "ALREADY_SENT": return "SENT";
    case "WAITING_FOR_WHATSAPP": return "WAITING FOR WHATSAPP";
    case "ARMED_FOR_FIRST_RUN": return "ARMED FOR FIRST RUN";
    case "SCHEDULED": return "SCHEDULED";
    case "DUE": return "DUE";
    case "FAILED": return "RETRY PENDING";
    case "NOT_CONFIGURED": return "GROUP NOT SELECTED";
    default: return status || "UNKNOWN";
  }
}

function formatSentAt(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(date);
}

export default function MdWhatsAppReportClient() {
  const [status, setStatus] = useState<MdStatus>({ status: "LOADING" });
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadStatus = useCallback(async (withGroups = false) => {
    try {
      const response = await fetch(`/api/management/md-whatsapp${withGroups ? "?groups=1" : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok && data.status !== "UNAVAILABLE") throw new Error(data.error || "Could not load MD WhatsApp status");
      setStatus(data);
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
        if (!selectedGroup && data.group_id) setSelectedGroup(data.group_id);
      }
      setError(data.status === "UNAVAILABLE" ? (data.error || "WhatsApp bridge is unavailable") : (data.group_error || ""));
    } catch (e) {
      setStatus(current => ({ ...current, status: "UNAVAILABLE" }));
      setError(e instanceof Error ? e.message : "Could not load MD WhatsApp status");
    }
  }, [selectedGroup]);

  useEffect(() => {
    void loadStatus(false);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadStatus(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (status.status === "READY" && !groups.length) void loadStatus(true);
  }, [status.status, groups.length, loadStatus]);

  const connect = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/management/md-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start MD WhatsApp");
      setNotice(data.status === "READY" ? "MD WhatsApp is connected." : "MD WhatsApp connection started. Scan the QR when it appears.");
      await loadStatus(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start MD WhatsApp");
    } finally {
      setBusy(false);
    }
  };

  const refreshGroups = async () => {
    setGroupBusy(true);
    setError("");
    try { await loadStatus(true); }
    finally { setGroupBusy(false); }
  };

  const saveGroup = async () => {
    if (!selectedGroup) return;
    setGroupBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/management/md-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_group", group_id: selectedGroup }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save report group");
      setNotice(`Daily report group saved: ${data.group_name}.`);
      await loadStatus(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save report group");
    } finally {
      setGroupBusy(false);
    }
  };

  const selectedName = useMemo(
    () => groups.find(group => group.id === selectedGroup)?.name || "",
    [groups, selectedGroup],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Management / MD only</p>
          <h1>MD WhatsApp - 09:15 Report</h1>
          <p>One MD WhatsApp connection controls only the daily pending-callback group report. Employee product sending remains on each employee&apos;s own WhatsApp.</p>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="whatsapp-grid">
        <section className="panel wa-connection">
          <div className="panel-heading">
            <h2>MD WhatsApp Connection</h2>
            <span className={`status-pill ${statusClass(status.status)}`}>{status.status || "UNKNOWN"}</span>
          </div>

          <p className="muted">This dedicated connection is used only for the automated 09:15 management report.</p>
          {status.number && <p><strong>Connected number:</strong> {status.number}</p>}

          {status.status === "QR_READY" && status.qr_data_url && (
            <div className="qr-box">
              <img src={status.qr_data_url} alt="MD WhatsApp connection QR code" />
              <p>On the MD phone: WhatsApp → Linked devices → Link a device → scan this QR.</p>
            </div>
          )}

          {status.status !== "READY" && (
            <button className="primary-button" disabled={busy} onClick={() => void connect()}>
              {busy ? "Starting..." : status.status === "QR_READY" ? "Refresh / Restart QR" : "Connect / Reconnect WhatsApp"}
            </button>
          )}

          {status.status === "READY" && (
            <button className="secondary-button" disabled={busy} onClick={() => void loadStatus(false)}>Refresh Status</button>
          )}

          {status.error && <p className="muted">{status.error}</p>}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Daily Report</h2>
            <span className={`status-pill ${statusClass(status.report_status)}`}>{reportLabel(status.report_status)}</span>
          </div>

          <div className="call-proof-grid">
            <div><span>Schedule</span><strong>{status.schedule || "09:15 IST"}</strong></div>
            <div><span>Report Date</span><strong>{status.report_date_ist || "-"}</strong></div>
            <div><span>Group</span><strong>{status.group_name || "Not selected"}</strong></div>
            <div><span>Pending Calls</span><strong>{status.report_pending_count ?? 0}</strong></div>
          </div>

          {status.first_delivery_date_ist && status.report_status === "ARMED_FOR_FIRST_RUN" && (
            <p className="muted">First automatic delivery: {status.first_delivery_date_ist} at 09:15 AM IST.</p>
          )}

          {status.report_status === "WAITING_FOR_WHATSAPP" && (
            <div className="notice-banner">
              The 09:15 report is waiting. Reconnect the MD WhatsApp above; Fireblade will send automatically as soon as the session becomes READY.
            </div>
          )}

          {status.report_sent_at && <p><strong>Sent at:</strong> {formatSentAt(status.report_sent_at)}</p>}

          <p className="muted">If the PC was off at 09:15, Fireblade sends the missed daily report automatically after the PC starts and the MD WhatsApp is READY. A sent report is not sent twice.</p>
        </section>

        <section className="panel wa-share">
          <div className="panel-heading">
            <h2>Marketing WhatsApp Group</h2>
            <button className="secondary-button" disabled={groupBusy || status.status !== "READY"} onClick={() => void refreshGroups()}>
              {groupBusy ? "Refreshing..." : "Refresh Groups"}
            </button>
          </div>

          {status.status !== "READY" ? (
            <div className="empty-panel">Connect the MD WhatsApp first. Once connected, the groups available on the MD account will appear here.</div>
          ) : (
            <>
              <label>
                <span>Report destination group</span>
                <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
                  <option value="">Select WhatsApp group...</option>
                  {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>

              <p className="muted">Fireblade saves the selected group&apos;s exact WhatsApp group ID, so the report always goes to this specific group even if another group has a similar name.</p>

              <button className="primary-button" disabled={groupBusy || !selectedGroup} onClick={() => void saveGroup()}>
                {groupBusy ? "Saving..." : status.group_id === selectedGroup ? "Save Group Again" : `Use ${selectedName || "Selected Group"}`}
              </button>
            </>
          )}
        </section>
      </div>
    </>
  );
}