import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function startEpoch(date: string) {
  return Date.parse(`${date}T00:00:00+05:30`);
}

function validRange(from: string, to: string) {
  const start = startEpoch(from);
  const end = startEpoch(to) + DAY_MS;
  return Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    end - start <= 366 * DAY_MS;
}

async function performanceRpc(body: Record<string, number>) {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!base || !secret) throw new Error("Supabase server configuration is unavailable");

  const response = await fetch(
    `${base}/rest/v1/rpc/fireblade_performance_intelligence_fast`,
    {
      method: "POST",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Performance report ${response.status}: ${text.slice(0, 240)}`);
  }
  return response.json();
}

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentFrom = request.nextUrl.searchParams.get("currentFrom") || "";
  const currentTo = request.nextUrl.searchParams.get("currentTo") || "";
  const previousFrom = request.nextUrl.searchParams.get("previousFrom") || "";
  const previousTo = request.nextUrl.searchParams.get("previousTo") || "";

  if (
    !DATE_RE.test(currentFrom) ||
    !DATE_RE.test(currentTo) ||
    !DATE_RE.test(previousFrom) ||
    !DATE_RE.test(previousTo) ||
    !validRange(currentFrom, currentTo) ||
    !validRange(previousFrom, previousTo)
  ) {
    return NextResponse.json({ error: "Valid current and previous report dates are required" }, { status: 400 });
  }

  try {
    const report = await performanceRpc({
      p_current_start_epoch_ms: startEpoch(currentFrom),
      p_current_end_epoch_ms: startEpoch(currentTo) + DAY_MS,
      p_previous_start_epoch_ms: startEpoch(previousFrom),
      p_previous_end_epoch_ms: startEpoch(previousTo) + DAY_MS,
    });

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load performance intelligence" },
      { status: 500 },
    );
  }
}