import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Legacy Gen 2 endpoint retained only so older Preview clients fail safely.
// Product sharing now uses type-ahead search + server-side package assembly and never dumps the full catalogue.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { error: "Full-catalogue sharing is disabled. Use product search and package assembly." },
    { status: 410 },
  );
}
