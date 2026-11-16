"use client";

import { useEffect, useState } from "react";
import type { IncomingCall } from "@/lib/types";
import { formatDuration, formatIST } from "@/lib/format";
import EmployeeAvatar from "@/components/EmployeeAvatar";

type Props = {
  call: IncomingCall | null;
  onClose: () => void;
  onUpdateNotes?: (callId: number, product: string, requirement: string, notes: string) => void;
};

export default function CallTranscriptModal({ call, onClose, onUpdateNotes }: Props) {
  const [audioSignedUrl, setAudioSignedUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Note fields
  const [productName, setProductName] = useState("");
  const [requirementDetails, setRequirementDetails] = useState("");
  const [notes, setNotes] = useState("");
  const [personName, setPersonName] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!call) return;

    setProductName(call.product_name || "");
    setRequirementDetails(call.requirement_details || "");
    setNotes(call.notes || "");
    setPersonName(call.person_name || call.phone_contact_name || "");
    setSaveSuccess(false);
    setSaveError("");

    if (!call.recording_url) {
      setAudioSignedUrl(null);
      return;
    }

    if (call.recording_url.startsWith("/api/recordings")) {
      setLoadingAudio(true);
      fetch(call.recording_url)
        .then(res => res.json())
        .then(data => {
          if (data.signedUrl) {
            setAudioSignedUrl(data.signedUrl);
          } else {
            setAudioSignedUrl(call.recording_url || null);
          }
        })
        .catch(() => {
          setAudioSignedUrl(call.recording_url || null);
        })
        .finally(() => setLoadingAudio(false));
    } else {
      setAudioSignedUrl(call.recording_url);
    }
  }, [call]);

  if (!call) return null;

  const isAnswered = call.direction === "INCOMING_ANSWERED" || call.direction === "OUTGOING_CONNECTED";
  const employeeName = call.registered_employee_name || call.received_by || call.collector_employee || "Staff";
  const customerPhone = call.phone_number_normalized || call.phone_number_raw || "Unknown Customer";
  const cleanPhone = customerPhone.replace(/\D/g, "");
  const contactName = call.person_name || call.phone_contact_name || call.company_name;

  const handleSaveNotes = async () => {
    if (!productName.trim() && !notes.trim()) {
      setSaveError("Please enter product name or conversation notes");
      return;
    }

    setSavingNotes(true);
    setSaveError("");

    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: call.call_id,
          personName: personName.trim() || "Customer",
          productName: productName.trim() || "General Enquiry",
          requirementDetails: requirementDetails.trim(),
          notes: notes.trim(),
          commonRemarks: "Logged via Live Telephony Call Details",
          informationSent: [],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save call details");

      call.product_name = productName.trim();
      call.requirement_details = requirementDetails.trim();
      call.notes = notes.trim();
      call.person_name = personName.trim();

      if (onUpdateNotes) {
        onUpdateNotes(call.call_id, productName.trim(), requirementDetails.trim(), notes.trim());
      }

      setSaveSuccess(true);
      setIsEditingNotes(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save call details");
    } finally {
      setSavingNotes(false);
    }
  };

  const hasRealNotes = Boolean(call.product_name || call.requirement_details || call.notes);

  return (
    <div
      className="transcript-modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "16px",
      }}
    >
      <div
        className="transcript-modal-content"
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "720px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.24)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            background: "#f8fafc",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: isAnswered ? "#059669" : "#dc2626",
                  background: isAnswered ? "#ecfdf5" : "#fef2f2",
                  border: `1px solid ${isAnswered ? "#a7f3d0" : "#fecaca"}`,
                  padding: "2px 8px",
                  borderRadius: "4px",
                }}
              >
                {call.direction.replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                ID: #{call.call_id}
              </span>
            </div>
            <h2 style={{ margin: "2px 0 4px", fontSize: "18px", color: "var(--text)" }}>
              Call Record: {customerPhone}
            </h2>
            <div style={{ fontSize: "12px", color: "var(--muted)", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <span>📅 {formatIST(call.started_at_epoch_ms)}</span>
              <span>⏱️ Talk Time: {formatDuration(call.duration_seconds)}</span>
              <span>📱 Line: {call.company_phone_number || call.device_id}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "#ffffff",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              padding: "6px 10px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              color: "var(--muted)",
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: "1 1 auto" }}>
          {/* Metadata Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              marginBottom: "18px",
            }}
          >
            <div
              style={{
                background: "var(--surface2)",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <EmployeeAvatar
                employeeId={call.registered_employee_id}
                employeeName={employeeName}
                size="sm"
              />
              <div>
                <small style={{ color: "var(--muted)", fontSize: "10px", textTransform: "uppercase" }}>Handled By Staff</small>
                <strong style={{ display: "block", fontSize: "13px" }}>{employeeName}</strong>
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                  {call.registered_employee_id || call.collector_employee || call.device_id}
                </span>
              </div>
            </div>

            <div
              style={{
                background: "var(--surface2)",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
              }}
            >
              <small style={{ color: "var(--muted)", fontSize: "10px", textTransform: "uppercase" }}>Customer Contact</small>
              <strong style={{ display: "block", fontSize: "13px" }}>{contactName || "Direct Phone Caller"}</strong>
              <span style={{ fontSize: "11px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                {customerPhone}
              </span>
            </div>
          </div>

          {/* Real Audio Player (Only if audio was uploaded) */}
          {audioSignedUrl ? (
            <div
              style={{
                background: "#eff6ff",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid #bfdbfe",
                marginBottom: "18px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e40af" }}>
                  🎧 Real Audio Voice Recording
                </span>
                <span style={{ fontSize: "11px", color: "#059669", fontWeight: 700 }}>
                  ● Uploaded &amp; Stored in Supabase
                </span>
              </div>

              {loadingAudio ? (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>Checking audio stream…</p>
              ) : (
                <div>
                  <audio controls src={audioSignedUrl} style={{ width: "100%", height: "36px" }} />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
                    <a
                      href={audioSignedUrl}
                      download={`call_${call.call_id}.mp4`}
                      style={{ fontSize: "11px", color: "#2563eb", fontWeight: 600, textDecoration: "underline" }}
                    >
                      ⬇️ Download Audio File
                    </a>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                background: "#f8fafc",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                color: "var(--muted)",
              }}
            >
              <span>ℹ️</span>
              <span>No audio recording on phone for this call (telephony log only).</span>
            </div>
          )}

          {/* Real Conversation Details & Staff Notes */}
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: "12px",
              padding: "16px 18px",
              marginBottom: "18px",
              background: "#ffffff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <strong style={{ fontSize: "14px", color: "var(--text)" }}>
                Real Conversation Notes &amp; What Was Spoken
              </strong>
              {!isEditingNotes && (
                <button
                  type="button"
                  onClick={() => setIsEditingNotes(true)}
                  style={{
                    border: "1px solid var(--line)",
                    background: "var(--surface2)",
                    color: "var(--text)",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ✏️ {hasRealNotes ? "Edit Notes" : "Add Spoken Notes"}
                </button>
              )}
            </div>

            {saveSuccess && (
              <div style={{ background: "#ecfdf5", color: "#065f46", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", marginBottom: "12px" }}>
                ✓ Call details saved successfully!
              </div>
            )}

            {saveError && (
              <div style={{ background: "#fef2f2", color: "#991b1b", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", marginBottom: "12px" }}>
                {saveError}
              </div>
            )}

            {isEditingNotes ? (
              <div style={{ display: "grid", gap: "10px" }}>
                <label style={{ display: "grid", gap: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>Contact Person Name</span>
                  <input
                    type="text"
                    value={personName}
                    onChange={e => setPersonName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    style={{ padding: "8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "13px" }}
                  />
                </label>

                <label style={{ display: "grid", gap: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>Product Enquired / Discussed</span>
                  <input
                    type="text"
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                    placeholder="e.g. pH Meter, Refractometer, Borewell Camera, etc."
                    style={{ padding: "8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "13px" }}
                  />
                </label>

                <label style={{ display: "grid", gap: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>Requirement Details (Qty / Model / Range)</span>
                  <input
                    type="text"
                    value={requirementDetails}
                    onChange={e => setRequirementDetails(e.target.value)}
                    placeholder="e.g. Qty: 2 nos, Range: 0-14 pH, SIDCO Industrial Estate"
                    style={{ padding: "8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "13px" }}
                  />
                </label>

                <label style={{ display: "grid", gap: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>What Was Spoken / Notes</span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Type the actual conversation details spoken by the customer or employee..."
                    style={{ padding: "8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "13px", resize: "vertical" }}
                  />
                </label>

                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
                  <button
                    type="button"
                    onClick={() => setIsEditingNotes(false)}
                    style={{ padding: "6px 12px", border: "1px solid var(--line)", background: "#ffffff", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingNotes}
                    onClick={handleSaveNotes}
                    className="primary-button"
                    style={{ fontSize: "12px", padding: "6px 14px" }}
                  >
                    {savingNotes ? "Saving…" : "💾 Save Real Call Details"}
                  </button>
                </div>
              </div>
            ) : hasRealNotes ? (
              <div style={{ display: "grid", gap: "10px", fontSize: "13px" }}>
                <div>
                  <small style={{ color: "var(--muted)", display: "block", fontSize: "11px" }}>Product Discussed:</small>
                  <strong>{call.product_name || "Not entered"}</strong>
                </div>

                {call.requirement_details && (
                  <div>
                    <small style={{ color: "var(--muted)", display: "block", fontSize: "11px" }}>Requirement Specifications:</small>
                    <span>{call.requirement_details}</span>
                  </div>
                )}

                {call.notes && (
                  <div style={{ background: "var(--surface2)", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <small style={{ color: "var(--muted)", display: "block", fontSize: "11px", marginBottom: "4px" }}>Staff Conversation Notes:</small>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--text)" }}>{call.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: "16px", background: "var(--surface2)", borderRadius: "8px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
                <p style={{ margin: "0 0 8px 0" }}>
                  No spoken notes recorded yet for this call.
                </p>
                <button
                  type="button"
                  onClick={() => setIsEditingNotes(true)}
                  style={{
                    border: "1px solid #bfdbfe",
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  + Add What Was Spoken on this Call
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid var(--line)",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", gap: "8px" }}>
            {cleanPhone && (
              <a
                href={`https://wa.me/${cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`}?text=${encodeURIComponent(`Hello, thank you for reaching Nunes Assets. Regarding your call...`)}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#25D366",
                  color: "#ffffff",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                💬 WhatsApp Customer
              </a>
            )}
            <a
              href={`tel:${customerPhone}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#ffffff",
                border: "1px solid var(--line)",
                color: "var(--text)",
                padding: "8px 14px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              📞 Call Back
            </a>
          </div>

          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: "12px", padding: "8px 14px" }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
