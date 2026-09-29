import { NextResponse } from "next/server";
import { authenticate, setSession } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return NextResponse.json({ error: "Employee ID / username and password are required" }, { status: 400 });
  try {
    const user = await authenticate(username, password);
    if (!user) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    await setSession(user);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    console.error("[Fireblade Gen2 login]", error);
    return NextResponse.json({ error: "Login service is temporarily unavailable" }, { status: 503 });
  }
}
