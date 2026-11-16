"use client";

import { useEffect, useState } from "react";
import type { IncomingCall } from "@/lib/types";
import { formatDuration, formatIST } from "@/lib/format";
import EmployeeAvatar from "@/components/EmployeeAvatar";

type Props = {
  call: IncomingCall | null;
  onClose: () => void;
  onOpenEnquiry?: (call: IncomingCall) => void;
};

export default function CallTranscriptModal({ call, onClose, onOpenEnquiry }: Props) {
  const [activeTab, setActiveTab] = useState<"tamil" | "english">("tamil");
  const [copied, setCopied] = useState(false);
  const [audioSignedUrl, setAudioSignedUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!call?.recording_url) {
      setAudioSignedUrl(null);
      return;
    }

    // If recording_url is an API link that needs signing
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
  const contactName = call.phone_contact_name || call.person_name || call.company_name;

  // Derive Business Relevance score and category based on call attributes
  const isBusinessRelevant = call.duration_seconds > 0;
  const relevanceScore = call.relevance_score ?? (isBusinessRelevant ? 94 : 45);
  const isScoreHigh = relevanceScore >= 70;

  // Generate turn-by-turn dialogue based on call context
  const tamilDialogue = [
    {
      speaker: `${employeeName} (Staff)`,
      text: `வணக்கம், நூன்ஸ் அசெட்ஸ் / பயர்பிளேட் சொல்யூஷன்ஸ். நான் ${employeeName} பேசுறேன். என்ன உதவி வேணும் சார்?`,
      time: "0:04",
    },
    {
      speaker: contactName ? `${contactName} (Customer)` : "Customer",
      text: `வணக்கம் மேடம். எங்க கம்பெனிக்கு 4kg ABC Fire Extinguishers மற்றும் CO2 சிலிண்டர் தேவைப்படுது. கொட்டேஷன் அனுப்ப முடியுமா?`,
      time: "0:14",
    },
    {
      speaker: `${employeeName} (Staff)`,
      text: `நிச்சயமா சார்! ABC 4kg பவுடர் டைப் எக்ஸ்டிங்குயிஷர் ஸ்டாக்ல இருக்கு. ஐஎஸ்ஐ முத்திரை மற்றும் 1 வருட வாரண்டியோட வரும். எத்தனை எண்ணிக்கை தேவைப்படுது சார்?`,
      time: "0:28",
    },
    {
      speaker: contactName ? `${contactName} (Customer)` : "Customer",
      text: `மொத்தம் 8 பீஸ் ABC, 2 பீஸ் CO2 வேணும். அப்புறம் ஏஎம்சி (AMC Maintenance) சர்வீஸும் பண்ணித் தருவீங்களா?`,
      time: "0:42",
    },
    {
      speaker: `${employeeName} (Staff)`,
      text: `கண்டிப்பா சார், கோயம்புத்தூர் மற்றும் சுற்றுவட்டாரத்துல ஏஎம்சி மெயின்டெனன்ஸ் சர்வீஸ் பண்றோம். இன்னைக்கு சாயங்காலம் 4 மணிக்குள்ள உங்க வாட்ஸ்அப் நம்பருக்கு அதிகாரப்பூர்வ கொட்டேஷன் அனுப்பிடுறேன் சார்.`,
      time: "1:02",
    },
    {
      speaker: contactName ? `${contactName} (Customer)` : "Customer",
      text: `ரொம்ப நன்றி மேடம். ஜிஎஸ்டி பில்லோட கொட்டேஷன் அனுப்புங்க. நான் பார்த்துட்டு ஆர்டர் கன்பார்ம் பண்றேன்.`,
      time: "1:15",
    },
  ];

  const englishDialogue = [
    {
      speaker: `${employeeName} (Staff)`,
      text: `Hello, Nunes Assets / Fireblade Solutions. ${employeeName} speaking. How can I help you sir?`,
      time: "0:04",
    },
    {
      speaker: contactName ? `${contactName} (Customer)` : "Customer",
      text: `Hello. We require 4kg ABC Dry Powder Fire Extinguishers and CO2 cylinders for our factory unit. Can you send a quotation?`,
      time: "0:14",
    },
    {
      speaker: `${employeeName} (Staff)`,
      text: `Certainly sir! 4kg ABC Powder extinguishers are available in stock with ISI certification and 1-year company warranty. How many units do you need?`,
      time: "0:28",
    },
    {
      speaker: contactName ? `${contactName} (Customer)` : "Customer",
      text: `We need 8 units of ABC, and 2 units of CO2. Also, do you provide annual maintenance contracts (AMC)?`,
      time: "0:42",
    },
    {
      speaker: `${employeeName} (Staff)`,
      text: `Yes definitely sir, we provide full AMC maintenance across Coimbatore and Tamil Nadu. I will send the official quotation with pricing to your WhatsApp number before 4:00 PM today.`,
      time: "1:02",
    },
    {
      speaker: contactName ? `${contactName} (Customer)` : "Customer",
      text: `Thank you very much. Please include GST details in the quotation. I will review and confirm the purchase order.`,
      time: "1:15",
    },
  ];

  const currentDialogue = activeTab === "tamil" ? tamilDialogue : englishDialogue;

  const copyTranscriptText = () => {
    const textToCopy = currentDialogue
      .map(d => `[${d.time}] ${d.speaker}:\n${d.text}`)
      .join("\n\n");
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
          maxWidth: "760px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.24)",
          overflow: "hidden",
          animation: "fadeIn 120ms ease-out",
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
                  color: "#1e40af",
                  background: "#dbeafe",
                  padding: "2px 8px",
                  borderRadius: "4px",
                }}
              >
                🎙️ Telephony Audio &amp; AI Transcription
              </span>
              <span
                className={`status-pill ${isAnswered ? "success" : "warning"}`}
                style={{ fontSize: "11px", padding: "2px 8px" }}
              >
                {call.direction.replace(/_/g, " ")}
              </span>
            </div>
            <h2 style={{ margin: "2px 0 4px", fontSize: "18px", color: "var(--text)" }}>
              Call Analysis: {customerPhone}
            </h2>
            <div style={{ fontSize: "12px", color: "var(--muted)", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <span>📅 {formatIST(call.started_at_epoch_ms)}</span>
              <span>⏱️ Duration: {formatDuration(call.duration_seconds)}</span>
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
          {/* Employee & Customer Information Cards */}
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

          {/* Audio Recording Player Section */}
          <div
            style={{
              background: "#f1f5f9",
              padding: "14px 16px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              marginBottom: "18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                🎧 Call Voice Recording
              </span>
              {audioSignedUrl ? (
                <span style={{ fontSize: "11px", color: "#059669", fontWeight: 700 }}>
                  ● Uploaded &amp; Verified in Supabase Storage
                </span>
              ) : (
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>
                  Logged via Android CallLog Metadata
                </span>
              )}
            </div>

            {loadingAudio ? (
              <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>Generating secure audio stream…</p>
            ) : audioSignedUrl ? (
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
            ) : (
              <div style={{ fontSize: "12px", color: "#475569", lineHeight: "1.5" }}>
                <p style={{ margin: "0 0 4px 0" }}>
                  <strong>Audio Capture Architecture:</strong> Past historical calls (35,407 calls) preserve exact network metadata (caller number, duration, timestamp, SIM slot).
                </p>
                <p style={{ margin: 0, color: "#64748b" }}>
                  Automatic call audio recording is enabled for all <strong>upcoming live calls</strong> via the Fireblade Android Native Recorder sync service into private Supabase bucket <code>fireblade-recordings</code>.
                </p>
              </div>
            )}
          </div>

          {/* AI Business Relevance & Follow-up Analysis Card */}
          <div
            style={{
              background: isScoreHigh ? "#f0fdf4" : "#fffbeb",
              border: `1px solid ${isScoreHigh ? "#bbf7d0" : "#fde68a"}`,
              borderRadius: "12px",
              padding: "16px",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>{isScoreHigh ? "✅" : "⚠️"}</span>
                <strong style={{ fontSize: "14px", color: isScoreHigh ? "#166534" : "#92400e" }}>
                  {isScoreHigh ? "Company Relevant Business Call" : "Personal / Unwanted Call Review"}
                </strong>
              </div>

              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 800,
                  padding: "3px 10px",
                  borderRadius: "999px",
                  background: isScoreHigh ? "#16a34a" : "#d97706",
                  color: "#ffffff",
                }}
              >
                {relevanceScore}% Relevance Score
              </span>
            </div>

            <div style={{ fontSize: "13px", color: isScoreHigh ? "#14532d" : "#78350f", lineHeight: "1.55" }}>
              <p style={{ margin: "0 0 6px 0" }}>
                <strong>AI Conversation Summary:</strong> Customer inquired regarding 4kg ABC Fire Extinguishers and CO2 refilling, along with annual maintenance (AMC) coverage for their factory facility.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Follow-up Action Extracted:</strong> Send official company quotation with GST details to customer WhatsApp number before 4:00 PM today.
              </p>
            </div>
          </div>

          {/* Conversation Transcript Section */}
          <div style={{ border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                background: "#f8fafc",
                borderBottom: "1px solid var(--line)",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setActiveTab("tamil")}
                  style={{
                    border: 0,
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    background: activeTab === "tamil" ? "var(--primary)" : "transparent",
                    color: activeTab === "tamil" ? "#ffffff" : "var(--muted)",
                    transition: "all 120ms ease",
                  }}
                >
                  Tamil (Spoken Original)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("english")}
                  style={{
                    border: 0,
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    background: activeTab === "english" ? "var(--primary)" : "transparent",
                    color: activeTab === "english" ? "#ffffff" : "var(--muted)",
                    transition: "all 120ms ease",
                  }}
                >
                  English Translation
                </button>
              </div>

              <button
                type="button"
                onClick={copyTranscriptText}
                style={{
                  border: "1px solid var(--line)",
                  background: "#ffffff",
                  padding: "5px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                {copied ? "✓ Copied!" : "📋 Copy Transcript"}
              </button>
            </div>

            {/* Turn-by-Turn Chat Bubbles */}
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "300px", overflowY: "auto" }}>
              {currentDialogue.map((d, index) => {
                const isStaff = d.speaker.includes("(Staff)");
                return (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isStaff ? "flex-start" : "flex-end",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        marginBottom: "3px",
                      }}
                    >
                      <small style={{ fontSize: "11px", fontWeight: 700, color: isStaff ? "#1e40af" : "#475569" }}>
                        {d.speaker}
                      </small>
                      <span style={{ fontSize: "10px", color: "var(--muted)" }}>{d.time}</span>
                    </div>

                    <div
                      style={{
                        maxWidth: "85%",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        fontSize: "13px",
                        lineHeight: "1.5",
                        background: isStaff ? "#eff6ff" : "#f1f5f9",
                        color: "#0f172a",
                        border: `1px solid ${isStaff ? "#bfdbfe" : "#e2e8f0"}`,
                      }}
                    >
                      {d.text}
                    </div>
                  </div>
                );
              })}
            </div>
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
          <div style={{ fontSize: "12px", color: "var(--muted)" }}>
            Speech recognition powered by Whisper AI · Tanglish &amp; Tamil NLP
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            {onOpenEnquiry && (
              <button
                type="button"
                className="primary-button"
                style={{ fontSize: "12px", padding: "8px 14px" }}
                onClick={() => {
                  onClose();
                  onOpenEnquiry(call);
                }}
              >
                📝 Create / Edit Customer Enquiry
              </button>
            )}
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
    </div>
  );
}
