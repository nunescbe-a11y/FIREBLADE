import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bridgeRequest } from "@/lib/whatsapp";
import { supabaseRest } from "@/lib/supabase";

async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { session };
}

type Participant = {
  id: string;
  user: string;
  number?: string;
  phoneNumberJid?: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
};

type Employee = {
  employee_id: string;
  employee_name: string;
  department_id: string | null;
};

type Department = {
  id: string;
  name: string;
};

type Assignment = {
  employee_id: string;
  device_id: string;
  company_phone_number: string | null;
};

type Connection = {
  employee_id: string;
  whatsapp_number: string | null;
  status: string;
};

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const wantsGroups = url.searchParams.get("groups") === "1";
  const wantsMembers = url.searchParams.get("members") === "1";
  const wantsMessages = url.searchParams.get("messages") === "1";
  const requestedGroupId = url.searchParams.get("group_id");

  try {
    const status = await bridgeRequest<any>("/management/shane-whatsapp/status");
    const responseData: any = { ...status };

    // 1. Groups listing
    if (wantsGroups && status.status === "READY") {
      try {
        const groupResult = await bridgeRequest<any>("/management/shane-whatsapp/groups");
        responseData.groups = groupResult.groups || [];
        responseData.group_error = null;
      } catch (groupErr) {
        responseData.groups = [];
        responseData.group_error = groupErr instanceof Error ? groupErr.message : "Could not load WhatsApp groups";
      }
    }

    // 2. Members and genuine @mention checking
    const targetGroupId = requestedGroupId || status.config?.group_id;
    if (wantsMembers && status.status === "READY" && targetGroupId) {
      try {
        const membersResult = await bridgeRequest<{ ok: boolean; group_id: string; participants: Participant[] }>(
          `/management/shane-whatsapp/group-members?group_id=${encodeURIComponent(targetGroupId)}`
        );
        const participants = Array.isArray(membersResult.participants) ? membersResult.participants : [];

        // Fetch roster to match against participants
        const [employees, departments, assignments, connections] = await Promise.all([
          supabaseRest<Employee[]>("fireblade_employees?select=employee_id,employee_name,department_id&active=eq.true&order=employee_name.asc"),
          supabaseRest<Department[]>("fireblade_departments?select=id,name&active=eq.true"),
          supabaseRest<Assignment[]>("fireblade_device_assignments?select=employee_id,device_id,company_phone_number&assigned_until=is.null"),
          supabaseRest<Connection[]>("fireblade_whatsapp_connections?select=employee_id,whatsapp_number,status"),
        ]);

        const marketingDeptIds = new Set(
          (departments || [])
            .filter(d => (d.name || "").trim().toUpperCase() === "MARKETING")
            .map(d => d.id)
        );
        const serviceDeptIds = new Set(
          (departments || [])
            .filter(d => (d.name || "").trim().toUpperCase() === "SERVICE")
            .map(d => d.id)
        );

        // Include Marketing + special Service recipient (EMP-008 Alagupriya)
        const relevantEmployees = (employees || []).filter(e => {
          if (marketingDeptIds.has(e.department_id || "")) return true;
          if (e.employee_id === "EMP-008" && serviceDeptIds.has(e.department_id || "")) return true;
          return false;
        });

        const assignmentMap = new Map((assignments || []).map(a => [a.employee_id, a]));
        const connectionMap = new Map((connections || []).map(c => [c.employee_id, c]));

        const employeeRoster = relevantEmployees.map(emp => {
          const asg = assignmentMap.get(emp.employee_id);
          const conn = connectionMap.get(emp.employee_id);
          const rawPhone = (asg?.company_phone_number || conn?.whatsapp_number || "").replace(/\D/g, "");
          const phone10 = rawPhone.slice(-10);

          let matchedParticipant: Participant | null = null;
          if (phone10) {
            matchedParticipant = participants.find(p => {
              const pNum = String(p.number || "").replace(/\D/g, "");
              const pUser = String(p.user || "").replace(/\D/g, "");
              return (pNum && pNum.slice(-10) === phone10) || (pUser && pUser.slice(-10) === phone10);
            }) || null;
          }

          const inGroup = Boolean(matchedParticipant);
          const canMention = inGroup && Boolean(matchedParticipant?.id);

          let statusNote = "Ready for genuine @mention";
          if (!phone10) {
            statusNote = "No phone number linked or assigned";
          } else if (!inGroup) {
            statusNote = "Not a member of the WhatsApp group";
          }

          return {
            employee_id: emp.employee_id,
            employee_name: emp.employee_name,
            device_id: asg?.device_id || null,
            phone_number: phone10 || null,
            in_group: inGroup,
            participant_id: matchedParticipant?.id || null,
            participant_jid: matchedParticipant?.phoneNumberJid || null,
            can_mention: canMention,
            status_note: statusNote,
          };
        });

        responseData.members = {
          group_id: targetGroupId,
          total_participants: participants.length,
          roster: employeeRoster,
          all_mentionable: employeeRoster.every(r => r.can_mention),
          unmatched_count: employeeRoster.filter(r => !r.can_mention).length,
        };
      } catch (memberErr) {
        responseData.members = null;
        responseData.members_error = memberErr instanceof Error ? memberErr.message : "Could not inspect group members";
      }
    }

    // 3. WhatsApp messages log & queue
    if (wantsMessages) {
      try {
        const messages = await supabaseRest<any[]>(
          "fireblade_whatsapp_messages?message_type=eq.SHANE_GROUP_ASSIGNMENT&order=created_at.desc&limit=50"
        );
        responseData.messages = Array.isArray(messages) ? messages : [];
      } catch (msgErr) {
        responseData.messages = [];
        responseData.messages_error = msgErr instanceof Error ? msgErr.message : "Could not load assignment message logs";
      }
    }

    return NextResponse.json(responseData);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Shane WhatsApp bridge is unavailable",
        status: "UNAVAILABLE",
      },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();

  try {
    if (action === "connect") {
      const result = await bridgeRequest<any>("/sessions/fb_shane_assignments/start", {
        method: "POST",
      });
      return NextResponse.json(result);
    }

    if (action === "reset") {
      // Safely destroys session-fb_shane_assignments only and starts fresh session for new pairing
      const result = await bridgeRequest<any>("/management/shane-whatsapp/reset", {
        method: "POST",
      });
      return NextResponse.json(result);
    }

    if (action === "set_group") {
      const groupId = String(body.group_id || "").trim();
      if (!groupId.endsWith("@g.us")) {
        return NextResponse.json({ error: "Select a valid WhatsApp group" }, { status: 400 });
      }

      const result = await bridgeRequest<any>("/management/shane-whatsapp/group", {
        method: "POST",
        body: JSON.stringify({
          group_id: groupId,
          enabled: body.enabled !== false,
        }),
      });
      return NextResponse.json(result);
    }

    if (action === "toggle") {
      const enabled = Boolean(body.enabled);
      const result = await bridgeRequest<any>("/management/shane-whatsapp/toggle", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      return NextResponse.json(result);
    }

    if (action === "retry") {
      const detailId = String(body.detail_id || "").trim();
      if (!detailId) {
        return NextResponse.json({ error: "detail_id is required for retry" }, { status: 400 });
      }

      const result = await bridgeRequest<any>("/management/shane-whatsapp/retry-message", {
        method: "POST",
        body: JSON.stringify({ detail_id: detailId }),
      });
      return NextResponse.json(result);
    }

    if (action === "trigger_queue") {
      const result = await bridgeRequest<any>("/automation/shane-group-assignments", {
        method: "POST",
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Shane WhatsApp action failed",
      },
      { status: 502 }
    );
  }
}
