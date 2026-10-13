import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = path => readFileSync(resolve(root, path), "utf8");

test("Shane Android uses the original employee-by-employee direct WhatsApp handoff", () => {
  const source = read("Android_Call_Collector/android/app/src/main/java/com/nunes/callcollector/ShaneCallDetailActivity.kt");
  const api = read("Android_Call_Collector/android/app/src/main/java/com/nunes/callcollector/control/ShaneMarketingApi.kt");
  assert.match(source, /val message = buildMessage\(/);
  assert.match(source, /selectedRecipients\.filter \{/);
  assert.match(source, /startRecipientQueue\(message, whatsappRecipients, saved\)/);
  assert.match(source, /launchDirectWhatsApp\(queuedMessage, recipient\.phoneNumber, packageName\)/);
  assert.match(source, /https:\/\/wa\.me\/\$digits\?text=/);
  assert.match(source, /rememberWhatsAppHandoff\(recipient\)/);
  assert.match(source, /WHATSAPP_HANDOFF_OPENED/);
  assert.match(source, /cannot verify whether the previous WhatsApp message was sent/);
  assert.doesNotMatch(source, /ShaneMarketingApi\.isGroupModeEnabled|SHANE_GROUP_ASSIGNMENT|Never launch a direct WhatsApp chat/);
  assert.doesNotMatch(api, /isGroupModeEnabled|getGroupName|group_mode_enabled/);
});

test("Backend returns recipient numbers but never switches on group dispatch", () => {
  const backend = read("Cloud_Backend_V1_2/api/fireblade_v3.py");
  const tests = read("Cloud_Backend_V1_2/tests/test_api.py");
  assert.match(backend, /return \{"department": "MARKETING", "employees": recipients\}/);
  assert.doesNotMatch(backend, /group_mode_enabled|target_group_name/);
  assert.doesNotMatch(tests, /test_shane_marketing_recipients_group_mode_enabled/);
});

test("Shane group bridge automation and public management surface are completely removed", () => {
  const bridge = read("WhatsApp_Bridge/server.js");
  const watchdog = read("WhatsApp_Bridge/START_FIREBLADE_WHATSAPP_PERMANENT.ps1");
  const shell = read("Fireblade_Website/src/components/AppShell.tsx");
  for (const pattern of [
    /processPendingShaneGroupAssignments/, /FIREBLADE_SHANE_GROUP_ASSIGNMENTS_START/,
    /management\/shane-whatsapp/, /automation\/shane-group-assignments/,
    /shane-group-logic\.js/
  ]) assert.doesNotMatch(bridge, pattern);
  assert.doesNotMatch(watchdog, /session-fb_shane_assignments|FIREBLADE_SHANE_GROUP_CONFIG/);
  assert.doesNotMatch(shell, /admin\/shane-whatsapp/);
  assert.equal(existsSync(resolve(root, "Fireblade_Website/src/app/admin/shane-whatsapp/page.tsx")), false);
  assert.equal(existsSync(resolve(root, "Fireblade_Website/src/app/api/admin/shane-whatsapp/route.ts")), false);
  assert.equal(existsSync(resolve(root, "WhatsApp_Bridge/shane-group-logic.js")), false);
});

test("MD WhatsApp report, session protection, and IndiaMART navigation stay intact", () => {
  const bridge = read("WhatsApp_Bridge/server.js");
  const watchdog = read("WhatsApp_Bridge/START_FIREBLADE_WHATSAPP_PERMANENT.ps1");
  const shell = read("Fireblade_Website/src/components/AppShell.tsx");
  assert.match(bridge, /sendPendingGroupReport/);
  assert.match(bridge, /app\.get\('\/management\/md-whatsapp\/status'/);
  assert.match(bridge, /if \(targetKey === 'fb_md'\)/);
  assert.match(watchdog, /sessions\/fb_md\/start/);
  assert.match(shell, /canManage && item\("\/indiamart-calls", "IndiaMART Calls"\)/);
  assert.match(shell, /isMarketing \? "My Calls" : "General Calls"/);
});
