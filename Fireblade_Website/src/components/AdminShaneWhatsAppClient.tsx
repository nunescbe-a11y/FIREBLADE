"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";

type Group = { id: string; name: string };

type MemberRosterItem = {
  employee_id: string;
  employee_name: string;
  device_id: string | null;
  phone_number: string | null;
  in_group: boolean;
  participant_id: string | null;
  participant_jid: string | null;
  can_mention: boolean;
  status_note: string;
};

type MembersData = {
  group_id: string;
  total_participants: number;
  roster: MemberRosterItem[];
  all_mentionable: boolean;
  unmatched_count: number;
};

type WhatsAppMessage = {
  id: string;
  direction: string;
  recipient_number: string;
  sender_number: string;
  message_type: string;
  provider_message_id: string | null;
  status: string;
  error_message: string | null;
  payload: any;
  created_at: string;
  updated_at: string;
};

type ShaneStatus = {
  status?: string;
  number?: string | null;
  qr_data_url?: string | null;
  error?: string | null;
  is_shane_number?: boolean;
  config?: {
    group_id?: string;
    group_name?: string;
    enabled?: boolean;
    activation_timestamp_ms?: number;
    allowed_sender_numbers?: string[];
  } | null;
  groups?: Group[];
  group_error?: string | null;
  members?: MembersData | null;
  members_error?: string | null;
  messages?: WhatsAppMessage[];
  messages_error?: string | null;
};

const RECOMMENDED_GROUP_ID = "120363413977876124@g.us";
const SHANE_PHONE_CANONICAL = "9345226022";

function statusClass(status?: string | null) {
  if (status === "READY" || status === "SENT") return "success";
  if (status === "QR_READY" || status === "STARTING" || status === "UNCERTAIN" || status === "QUEUED") return "warning";
  if (status === "FAILED" || status === "ERROR" || status === "UNAVAILABLE") return "warning";
  return "neutral";
}

function formatIst(value?: string | null | number) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

