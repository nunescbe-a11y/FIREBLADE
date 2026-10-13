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

test('Shane save initiates direct individual WhatsApp handoff for each recipient', () => {
  const saving = saveAndSendBody();
  assert.match(saving, /startRecipientQueue\s*\(/);
  assert.match(kotlin, /launchDirectWhatsApp\s*\(/);
  assert.match(saving, /selectedRecipients\.filter\s*\{/);
  assert.doesNotMatch(saving, /isGroupModeEnabled\s*\(/);
  assert.match(saving, /db\.withTransaction\s*\{/);
  assert.match(saving, /ShaneAssignmentEventEntity\s*\(/);
  assert.match(saving, /AutomationScheduler\.enqueueSync\s*\(/);
});

test('Shane handoff dialogs acknowledge individual send without claiming automatic delivery', () => {
  assert.match(kotlin, /cannot verify whether the previous WhatsApp message was sent/);
  assert.match(kotlin, /rememberWhatsAppHandoff\s*\(recipient\)/);
  assert.match(kotlin, /WHATSAPP_HANDOFF_OPENED/);
  assert.doesNotMatch(kotlin, /Check Admin for WhatsApp delivery/);
  assert.doesNotMatch(kotlin, /Sending to \$groupName/);
});

test('bridge READY transitions retain MD catchup while Shane group sender is completely removed', () => {
  const readyHandler = bridge.slice(bridge.indexOf("client.on('ready', () => {"), bridge.indexOf("client.on('auth_failure',"));
  assert.match(readyHandler, /if \(key === 'fb_md'\) setTimeout\(\(\) => void maybeCatchupPendingGroupReport/);
  assert.doesNotMatch(readyHandler, /shaneSessionKey/);
  assert.doesNotMatch(bridge, /processPendingShaneGroupAssignments/);
  assert.doesNotMatch(bridge, /management\/shane-whatsapp/);
});

