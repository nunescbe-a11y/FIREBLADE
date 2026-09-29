// Receipt time is authoritative. Android can defer workers and phone clocks can drift.
export type PhoneState = "ON CONFIRMED" | "OFF CONFIRMED" | "NO RESPONSE" | "NO RECENT SIGNAL" | "UNKNOWN";
export type CheckRecord = {
  request_id: string; device_id: string; requested_at: string; expires_at: string;
  responded_at: string | null; status: "PENDING" | "RESPONDED";
  delivery_status?: string; requested_by?: string; snapshot?: Record<string, unknown> | null;
};
type Evidence = {
  heartbeat_at: string; received_at?: string | null; event_type: string;
  shutdown_confirmed_at: string | null; source_verified?: boolean;
  internet_available: boolean | null; mobile_data_state: "ON" | "OFF" | "UNKNOWN";
};
export const FRESH_MS = 12 * 60 * 1000;
export function deviceStatus(h: Evidence | null, check: CheckRecord | null, now = Date.now()) {
  const receipt = Date.parse(h?.received_at || h?.heartbeat_at || "");
  const age = now - receipt;
  const fresh = Number.isFinite(age) && age >= -5000 && age <= FRESH_MS;
  // A verified shutdown remains authoritative until a newer verified non-shutdown
  // report replaces the latest device-health row. Do not expire physical-off
  // evidence merely because the phone can no longer send heartbeats.
  const shutdown = !!h?.source_verified && h.event_type === "SHUTDOWN" &&
    Number.isFinite(Date.parse(h.shutdown_confirmed_at || ""));
  const active = fresh && h?.event_type !== "SHUTDOWN";
  const checkStatus = !check ? "NONE" : check.status === "RESPONDED" ? "RESPONDED" :
    Date.parse(check.expires_at) <= now ? "NO RESPONSE" : "PENDING";
  const state: PhoneState = shutdown ? "OFF CONFIRMED" : active ? "ON CONFIRMED" :
    checkStatus === "NO RESPONSE" ? "NO RESPONSE" : h ? "NO RECENT SIGNAL" : "UNKNOWN";
  return {
    state, phone_working: shutdown ? "NO" as const : active ? "YES" as const : "UNKNOWN" as const,
    internet_status: active && h?.internet_available != null ? (h.internet_available ? "ON" : "OFF") : "UNKNOWN",
    mobile_data_status: active ? h?.mobile_data_state || "UNKNOWN" : "UNKNOWN",
    check_status: checkStatus, fresh: !!active,
    phone_status: shutdown ? "OFF" as const : active ? "ON" as const : "UNKNOWN" as const,
    phone_status_detail: shutdown ? "CONFIRMED_SHUTDOWN" as const : active ? "LIVE" as const : h ? "STALE" as const : "NO_DATA" as const,
  };
}