export default function AdminShaneWhatsAppClient({ user }: { user: SessionUser }) {
  const [data, setData] = useState<ShaneStatus>({ status: "LOADING" });
  const [selectedGroup, setSelectedGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [messageFilter, setMessageFilter] = useState<"ALL" | "SENT" | "FAILED" | "UNCERTAIN">("ALL");
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());
  const [pollCounter, setPollCounter] = useState(3);

  const loadData = useCallback(async (includeHeavy = false) => {
    try {
      const params = new URLSearchParams();
      if (includeHeavy) {
        params.set("groups", "1");
        params.set("members", "1");
        params.set("messages", "1");
      } else {
        params.set("messages", "1");
        if (data.status === "READY") {
          params.set("groups", "1");
          params.set("members", "1");
        }
      }

      const res = await fetch(`/api/admin/shane-whatsapp?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok && json.status !== "UNAVAILABLE") {
        throw new Error(json.error || "Failed to load Shane WhatsApp status");
      }
      setData(json);
      setLastRefreshed(Date.now());
      if (json.config?.group_id && !selectedGroup) {
        setSelectedGroup(json.config.group_id);
      }
      if (json.status === "UNAVAILABLE") {
        setError(json.error || "WhatsApp Bridge is unavailable");
      } else if (json.group_error) {
        setError(json.group_error);
      }
    } catch (e) {
      setData(prev => ({ ...prev, status: "UNAVAILABLE" }));
      setError(e instanceof Error ? e.message : "Failed to load Shane WhatsApp status");
    }
  }, [data.status, selectedGroup]);

  // Polling loop
  useEffect(() => {
    void loadData(true);
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void loadData(false);
      }
    }, 4000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  // Visual countdown indicator for live QR polling
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPollCounter(c => (c <= 1 ? 4 : c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const connect = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/shane-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect" }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || "Could not start Shane WhatsApp");
      setNotice(resJson.status === "READY" ? "Shane WhatsApp is connected." : "Shane WhatsApp session started. Scan the QR code when ready.");
      await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Shane WhatsApp");
    } finally {
      setBusy(false);
    }
  };

  const resetSession = async () => {
    const ok = window.confirm(
      "Are you sure you want to reset Shane Sir's WhatsApp session?\n\nThis will clear any partial pairing state for fb_shane_assignments and generate a fresh QR code.\n\nNOTE: The 9:15 AM daily report session (fb_md) is isolated and will NOT be affected."
    );
    if (!ok) return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/shane-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || "Could not reset Shane WhatsApp session");
      setNotice("Shane WhatsApp session reset successfully. A fresh QR code has been generated. Ready to scan!");
      await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset session");
    } finally {
      setBusy(false);
    }
  };

  const saveGroup = async () => {
    if (!selectedGroup) return;
    setGroupBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/shane-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_group", group_id: selectedGroup, enabled: true }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || "Could not save group");
      setNotice(`Shane Sir WhatsApp group configured: ${resJson.group_name || selectedGroup}. Automatic dispatch is ENABLED.`);
      await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save group");
    } finally {
      setGroupBusy(false);
    }
  };

  const toggleSending = async (enable: boolean) => {
    setToggleBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/shane-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", enabled: enable }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || "Could not toggle assignment sending");
      setNotice(enable ? "Automatic assignment sending ENABLED." : "Automatic assignment sending PAUSED.");
      await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not toggle assignment sending");
    } finally {
      setToggleBusy(false);
    }
  };

  const retryMessage = async (detailId: string) => {
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/shane-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", detail_id: detailId }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || "Could not initiate retry");
      setNotice(`Retry initiated for detail ${detailId}. Queue processor is executing.`);
      await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry assignment");
    }
  };

  const triggerQueueNow = async () => {
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/shane-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger_queue" }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || "Could not trigger queue");
      setNotice("Queue check triggered successfully.");
      await loadData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not trigger queue");
    }
  };

  const groups = data.groups || [];
  const members = data.members;
  const isEnabled = data.config?.enabled ?? false;
  const configuredGroupId = data.config?.group_id;
  const configuredGroupName = data.config?.group_name;

  const connectedDigits = String(data.number || "").replace(/\D/g, "");
  const isShaneNumberMatched = connectedDigits.endsWith(SHANE_PHONE_CANONICAL);

  const filteredMessages = useMemo(() => {
    const list = data.messages || [];
    if (messageFilter === "ALL") return list;
    return list.filter(m => m.status === messageFilter);
  }, [data.messages, messageFilter]);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin only • Fireblade Issue #16</p>
          <h1>Admin → Shane Sir WhatsApp</h1>
          <p>
            Dedicated WhatsApp Web connection (<code>fb_shane_assignments</code>) for Shane Sir&apos;s automated customer assignments to the Marketing WhatsApp group.
            Isolated completely from the MD 09:15 daily pending report (<code>fb_md</code>).
          </p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void loadData(true)}>
            Refresh All
          </button>
          <button className="secondary-button" onClick={() => void triggerQueueNow()}>
            Process Queue Now
          </button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      {/* Warning Banners */}
      {data.status === "READY" && !isShaneNumberMatched && (
        <div className="error-banner" role="alert">
          <strong>⚠️ Number Mismatch Warning:</strong> Connected WhatsApp number ({data.number}) does not match Shane Sir&apos;s official number ({SHANE_PHONE_CANONICAL}).
          Automatic assignment delivery is paused until Shane Sir&apos;s correct number is linked.
        </div>
      )}

      {data.status === "READY" && !configuredGroupId && (
        <div className="notice-banner">
          <strong>Action Required:</strong> WhatsApp is connected, but no destination group has been selected yet.
          Select <strong>Nunes Daily Call Pending Report</strong> below and click Save Group.
        </div>
      )}

      {members && !members.all_mentionable && (
        <div className="notice-banner">
          <strong>⚠️ Membership Warning:</strong> {members.unmatched_count} Marketing employee(s) are missing from the WhatsApp group or have unlinked numbers.
          Assignments for these employees will be safely held in queue and will NOT be dispatched without genuine @mentions.
        </div>
      )}

      {/* Grid: Connection & Group Control */}
      <div className="whatsapp-grid">
        {/* Panel 1: Connection & Live QR */}
        <section className="panel wa-connection">
          <div className="panel-heading">
            <h2>Shane Sir Connection</h2>
            <span className={`status-pill ${statusClass(data.status)}`}>{data.status || "UNKNOWN"}</span>
          </div>

          <p className="muted">
            Session: <code>fb_shane_assignments</code> • Target Number: <strong>+91 {SHANE_PHONE_CANONICAL}</strong>
          </p>

          {data.number && (
            <div style={{ margin: "10px 0" }}>
              <strong>Connected number:</strong> {data.number}{" "}
              {isShaneNumberMatched ? (
                <span className="status-pill success">Verified Shane Sir</span>
              ) : (
                <span className="status-pill warning">Mismatch</span>
              )}
            </div>
          )}

          {data.status === "QR_READY" && data.qr_data_url && (
            <div className="qr-box">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted)", marginBottom: "8px" }}>
                <span>Live WhatsApp Pairing QR</span>
                <span>Refreshing in {pollCounter}s (Live)</span>
              </div>
              <img src={data.qr_data_url} alt="Shane Sir WhatsApp connection QR code" />
              <p style={{ marginTop: "12px", fontSize: "13px" }}>
                <strong>How to scan:</strong><br />
                1. Open WhatsApp on Shane Sir&apos;s phone (<strong>{SHANE_PHONE_CANONICAL}</strong>).<br />
                2. Tap <strong>Settings (or ⋮) → Linked Devices → Link a Device</strong>.<br />
                3. Point camera at this live QR code.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "14px" }}>
            {data.status !== "READY" && (
              <button className="primary-button" disabled={busy} onClick={() => void connect()}>
                {busy ? "Starting..." : data.status === "QR_READY" ? "Refresh QR" : "Start Connection"}
              </button>
            )}

            <button className="secondary-button" disabled={busy} onClick={() => void resetSession()}>
              Reset Session & Clean QR
            </button>
          </div>

          <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--muted)" }}>
            Last polled: {new Date(lastRefreshed).toLocaleTimeString()} • Bridge: <code>http://127.0.0.1:3100</code>
          </div>
        </section>

        {/* Panel 2: Group Selection & Dispatch Automation */}
        <section className="panel wa-share">
          <div className="panel-heading">
            <h2>Destination WhatsApp Group</h2>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className={`status-pill ${isEnabled ? "success" : "neutral"}`}>
                {isEnabled ? "AUTOMATED DISPATCH ACTIVE" : "DISPATCH PAUSED"}
              </span>
            </div>
          </div>

          <div className="call-proof-grid">
            <div>
              <span>Configured Group</span>
              <strong>{configuredGroupName || "None selected"}</strong>
            </div>
            <div>
              <span>Group ID</span>
              <strong style={{ fontSize: "11px", wordBreak: "break-all" }}>{configuredGroupId || "-"}</strong>
            </div>
            <div>
              <span>Dispatch Mode</span>
              <strong>{isEnabled ? "AUTOMATIC" : "PAUSED"}</strong>
            </div>
            <div>
              <span>Activated At</span>
              <strong>{data.config?.activation_timestamp_ms ? formatIst(data.config.activation_timestamp_ms) : "-"}</strong>
            </div>
          </div>

          {data.status !== "READY" ? (
            <div className="empty-panel">
              Scan the QR code above on Shane Sir&apos;s phone first. Once connected, groups from his account will appear here.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "14px", marginTop: "10px" }}>
              <label>
                <span>Select Target Group from Shane Sir&apos;s WhatsApp:</span>
                <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
                  <option value="">Choose a WhatsApp group...</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} {g.id === RECOMMENDED_GROUP_ID ? "⭐ (Recommended: Nunes Daily Report)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="primary-button"
                  disabled={groupBusy || !selectedGroup}
                  onClick={() => void saveGroup()}
                >
                  {groupBusy ? "Saving..." : selectedGroup === configuredGroupId ? "Re-verify Group" : "Save Selected Group"}
                </button>

                <button
                  className="secondary-button"
                  disabled={toggleBusy || !configuredGroupId}
                  onClick={() => void toggleSending(!isEnabled)}
                >
                  {toggleBusy ? "Updating..." : isEnabled ? "Pause Automatic Sending" : "Enable Automatic Sending"}
                </button>
              </div>

              <p className="muted" style={{ fontSize: "12px" }}>
                Selecting this group configures Shane Sir&apos;s Android app. When he taps <strong>Save, Assign & Send</strong>,
                customer details are posted directly to this group with genuine @mentions without any manual interaction.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Diagnostics Panel: "Unable to Link" Resolution */}
      <section className="panel" style={{ marginTop: "24px" }}>
        <div className="panel-heading">
          <h2>Pairing Diagnostics & &quot;Unable to Link&quot; Resolution</h2>
          <button className="secondary-button" onClick={() => setShowDiagnostics(!showDiagnostics)}>
            {showDiagnostics ? "Hide Troubleshooting" : "Show Troubleshooting"}
          </button>
        </div>

        {showDiagnostics && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            <div style={{ padding: "14px", background: "var(--surface2)", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <strong>1. Check WhatsApp Device Limit (Max 4)</strong>
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: "8px 0" }}>
                WhatsApp enforces a strict maximum of 4 linked devices per account. If Shane Sir has 4 active devices listed, WhatsApp immediately throws <strong>&quot;Unable to link&quot;</strong>.
              </p>
              <span style={{ fontSize: "12px", color: "var(--primary)" }}>
                Fix: Open phone → Linked Devices → Tap any unused session → Log Out.
              </span>
            </div>

            <div style={{ padding: "14px", background: "var(--surface2)", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <strong>2. Prevent Stale QR Code Scans</strong>
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: "8px 0" }}>
                WhatsApp security challenges expire every 20-30 seconds. Scanning a stale or expired screenshot will be rejected by WhatsApp.
              </p>
              <span style={{ fontSize: "12px", color: "var(--primary)" }}>
                Fix: This page auto-refreshes the live QR code continuously. Scan the code directly off this screen while it is live.
              </span>
            </div>

            <div style={{ padding: "14px", background: "var(--surface2)", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <strong>3. Purge Corrupt LevelDB Cache</strong>
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: "8px 0" }}>
                If an earlier pairing handshake was interrupted mid-way, browser LevelDB can hold half-linked credentials that reject new handshakes.
              </p>
              <span style={{ fontSize: "12px", color: "var(--primary)" }}>
                Fix: Click &quot;Reset Session & Clean QR&quot; above to cleanly wipe the cache and generate fresh pairing keys.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Marketing Employees Roster & @Mention Capability */}
      <section className="panel" style={{ marginTop: "24px" }}>
        <div className="panel-heading">
          <h2>Marketing Employee Group Memberships & Genuine @Mention Capability</h2>
          {members && (
            <span className={`status-pill ${members.all_mentionable ? "success" : "warning"}`}>
              {members.all_mentionable ? "ALL MEMBERS READY FOR @MENTION" : `${members.unmatched_count} UNMATCHED`}
            </span>
          )}
        </div>

        <p className="muted" style={{ marginBottom: "16px" }}>
          Every employee assigned by Shane Sir must exist in the target WhatsApp group with a registered phone number.
          If any assigned employee is missing or unmatchable, Fireblade will safely hold the assignment in queue to prevent posting without genuine @mentions.
        </p>

        {data.status !== "READY" ? (
          <div className="empty-panel">Connect Shane Sir&apos;s WhatsApp to inspect group members and @mention status.</div>
        ) : !members?.roster?.length ? (
          <div className="empty-panel">No Marketing employees or group members loaded yet. Select a destination group above.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Device / Phone</th>
                  <th>In WhatsApp Group?</th>
                  <th>@Mention Status</th>
                  <th>Participant JID</th>
                </tr>
              </thead>
              <tbody>
                {members.roster.map(r => (
                  <tr key={r.employee_id}>
                    <td><strong>{r.employee_id}</strong></td>
                    <td>{r.employee_name}</td>
                    <td>
                      <div>{r.phone_number ? `+91 ${r.phone_number}` : <span className="muted">No phone</span>}</div>
                      {r.device_id && <small className="muted">{r.device_id}</small>}
                    </td>
                    <td>
                      <span className={`status-pill ${r.in_group ? "success" : "warning"}`}>
                        {r.in_group ? "✅ In Group" : "❌ Not in Group"}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${r.can_mention ? "success" : "warning"}`}>
                        {r.can_mention ? "✅ Genuine @mention Ready" : "⚠️ Cannot Mention"}
                      </span>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: "2px" }}>
                        {r.status_note}
                      </small>
                    </td>
                    <td>
                      <code style={{ fontSize: "11px" }}>{r.participant_id || "-"}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* WhatsApp Message Log & Queue Recovery */}
      <section className="panel" style={{ marginTop: "24px" }}>
        <div className="panel-heading">
          <h2>Assignment WhatsApp Messages & Queue Audit</h2>
          <div style={{ display: "flex", gap: "6px" }}>
            {(["ALL", "SENT", "FAILED", "UNCERTAIN"] as const).map(f => (
              <button
                key={f}
                className={`mini-button ${messageFilter === f ? "done" : ""}`}
                onClick={() => setMessageFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <p className="muted" style={{ marginBottom: "14px" }}>
          Real-time audit log of all Shane Sir customer assignment messages dispatched to the WhatsApp group.
          Failed deliveries can be retried safely. Uncertain messages (timed out) require manual WhatsApp check before retry to prevent duplicate posts.
        </p>

        {filteredMessages.length === 0 ? (
          <div className="empty-panel">No {messageFilter.toLowerCase()} WhatsApp messages found in the audit log.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Status</th>
                  <th>Customer Detail</th>
                  <th>Assigned Recipient(s)</th>
                  <th>Provider Message ID / Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMessages.map(msg => {
                  const detailId = msg.payload?.detail_id || "-";
                  const assignees = Array.isArray(msg.payload?.assigned_employee_ids)
                    ? msg.payload.assigned_employee_ids.join(", ")
                    : "-";
                  const isFailed = msg.status === "FAILED";
                  const isUncertain = msg.status === "UNCERTAIN";

                  return (
                    <tr key={msg.id}>
                      <td>{formatIst(msg.created_at)}</td>
                      <td>
                        <span className={`status-pill ${statusClass(msg.status)}`}>
                          {msg.status}
                        </span>
                      </td>
                      <td>
                        <strong>Detail: {detailId}</strong>
                        {msg.recipient_number && <small className="muted">Group: {msg.recipient_number}</small>}
                      </td>
                      <td>
                        <div>{assignees}</div>
                        {msg.payload?.mentions?.length ? (
                          <small className="muted">{msg.payload.mentions.length} mention JID(s)</small>
                        ) : null}
                      </td>
                      <td>
                        {msg.provider_message_id && (
                          <code style={{ fontSize: "11px" }}>{msg.provider_message_id}</code>
                        )}
                        {msg.error_message && (
                          <div style={{ color: "var(--warn)", fontSize: "12px", marginTop: "2px" }}>
                            {msg.error_message}
                          </div>
                        )}
                        {isUncertain && (
                          <div style={{ color: "var(--warn)", fontSize: "11px", marginTop: "2px" }}>
                            ⚠️ Timed out during send. Check WhatsApp group manually before retrying to prevent duplicate messages.
                          </div>
                        )}
                      </td>
                      <td>
                        {isFailed && detailId !== "-" && (
                          <button
                            className="mini-button"
                            onClick={() => void retryMessage(detailId)}
                          >
                            Retry Send
                          </button>
                        )}
                        {isUncertain && (
                          <span className="muted" style={{ fontSize: "11px" }}>Manual check</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Safety Notice Footer */}
      <div style={{ marginTop: "24px", padding: "16px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--line)", fontSize: "13px", color: "var(--muted)" }}>
        <strong>🔒 System Safeguards Enforced:</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
          <li><strong>Zero MD Report Interference:</strong> <code>fb_shane_assignments</code> is entirely isolated from <code>fb_md</code> and will never alter the 9:15 AM pending-calls report.</li>
          <li><strong>No Blind Retries:</strong> Timed-out sends are marked <code>UNCERTAIN</code> and locked against duplicate re-dispatches.</li>
          <li><strong>Mandatory @Mention Validation:</strong> Assignments with unverified or missing employee @mentions are automatically halted.</li>
          <li><strong>Human-Scale Throttling:</strong> Sends are serialized with safety pauses to minimize WhatsApp rate restrictions.</li>
        </ul>
      </div>
    </>
  );
}
