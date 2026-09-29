import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bridgeRequest } from "@/lib/whatsapp";

async function requireMd() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.role !== "MANAGEMENT") {
    return { error: NextResponse.json({ error: "Management / MD access required" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: Request) {
  const auth = await requireMd();
  if ("error" in auth) return auth.error;

  try {
    const status = await bridgeRequest<any>("/management/md-whatsapp/status");
    const wantsGroups = new URL(request.url).searchParams.get("groups") === "1";

    if (!wantsGroups || status.status !== "READY") {
      return NextResponse.json(status);
    }

    try {
      const groupResult = await bridgeRequest<any>("/management/md-whatsapp/groups");
      return NextResponse.json({
        ...status,
        groups: groupResult.groups || [],
        group_error: null,
      });
    } catch (groupError) {
      return NextResponse.json({
        ...status,
        groups: [],
        group_error:
          groupError instanceof Error
            ? groupError.message
            : "Could not load WhatsApp groups",
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MD WhatsApp bridge is unavailable",
        status: "UNAVAILABLE",
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireMd();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();

  try {
    if (action === "connect") {
      const result = await bridgeRequest<any>("/sessions/fb_md/start", {
        method: "POST",
      });
      return NextResponse.json(result);
    }

    if (action === "set_group") {
      const groupId = String(body.group_id || "").trim();
      if (!groupId.endsWith("@g.us")) {
        return NextResponse.json(
          { error: "Select a valid WhatsApp group" },
          { status: 400 },
        );
      }

      const result = await bridgeRequest<any>(
        "/management/md-whatsapp/group",
        {
          method: "POST",
          body: JSON.stringify({ group_id: groupId }),
        },
      );

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "MD WhatsApp action failed",
      },
      { status: 502 },
    );
  }
}