"use client";

import { useEffect, useRef, useState } from "react";
import type { IncomingCall } from "@/lib/types";
import { formatDuration, formatIST } from "@/lib/format";
import EmployeeAvatar from "@/components/EmployeeAvatar";

type Props = {
  call: IncomingCall | null;
  onClose: () => void;
};

export default function CallTranscriptModal({ call, onClose }: Props) {
  const [audioSignedUrl, setAudioSignedUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!call) return;
    setAudioError("");

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
          } else if (data.error) {
            setAudioError(data.error);
            setAudioSignedUrl(null);
          } else {
            setAudioSignedUrl(call.recording_url || null);
          }
        })
        .catch(err => {
          setAudioError(err instanceof Error ? err.message : "Failed to load audio stream");
          setAudioSignedUrl(null);
        })
        .finally(() => setLoadingAudio(false));
    } else {
      setAudioSignedUrl(call.recording_url);
    }
  }, [call]);

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  if (!call) return null;

  const isAnswered = call.direction === "INCOMING_ANSWERED" || call.direction === "OUTGOING_CONNECTED";
  const employeeName = call.registered_employee_name || call.received_by || call.collector_employee || "Staff";
  const customerPhone = call.phone_number_normalized || call.phone_number_raw || "Unknown Customer";
  const cleanPhone = customerPhone.replace(/\D/g, "");
  const contactName = call.person_name || call.phone_contact_name || call.company_name;

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
          maxWidth: "680px",
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
                Call ID: #{call.call_id}
              </span>
            </div>
            <h2 style={{ margin: "2px 0 4px", fontSize: "18px", color: "var(--text)" }}>
              Call Audio Recording: {customerPhone}
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

        {/* Modal Body */}
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

          {/* Real Audio Player */}
          {audioSignedUrl ? (
            <div
              style={{
                background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
                padding: "18px 20px",
                borderRadius: "12px",
                border: "1px solid #a7f3d0",
                boxShadow: "0 4px 12px rgba(16, 185, 129, 0.08)",
                marginBottom: "14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "16px" }}>🎧</span>
                  <span style={{ fontSize: "13px", fontWeight: 800, color: "#065f46" }}>
                    Verified Live Call Audio Recording
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#059669",
                    fontWeight: 800,
                    background: "#ffffff",
                    border: "1px solid #6ee7b7",
                    padding: "2px 8px",
                    borderRadius: "999px",
                  }}
                >
                  ● Stored in Supabase
                </span>
              </div>

              {loadingAudio ? (
                <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>Checking audio stream…</p>
              ) : (
                <div>
                  <audio
                    ref={audioRef}
                    controls
                    src={audioSignedUrl}
                    style={{ width: "100%", height: "42px", borderRadius: "8px" }}
                  />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#065f46", marginRight: "4px" }}>Speed:</span>
                      {[1.0, 1.25, 1.5, 2.0].map(speed => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => changePlaybackRate(speed)}
                          style={{
                            border: playbackRate === speed ? "1px solid #059669" : "1px solid var(--line)",
                            background: playbackRate === speed ? "#059669" : "#ffffff",
                            color: playbackRate === speed ? "#ffffff" : "var(--text)",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                            transition: "all 100ms ease",
                          }}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>

                    <a
                      href={audioSignedUrl}
                      download={`call_${call.call_id}.mp4`}
                      style={{
                        fontSize: "12px",
                        color: "#047857",
                        fontWeight: 700,
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "#ffffff",
                        border: "1px solid #a7f3d0",
                        padding: "4px 10px",
                        borderRadius: "6px",
                      }}
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
                padding: "24px 20px",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "13px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "6px" }}>📵</div>
              <strong style={{ display: "block", color: "var(--text)", marginBottom: "4px" }}>
                No Audio Recording Available for this Call
              </strong>
              <span>
                {call.direction.includes("MISSED") || call.direction.includes("UNANSWERED")
                  ? "This call was missed or unanswered before audio media connection was established."
                  : "Call was tracked via SIM telephony logs without an active mic audio capture."}
              </span>
            </div>
          )}

          {audioError && (
            <div style={{ background: "#fef2f2", color: "#991b1b", padding: "8px 12px", borderRadius: "6px", fontSize: "12px", marginTop: "10px" }}>
              {audioError}
            </div>
          )}
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
                background: "var(--surface)",
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
            onClick={onClose}
            style={{
              padding: "8px 18px",
              borderRadius: "8px",
              border: "1px solid var(--line)",
              background: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
