import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kotlin = readFileSync(new URL(
  '../../Android_Call_Collector/android/app/src/main/java/com/nunes/callcollector/ShaneCallDetailActivity.kt',
  import.meta.url,
), 'utf8');
const bridge = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function saveAndSendBody() {
  const start = kotlin.indexOf('    private fun saveAndSend()');
  const end = kotlin.indexOf('    private fun shaneSnapshot(', start);
  assert.ok(start >= 0 && end > start, 'Shane saveAndSend source must be present');
  return kotlin.slice(start, end);
}

test('Shane save never opens personal WhatsApp chats on cached-disabled group mode', () => {
  const saving = saveAndSendBody();
  assert.doesNotMatch(saving, /openWhatsApp\s*\(/);
  assert.doesNotMatch(saving, /startRecipientQueue\s*\(/);
  assert.doesNotMatch(saving, /launchDirectWhatsApp\s*\(/);
  assert.doesNotMatch(saving, /openGenericShare\s*\(/);
  assert.doesNotMatch(saving, /isGroupModeEnabled\s*\(/);
  assert.match(saving, /db\.withTransaction\s*\{/);
  assert.match(saving, /ShaneAssignmentEventEntity\s*\(/);
  assert.match(saving, /AutomationScheduler\.enqueueSync\s*\(/);
  assert.match(saving, /finish\s*\(\s*\)/);
});

test('Shane assignment confirmations do not claim a message was sent', () => {
  const saving = saveAndSendBody();
  assert.match(saving, /Saved locally and syncing to Fireblade/);
  assert.match(saving, /Check Admin for WhatsApp delivery/);
  assert.doesNotMatch(saving, /Sending to \$groupName/);
  assert.match(kotlin, /else "Save Details"/);
  assert.doesNotMatch(kotlin, /WhatsApp opens for selected employees/);
});

test('bridge READY transitions sync connection and trigger queued dispatch only for Shane', () => {
  const readyHandler = bridge.slice(bridge.indexOf("client.on('ready', () => {"), bridge.indexOf("client.on('auth_failure',"));
  assert.match(readyHandler, /if \(key === 'fb_md'\) setTimeout\(\(\) => void maybeCatchupPendingGroupReport/);
  assert.match(readyHandler, /if \(key === shaneSessionKey\)/);
  assert.match(readyHandler, /syncShaneConnectionStatus\(s\)/);
  assert.match(readyHandler, /processPendingShaneGroupAssignments\('WHATSAPP_READY'\)/);
  assert.match(bridge, /if \(key === shaneSessionKey\) void syncShaneConnectionStatus\(s\)/);
});
