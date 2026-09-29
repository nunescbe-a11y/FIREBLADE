import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { supabaseRest } from "./supabase";
export class AccessError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function requireUser(request?: Request, management = false) {
  const user = await getSession();
  if (!user) throw new AccessError(401, "Sign in required");
  if (user.role !== "ADMIN" && !(management && user.role === "MANAGEMENT")) throw new AccessError(403, "Access denied");
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin) {
      // Next may use an internal localhost URL behind a reverse proxy. A browser's
      // Origin must match the incoming Host, not that internal server address.
      let originUrl: URL;
      try { originUrl = new URL(origin); } catch { throw new AccessError(403, "Invalid request origin"); }
      const host = request.headers.get("host") || new URL(request.url).host;
      if (!["http:", "https:"].includes(originUrl.protocol) || originUrl.host.toLowerCase() !== host.toLowerCase()) throw new AccessError(403, "Invalid request origin");
    }
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new AccessError(403, "Invalid request origin");
  }
  return user;
}
export function apiError(e: unknown) {
  console.error("Fireblade request failed", e instanceof Error ? e.message : "Unknown error");
  return NextResponse.json({ error: e instanceof Error ? e.message : "Request failed" }, { status: e instanceof AccessError ? e.status : 500 });
}
export async function audit(actor: string, action: string, subject: string, details: unknown = {}) {
  return supabaseRest("fireblade_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ actor, action, subject, details }) });
}
export function uuid(value: unknown) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
