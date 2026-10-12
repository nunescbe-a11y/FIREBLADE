import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Admin Shane WhatsApp page requires ADMIN role and redirects others', () => {
  const page = read('src/app/admin/shane-whatsapp/page.tsx');
  assert.match(page, /getSession\(\)/, 'Page must retrieve session');
  assert.match(page, /user\.role !== ["']ADMIN["']/, 'Page must check for ADMIN role');
  assert.match(page, /redirect\(["']\/dashboard["']\)/, 'Non-admin users must be redirected to /dashboard');
  assert.match(page, /AdminShaneWhatsAppClient/, 'Page must render AdminShaneWhatsAppClient');
});

test('Admin Shane WhatsApp API route strictly enforces ADMIN role', () => {
  const route = read('src/app/api/admin/shane-whatsapp/route.ts');
  assert.match(route, /requireAdmin/, 'API route must have requireAdmin helper');
  assert.match(route, /session\.role !== ["']ADMIN["']/, 'API route must check session.role === ADMIN');
  assert.match(route, /status:\s*403/, 'API route must return 403 when not ADMIN');
  assert.match(route, /status:\s*401/, 'API route must return 401 when unauthorized');
});

test('Admin Shane WhatsApp API route proxies status, groups, members, reset and retry', () => {
  const route = read('src/app/api/admin/shane-whatsapp/route.ts');
  assert.match(route, /\/management\/shane-whatsapp\/status/, 'Must probe Shane WhatsApp status');
  assert.match(route, /\/management\/shane-whatsapp\/groups/, 'Must support querying Shane WhatsApp groups');
  assert.match(route, /\/management\/shane-whatsapp\/group-members/, 'Must support querying group members');
  assert.match(route, /\/management\/shane-whatsapp\/reset/, 'Must support resetting Shane WhatsApp session');
  assert.match(route, /\/management\/shane-whatsapp\/retry-message/, 'Must support retrying confirmed failed message');
  assert.match(route, /\/management\/shane-whatsapp\/toggle/, 'Must support toggling automatic dispatch');
  assert.match(route, /fireblade_whatsapp_messages/, 'Must query WhatsApp message audit log from Supabase');
});

test('AppShell navigation exposes Shane Sir WhatsApp link to ADMIN only', () => {
  const shell = read('src/components/AppShell.tsx');
  assert.match(shell, /user\.role === ["']ADMIN["'] && item\(["']\/admin\/shane-whatsapp["'],\s*["']Shane Sir WhatsApp["']\)/,
    'AppShell must render Shane Sir WhatsApp link only for ADMIN role');
  assert.doesNotMatch(shell, /isMarketing && item\(["']\/admin\/shane-whatsapp["']/,
    'Shane Sir WhatsApp must NOT be exposed to Marketing role');
});

test('AdminShaneWhatsAppClient component implements all core requirements', () => {
  const client = read('src/components/AdminShaneWhatsAppClient.tsx');
  // 1. Connection status
  assert.match(client, /Shane Sir Connection/, 'Must show connection panel');
  assert.match(client, /9345226022/, 'Must display Shane canonical number');
  // 2. Fresh live QR
  assert.match(client, /qr_data_url/, 'Must display live QR image');
  assert.match(client, /Live WhatsApp Pairing QR/, 'Must show live QR description');
  // 3. Diagnostics & Unable to link resolution
  assert.match(client, /Unable to Link/i, 'Must address Unable to link error');
  assert.match(client, /Reset Session & Clean QR/, 'Must provide clean session reset');
  // 4. Target group selection
  assert.match(client, /120363413977876124@g\.us/, 'Must target Nunes Daily Pending Report group ID');
  // 5. Marketing members & genuine @mention
  assert.match(client, /can_mention/, 'Must verify @mention capability');
  assert.match(client, /Genuine @mention Ready/i, 'Must show mention badge');
  // 6. Dispatch toggle
  assert.match(client, /AUTOMATED DISPATCH ACTIVE/i, 'Must show dispatch toggle state');
  // 7. Audit log & retries
  assert.match(client, /Assignment WhatsApp Messages & Queue Audit/, 'Must show audit log');
  assert.match(client, /Retry Send/, 'Must provide retry button for confirmed failures');
  // 8. Isolation guarantee
  assert.match(client, /fb_md/, 'Must state isolation from fb_md');
});

test('Bridge server safeguards fb_md against reset and guarantees session isolation', () => {
  const bridge = fs.readFileSync(
    path.join(root, '..', 'WhatsApp_Bridge', 'server.js'), 'utf8');

  assert.match(bridge, /if \(targetKey === 'fb_md'\) \{.*return res\.status\(403\)/s,
    'Bridge must strictly block resetting fb_md');
  assert.match(bridge, /shaneSessionKey\s*=\s*SHANE_SESSION_KEY/,
    'Shane session key must be assigned from SHANE_SESSION_KEY');
});
