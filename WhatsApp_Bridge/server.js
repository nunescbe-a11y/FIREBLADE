import express from 'express';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth, MessageMedia } = pkg;
const app = express();
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 3100);
const apiKey = process.env.FIREBLADE_WHATSAPP_BRIDGE_KEY || '';
const allowedMediaHosts = new Set(
  String(process.env.FIREBLADE_MEDIA_ALLOWED_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
);
const maxMediaBytes = Math.max(1, Number(process.env.FIREBLADE_WHATSAPP_MAX_MEDIA_MB || 20)) * 1024 * 1024;

function resolveBrowserExecutable() {
  const configured = String(
    process.env.FIREBLADE_WHATSAPP_BROWSER_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    '',
  ).trim();
  if (configured && existsSync(configured)) return configured;

  const candidates = process.platform === 'win32'
    ? [
        process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
        process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
  return candidates.filter(Boolean).find(candidate => existsSync(candidate)) || null;
}

const browserExecutablePath = resolveBrowserExecutable();

if (!apiKey) {
  console.error('FIREBLADE_WHATSAPP_BRIDGE_KEY is required');
  process.exit(1);
}

const sessions = new Map();
const authDataPath = process.env.FIREBLADE_WWEBJS_AUTH_PATH || './.wwebjs_auth';
const cleanKey = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
function auth(req, res, next) {
  if (req.get('X-Fireblade-Bridge-Key') !== apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
app.use(auth);

function stateFor(key) {
  if (!sessions.has(key)) sessions.set(key, { key, status: 'DISCONNECTED', qr: null, qrDataUrl: null, number: null, error: null, client: null, starting: false });
  return sessions.get(key);
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown WhatsApp bridge error');
}
function isTransientBrowserError(error) {
  const message = errorMessage(error).toLowerCase();
  return [
    'execution context was destroyed',
    'cannot find context with specified id',
    'most likely because of a navigation',
    'target closed',
    'session closed',
    'resource busy or locked',
    'ebusy',
    'first_party_sets.db',
    'detached frame',
    'attempted to use detached frame',
    'protocol error (runtime.callfunctionon)',
    'initialize timeout',
  ].some(fragment => message.includes(fragment));
}
async function reconcileSession(s) {
  if (!s?.client) return;
  try {
    const state = await s.client.getState();
    if (state === 'CONNECTED') {
      s.status = 'READY';
      s.starting = false;
      s.qr = null;
      s.qrDataUrl = null;
      s.number = s.client.info?.wid?.user || s.number || null;
      s.error = null;
      // FIREBLADE_MD_RECONCILE_CATCHUP
      if (s.key === 'fb_md') setTimeout(() => void maybeCatchupPendingGroupReport('WHATSAPP_RECONCILED'), 1200);
      console.log(`[${s.key}] READY (reconciled)`);
    }
  } catch (error) {
    if (!isTransientBrowserError(error)) console.warn(`[${s.key}] state probe failed: ${errorMessage(error)}`);
  }
}
async function safeDestroySessionClient(s) {
  const client = s?.client;
  if (!client) return;
  s.client = null;
  try {
    await Promise.race([
      client.destroy(),
      sleep(5000),
    ]);
  } catch (error) {
    if (!isTransientBrowserError(error)) console.warn(`[${s.key}] browser cleanup warning: ${errorMessage(error)}`);
  }
  await sleep(750);
}
function localSessionPath(key) {
  return join(resolve(authDataPath), `session-${key}`);
}

// FIREBLADE_AUTO_RECONNECT_V1
const reconnectTimers = new Map();

function scheduleSessionRestart(s, reason, delayMs = 3000) {
  if (!s?.key || s.reconnectSuppressed || s.status === 'QR_READY') return;
  if (reconnectTimers.has(s.key)) return;

  s.status = 'RECONNECTING';
  s.error = String(reason || 'WhatsApp reconnect requested');
  s.starting = false;

  console.warn(`[${s.key}] AUTO_RECONNECT scheduled: ${s.error}`);

  const timer = setTimeout(async () => {
    reconnectTimers.delete(s.key);

    try {
      await safeDestroySessionClient(s);
      await startSession(s.key);
    } catch (error) {
      s.status = 'ERROR';
      s.error = errorMessage(error);
      s.starting = false;

      console.warn(
        `[${s.key}] AUTO_RECONNECT_FAILED: ${s.error}`,
      );

      scheduleSessionRestart(s, s.error, 10000);
    }
  }, delayMs);

  timer.unref?.();
  reconnectTimers.set(s.key, timer);
}

async function recoverSession(s, reason) {
  if (!s?.key || s.reconnectSuppressed || s.status === 'QR_READY') return;

  try {
    if (s.client) {
      const state = await s.client.getState();

      if (state === 'CONNECTED') {
        await reconcileSession(s);
        return;
      }
    }
  } catch (error) {
    const message = errorMessage(error);

    if (!isTransientBrowserError(error)) {
      console.warn(`[${s.key}] recovery probe failed: ${message}`);
    }
  }

  scheduleSessionRestart(s, reason, 2500);
}

process.on('unhandledRejection', reason => {
  const message = errorMessage(reason);
  if (isTransientBrowserError(reason)) {
    console.warn(`[whatsapp-web.js] Recovered transient browser navigation error: ${message}`);
    for (const s of sessions.values()) {
      if (s.client) setTimeout(() => void recoverSession(s, message), 1200);
    }
    return;
  }
  console.error('[WhatsApp bridge] Unhandled async error:', reason);
  for (const s of sessions.values()) {
    if (s.client && s.status !== 'READY') {
      s.status = 'ERROR';
      s.error = message;
      s.starting = false;
    }
  }
});

async function startSession(key) {
  const s = stateFor(key);
  if (s.starting) return s;
  if (s.client && (s.status === 'ERROR' || s.status === 'DISCONNECTED')) await safeDestroySessionClient(s);
  if (s.client) return s;
  s.starting = true;
  s.status = 'STARTING';
  s.error = null;
  s.reconnectSuppressed = false;
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: key, dataPath: authDataPath }),
    puppeteer: {
      headless: true,
      ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });
  s.client = client;
  client.on('qr', async qr => {
    try {
      s.qr = qr;
      s.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      s.status = 'QR_READY';
      s.error = null;
      console.log(`[${key}] QR_READY`);
    } catch (error) {
      s.status = 'ERROR';
      s.error = errorMessage(error);
      s.starting = false;
    }
  });
  client.on('authenticated', () => {
    s.status = 'STARTING';
    s.qr = null;
    s.qrDataUrl = null;
    s.error = null;
    console.log(`[${key}] AUTHENTICATED; waiting for WhatsApp Web to settle`);
    setTimeout(() => void reconcileSession(s), 1500);
    setTimeout(() => void reconcileSession(s), 4000);
    setTimeout(() => void reconcileSession(s), 8000);
  });
  client.on('ready', () => {
    s.status = 'READY';
    s.starting = false;
    s.qr = null;
    s.qrDataUrl = null;
    s.number = client.info?.wid?.user || null;
    s.error = null;
    // FIREBLADE_MD_READY_CATCHUP
    if (key === 'fb_md') setTimeout(() => void maybeCatchupPendingGroupReport('WHATSAPP_READY'), 1200);
    console.log(`[${key}] READY${s.number ? ` as ${s.number}` : ''}`);
  });
  client.on('auth_failure', message => {
    s.status = 'ERROR';
    s.error = String(message);
    s.starting = false;
    s.reconnectSuppressed = true;
    console.warn(`[${key}] AUTH_FAILURE: ${s.error}`);
  });
  client.on('disconnected', reason => {
    if (s.client !== client) return;

    s.status = 'DISCONNECTED';
    s.error = String(reason || 'Disconnected');
    s.starting = false;
    s.number = null;

    console.warn(`[${key}] DISCONNECTED: ${s.error}`);


    scheduleSessionRestart(s, s.error, 3000);
  });
  try {
    await Promise.race([
      client.initialize(),
      sleep(90000).then(() => {
        throw new Error('WhatsApp initialize timeout');
      }),
    ]);
  } catch (error) {
    const message = errorMessage(error);

    s.status = 'ERROR';
    s.error = message;
    s.starting = false;

    if (s.client === client) {
      s.client = null;
    }

    try {
      await Promise.race([
        client.destroy(),
        sleep(5000),
      ]);
    } catch {}

    if (isTransientBrowserError(error)) {
      scheduleSessionRestart(s, message, 5000);
    }
  }

  return s;
}

const whatsappSessionWatchdog = setInterval(() => {
  for (const s of sessions.values()) {
    if (s.starting || s.status === 'QR_READY' || s.reconnectSuppressed) {
      continue;
    }

    if (s.client) {
      void recoverSession(s, 'PERIODIC_SESSION_WATCHDOG');
      continue;
    }

    if (existsSync(localSessionPath(s.key))) {
      void startSession(s.key);
    }
  }
}, 45000);

whatsappSessionWatchdog.unref?.();

async function responseToMedia(response, filename) {
  if (!response.ok) throw new Error(`Product media download failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxMediaBytes) throw new Error('Product media exceeds the configured size limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Product media response has no body');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxMediaBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error('Product media exceeds the configured size limit');
    }
    chunks.push(Buffer.from(value));
  }
  const data = Buffer.concat(chunks).toString('base64');
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return new MessageMedia(mime, data, String(filename || 'Fireblade-Product'), total);
}

async function loadApprovedMedia(rawUrl, filename) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:') throw new Error('Product media must use HTTPS');
  if (!allowedMediaHosts.size || !allowedMediaHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`Product media host is not approved: ${url.hostname}`);
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  return responseToMedia(response, filename);
}

let driveTokenCache = { token: null, expiresAt: 0 };
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function driveCredentials() {
  const raw = process.env.FIREBLADE_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) throw new Error('Google Drive service account is not configured for catalogue attachments');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) throw new Error('missing client_email/private_key');
    return parsed;
  } catch (error) {
    throw new Error(`Invalid Google Drive service account JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function googleDriveAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (driveTokenCache.token && driveTokenCache.expiresAt > now + 60) return driveTokenCache.token;
  const creds = driveCredentials();
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), creds.private_key).toString('base64url');
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Google Drive authentication failed (${response.status})`);
  driveTokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return driveTokenCache.token;
}
async function loadDriveMedia(fileId, filename) {
  const clean = String(fileId || '').trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(clean)) throw new Error('Invalid Google Drive file ID');
  const token = await googleDriveAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(clean)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  return responseToMedia(response, filename);
}

// FIREBLADE_MD_GROUP_REPORT_START
const supabaseUrl = String(process.env.FIREBLADE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseServerKey = String(process.env.FIREBLADE_SUPABASE_SERVER_KEY || '');
const mdReportSessionKey = 'fb_md';
const groupConfigPath = resolve(process.env.FIREBLADE_PENDING_GROUP_CONFIG || './secure/pending-report-group.json');
const reportStateDir = resolve(process.env.FIREBLADE_PENDING_REPORT_STATE_DIR || './secure/pending-report-state');

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const value = type => Number(parts.find(part => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}
function currentIstDate() {
  const p = istParts();
  return `${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
function shiftDate(dateText, days) {
  const [year, month, day] = String(dateText).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function previousIstDate() { return shiftDate(currentIstDate(), -1); }
function tomorrowIstDate() { return shiftDate(currentIstDate(), 1); }
function afterReportCutoffIst() {
  const p = istParts();
  return p.hour > 9 || (p.hour === 9 && p.minute >= 15);
}
function displayDate(dateText) {
  const [year, month, day] = String(dateText).split('-');
  return year && month && day ? `${day}-${month}-${year}` : String(dateText);
}
function formatIstEpoch(epochMs) {
  const value = Number(epochMs || 0);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(value));
}
function generatedTimeIst() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date());
}
function cleanReportText(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}
async function supabaseRequest(path, options = {}) {
  if (!supabaseUrl || !supabaseServerKey) throw new Error('Production Supabase credentials are not loaded into the WhatsApp bridge');
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseServerKey,
      Authorization: `Bearer ${supabaseServerKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : (data?.message || data?.error || JSON.stringify(data || {}));
    throw new Error(`Supabase request failed (${response.status}): ${String(detail).slice(0, 800)}`);
  }
  return data;
}
async function readJsonFile(path) {
  const raw = (await readFile(path, 'utf8').catch(() => '')).replace(/^\uFEFF/, '');
  if (!raw) return null;
  return JSON.parse(raw);
}
async function readPendingGroupConfig() {
  const config = await readJsonFile(groupConfigPath);
  if (!config) return null;
  const sessionKey = cleanKey(config.session_key || mdReportSessionKey);
  const groupId = String(config.group_id || '').trim();
  const groupName = String(config.group_name || '').trim();
  const firstDeliveryDateIst = String(config.first_delivery_date_ist || '').trim();
  if (!sessionKey || !groupId.endsWith('@g.us') || !groupName) return null;
  return {
    sessionKey, groupId, groupName,
    firstDeliveryDateIst: /^\d{4}-\d{2}-\d{2}$/.test(firstDeliveryDateIst) ? firstDeliveryDateIst : currentIstDate(),
  };
}
async function savePendingGroupConfig(config) {
  await mkdir(resolve(groupConfigPath, '..'), { recursive: true }).catch(() => {});
  await writeFile(groupConfigPath, JSON.stringify(config, null, 2), 'utf8');
}
function statePathFor(deliveryDate) {
  return join(reportStateDir, `pending-group-delivery-${deliveryDate}.json`);
}
async function readDeliveryState(deliveryDate) {
  return readJsonFile(statePathFor(deliveryDate));
}
async function writeDeliveryState(deliveryDate, state) {
  await mkdir(reportStateDir, { recursive: true });
  await writeFile(statePathFor(deliveryDate), JSON.stringify(state, null, 2), 'utf8');
}
function chunkReport(lines, maxLength = 3500) {
  const chunks = [];
  let current = '';
  for (const raw of lines) {
    let line = String(raw ?? '');
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) { current = candidate; continue; }
    if (current) chunks.push(current);
    current = '';
    while (line.length > maxLength) {
      chunks.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }
    current = line;
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}
async function pendingReportRows(reportDate) {
  const rows = await supabaseRequest('rpc/fireblade_pending_call_report_yesterday', {
    method: 'POST',
    body: JSON.stringify({ p_report_date_ist: reportDate }),
  });
  return (Array.isArray(rows) ? rows : []).filter(row =>
    String(row.department_name || '').trim().toLowerCase() === 'marketing'
  );
}
async function devicePhoneMap() {
  const rows = await supabaseRequest('fireblade_devices?select=device_id,company_phone_number&active=eq.true&limit=500', { method: 'GET' });
  return new Map((Array.isArray(rows) ? rows : []).map(row => [
    String(row.device_id || ''), String(row.company_phone_number || ''),
  ]));
}
function groupRowsByEmployee(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const employeeId = cleanReportText(row.employee_id, 80);
    if (!employeeId) continue;
    if (!grouped.has(employeeId)) grouped.set(employeeId, {
      employee_id: employeeId,
      employee_name: cleanReportText(row.employee_name || employeeId, 120),
      rows: [],
    });
    grouped.get(employeeId).rows.push(row);
  }
  return [...grouped.values()].sort((a,b) => a.employee_name.localeCompare(b.employee_name));
}
function buildPendingGroupReport(reportDate, employees, phones) {
  const totalPending = employees.reduce((sum, employee) => sum + employee.rows.length, 0);
  const lines = [
    '*FIREBLADE - PENDING CALLBACK REPORT*',
    `Date: ${displayDate(reportDate)}`,
    `Generated: ${generatedTimeIst()}`,
    '',
  ];
  if (!employees.length) {
    lines.push('No pending callbacks from yesterday.');
    return lines;
  }
  for (const employee of employees) {
    employee.rows.sort((a,b) => Number(a.missed_at_epoch_ms || 0) - Number(b.missed_at_epoch_ms || 0));
    lines.push(`*${employee.employee_name} - ${employee.employee_id}*`);
    lines.push(`Pending: ${employee.rows.length}`);
    employee.rows.forEach((row, index) => {
      const customer = cleanReportText(row.phone_number_normalized || row.phone_number_raw || 'Unknown', 80);
      const device = cleanReportText(row.missed_device_id || '', 80);
      const company = cleanReportText(phones.get(device) || '', 80);
      lines.push(`${index + 1}. Customer: ${customer}`);
      lines.push(`   Missed: ${formatIstEpoch(row.missed_at_epoch_ms)}`);
      if (company) lines.push(`   Company No: ${company}`);
      if (device) lines.push(`   Device: ${device}`);
      lines.push('   Status: Pending');
    });
    lines.push('');
  }
  lines.push('--------------------------------');
  lines.push(`Total Pending: ${totalPending}`);
  lines.push(`Employees with Pending Calls: ${employees.length}`);
  return lines;
}
async function claimEmployeeRun(reportDate, employee, groupName) {
  const callIds = employee.rows.map(row => Number(row.missed_call_id)).filter(Number.isFinite);
  const result = await supabaseRequest('rpc/fireblade_claim_pending_call_report', {
    method: 'POST',
    body: JSON.stringify({
      p_report_date_ist: reportDate,
      p_employee_id: employee.employee_id,
      p_whatsapp_number: `GROUP:${cleanReportText(groupName, 100)}`,
      p_pending_count: employee.rows.length,
      p_pending_call_ids: callIds,
    }),
  });
  return Array.isArray(result) && result[0]?.id ? String(result[0].id) : null;
}
async function patchAuditRun(id, payload) {
  if (!id) return;
  await supabaseRequest(`fireblade_pending_call_report_runs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
}
let pendingReportPromise = null;
async function sendPendingGroupReport(reason = 'MANUAL') {
  if (pendingReportPromise) return pendingReportPromise;

  pendingReportPromise = (async () => {
    const deliveryDate = currentIstDate();
    const reportDate = previousIstDate();
    const config = await readPendingGroupConfig();

    if (!config) {
      return { ok: false, status: 'NOT_CONFIGURED', delivery_date_ist: deliveryDate, report_date_ist: reportDate };
    }
    if (deliveryDate < config.firstDeliveryDateIst) {
      return {
        ok: true,
        status: 'ARMED_FOR_FIRST_RUN',
        first_delivery_date_ist: config.firstDeliveryDateIst,
        delivery_date_ist: deliveryDate,
        report_date_ist: reportDate,
        group_name: config.groupName,
      };
    }
    if (!afterReportCutoffIst()) {
      return {
        ok: true,
        status: 'SCHEDULED',
        delivery_date_ist: deliveryDate,
        report_date_ist: reportDate,
        group_name: config.groupName,
      };
    }

    let state = await readDeliveryState(deliveryDate);
    if (state?.status === 'SENT') {
      return {
        ok: true,
        status: 'ALREADY_SENT',
        delivery_date_ist: deliveryDate,
        report_date_ist: state.report_date_ist || reportDate,
        group_name: state.group_name || config.groupName,
        pending_count: Number(state.pending_count || 0),
        employee_count: Number(state.employee_count || 0),
        message_count: Number(state.message_count || 0),
        sent_at: state.sent_at || null,
      };
    }

    const s = stateFor(config.sessionKey);
    if (s.status !== 'READY' || !s.client) {
      state = {
        ...(state || {}),
        status: 'WAITING_FOR_WHATSAPP',
        delivery_date_ist: deliveryDate,
        report_date_ist: reportDate,
        group_id: config.groupId,
        group_name: config.groupName,
        session_key: config.sessionKey,
        waiting_since: state?.waiting_since || new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        last_reason: reason,
      };
      await writeDeliveryState(deliveryDate, state);
      return {
        ok: false,
        status: 'WAITING_FOR_WHATSAPP',
        delivery_date_ist: deliveryDate,
        report_date_ist: reportDate,
        group_name: config.groupName,
        whatsapp_status: s.status,
      };
    }

    let payloadChunks = Array.isArray(state?.payload_chunks) ? state.payload_chunks.map(String) : [];
    let runIds = Array.isArray(state?.audit_run_ids) ? state.audit_run_ids.map(String) : [];
    let pendingCount = Number(state?.pending_count || 0);
    let employeeCount = Number(state?.employee_count || 0);

    if (!payloadChunks.length) {
      const rows = await pendingReportRows(reportDate);
      const employees = groupRowsByEmployee(rows);
      const phones = await devicePhoneMap();
      payloadChunks = chunkReport(buildPendingGroupReport(reportDate, employees, phones), 3500);
      pendingCount = rows.length;
      employeeCount = employees.length;

      if (employees.length) {
        // FIREBLADE_MD_LEGACY_AUDIT_COMPAT
        // Legacy 09:15 per-employee reports may already have SENT audit rows for this report date.
        // Those rows must NOT block the new consolidated MD -> group delivery.
        // Group duplicate protection is handled by secure per-day delivery state.
        const claimed = [];
        for (const employee of employees) {
          try {
            const id = await claimEmployeeRun(reportDate, employee, config.groupName);
            if (id) claimed.push(id);
          } catch (claimError) {
            console.warn(`[pending-group-report] optional audit claim skipped for ${employee.employee_id}: ${errorMessage(claimError)}`);
          }
        }
        runIds = claimed;
      }

      state = {
        status: 'SENDING',
        delivery_date_ist: deliveryDate,
        report_date_ist: reportDate,
        group_id: config.groupId,
        group_name: config.groupName,
        session_key: config.sessionKey,
        sender_number: s.number || null,
        pending_count: pendingCount,
        employee_count: employeeCount,
        message_count: payloadChunks.length,
        payload_chunks: payloadChunks,
        audit_run_ids: runIds,
        sent_parts: [],
        provider_message_ids: [],
        started_at: new Date().toISOString(),
        last_reason: reason,
      };
      await writeDeliveryState(deliveryDate, state);
    } else {
      state = {
        ...state,
        status: 'SENDING',
        sender_number: s.number || state?.sender_number || null,
        last_attempt_at: new Date().toISOString(),
        last_reason: reason,
      };
      await writeDeliveryState(deliveryDate, state);
    }

    const sentParts = new Set((Array.isArray(state.sent_parts) ? state.sent_parts : []).map(Number));
    const providerIds = Array.isArray(state.provider_message_ids) ? [...state.provider_message_ids] : [];

    try {
      for (let i = 0; i < payloadChunks.length; i++) {
        if (sentParts.has(i)) continue;
        const prefix = payloadChunks.length > 1 ? `*Part ${i + 1}/${payloadChunks.length}*\n` : '';
        const message = await s.client.sendMessage(config.groupId, prefix + payloadChunks[i]);
        providerIds[i] = message?.id?._serialized || null;
        sentParts.add(i);

        state = {
          ...state,
          status: 'SENDING',
          sent_parts: [...sentParts].sort((a,b) => a-b),
          provider_message_ids: providerIds,
          updated_at: new Date().toISOString(),
        };
        await writeDeliveryState(deliveryDate, state);
        if (i + 1 < payloadChunks.length) await sleep(700);
      }

      const sentAt = new Date().toISOString();
      state = {
        ...state,
        status: 'SENT',
        sent_parts: [...sentParts].sort((a,b) => a-b),
        provider_message_ids: providerIds,
        sent_at: sentAt,
        updated_at: sentAt,
      };
      await writeDeliveryState(deliveryDate, state);

      for (const id of runIds) {
        try {
          await patchAuditRun(id, {
            status: 'SENT',
            message_count: payloadChunks.length,
            provider_message_ids: providerIds,
            sent_at: sentAt,
            last_error: null,
            updated_at: sentAt,
          });
        } catch (auditError) {
          console.warn(`[pending-group-report] audit update failed: ${errorMessage(auditError)}`);
        }
      }

      console.log(`[pending-group-report] SENT delivery=${deliveryDate} report=${reportDate} group=${config.groupName} pending=${pendingCount} messages=${payloadChunks.length} reason=${reason}`);
      return {
        ok: true,
        status: 'SENT',
        delivery_date_ist: deliveryDate,
        report_date_ist: reportDate,
        group_name: config.groupName,
        sender_number: s.number || null,
        pending_count: pendingCount,
        employee_count: employeeCount,
        message_count: payloadChunks.length,
        sent_at: sentAt,
      };
    } catch (error) {
      const message = errorMessage(error).slice(0, 800);
      state = {
        ...state,
        status: 'FAILED',
        last_error: message,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await writeDeliveryState(deliveryDate, state).catch(() => {});
      for (const id of runIds) {
        try { await patchAuditRun(id, { status: 'FAILED', last_error: message, updated_at: new Date().toISOString() }); } catch {}
      }
      throw error;
    }
  })();

  try {
    return await pendingReportPromise;
  } finally {
    pendingReportPromise = null;
  }
}

async function maybeCatchupPendingGroupReport(reason) {
  try {
    const config = await readPendingGroupConfig();
    if (!config) return;
    const today = currentIstDate();
    if (today < config.firstDeliveryDateIst || !afterReportCutoffIst()) return;
    const state = await readDeliveryState(today);
    if (state?.status === 'SENT') return;
    const s = stateFor(config.sessionKey);
    if (s.status !== 'READY' || !s.client) return;
    await sendPendingGroupReport(reason);
  } catch (error) {
    console.warn(`[pending-group-report] catch-up failed: ${errorMessage(error)}`);
  }
}

async function listMdWhatsappGroupsBasic(s) {
  if (!s?.client?.pupPage) throw new Error('MD WhatsApp browser page is not available');
  const groups = await s.client.pupPage.evaluate(() => {
    const widText = (wid) => {
      try {
        if (!wid) return '';
        if (typeof wid === 'string') return wid;
        if (typeof wid._serialized === 'string') return wid._serialized;
        if (typeof wid.$1 === 'string') return wid.$1;
        if (typeof wid.user === 'string' && typeof wid.server === 'string') return `${wid.user}@${wid.server}`;
      } catch {}
      return '';
    };

    const collections = window.require('WAWebCollections');
    const chats = collections?.Chat?.getModelsArray?.() || [];

    return chats.map(chat => {
      try {
        const id = widText(chat?.id);
        if (!id || !id.endsWith('@g.us')) return null;

        const name = String(
          chat?.name ||
          chat?.formattedTitle ||
          chat?.contact?.name ||
          chat?.contact?.pushname ||
          id
        ).trim();

        return { id, name: name || id };
      } catch {
        return null;
      }
    }).filter(Boolean);
  });

  return (Array.isArray(groups) ? groups : [])
    .filter(group => String(group?.id || '').endsWith('@g.us'))
    .map(group => ({ id: String(group.id), name: String(group.name || group.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
// FIREBLADE_MD_BASIC_GROUP_LIST_START
// Uses raw WAWebCollections only; deliberately avoids client.getChats().
// FIREBLADE_MD_BASIC_GROUP_LIST_END
async function mdWhatsappView() {
  const config = await readPendingGroupConfig();
  const deliveryDate = currentIstDate();
  const reportDate = previousIstDate();
  const state = await readDeliveryState(deliveryDate);
  const s = stateFor(mdReportSessionKey);

  let reportStatus = 'NOT_CONFIGURED';
  if (config) {
    if (deliveryDate < config.firstDeliveryDateIst) reportStatus = 'ARMED_FOR_FIRST_RUN';
    else if (state?.status) reportStatus = state.status;
    else if (!afterReportCutoffIst()) reportStatus = 'SCHEDULED';
    else if (s.status !== 'READY') reportStatus = 'WAITING_FOR_WHATSAPP';
    else reportStatus = 'DUE';
  }

  return {
    status: s.status,
    number: s.number,
    qr_data_url: s.qrDataUrl,
    error: s.error,
    session_key: mdReportSessionKey,
    group_id: config?.groupId || null,
    group_name: config?.groupName || null,
    first_delivery_date_ist: config?.firstDeliveryDateIst || null,
    delivery_date_ist: deliveryDate,
    report_date_ist: state?.report_date_ist || reportDate,
    report_status: reportStatus,
    report_sent_at: state?.sent_at || null,
    report_pending_count: Number(state?.pending_count || 0),
    report_employee_count: Number(state?.employee_count || 0),
    report_message_count: Number(state?.message_count || 0),
    schedule: '09:15 IST',
  };
}
const pendingReportRetryTimer = setInterval(
  () => void maybeCatchupPendingGroupReport('PERIODIC_RETRY'),
  5 * 60 * 1000,
);
pendingReportRetryTimer.unref?.();
// FIREBLADE_MD_GROUP_REPORT_END


app.get('/health', (req, res) => res.json({ ok: true, service: 'Fireblade Gen 2 WhatsApp Bridge', sessions: sessions.size, browser: browserExecutablePath ? 'SYSTEM_CHROMIUM' : 'PUPPETEER_DEFAULT' }));
app.get('/sessions/:key/status', (req, res) => {
  const s = stateFor(cleanKey(req.params.key));
  res.json({ status: s.status, number: s.number, qr_data_url: s.qrDataUrl, error: s.error });
});
app.post('/sessions/:key/start', async (req, res) => {
  const key = cleanKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'Invalid session' });
  const s = await startSession(key);
  res.json({ status: s.status, number: s.number, qr_data_url: s.qrDataUrl, error: s.error });
});
app.post('/sessions/:key/send', async (req, res) => {
  const s = stateFor(cleanKey(req.params.key));
  if (s.status !== 'READY' || !s.client) return res.status(409).json({ error: 'WhatsApp session is not ready' });
  const to = String(req.body?.to || '').replace(/\D/g, '');
  if (to.length < 8) return res.status(400).json({ error: 'Invalid destination' });
  const chatId = `${to}@c.us`;
  const text = String(req.body?.text || '').slice(0, 12000);
  const maxAttachments = Math.min(40, Math.max(1, Number(process.env.FIREBLADE_WHATSAPP_MAX_ATTACHMENTS || 20)));
  const media = Array.isArray(req.body?.media) ? req.body.media.slice(0, maxAttachments) : [];
  try {
    let textId = null;
    if (text) {
      const message = await s.client.sendMessage(chatId, text);
      textId = message?.id?._serialized || null;
    }
    const ids = [];
    for (const item of media) {
      if (!item?.url && !item?.drive_file_id) continue;
      const approvedMedia = item.drive_file_id
        ? await loadDriveMedia(item.drive_file_id, item.filename)
        : await loadApprovedMedia(item.url, item.filename);
      const message = await s.client.sendMessage(chatId, approvedMedia, { caption: String(item.filename || '') });
      ids.push(message?.id?._serialized || null);
    }
    res.json({ ok: true, number: s.number, text_message_id: textId, media_message_ids: ids });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
// FIREBLADE_MD_GROUP_REPORT_ROUTES_START
app.get('/management/md-whatsapp/status', async (req, res) => {
  try {
    res.json(await mdWhatsappView());
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

app.get('/management/md-whatsapp/groups', async (req, res) => {
  const s = stateFor(mdReportSessionKey);
  if (s.status !== 'READY' || !s.client) {
    return res.status(409).json({ error: 'MD WhatsApp session is not ready' });
  }

  try {
    const groups = await listMdWhatsappGroupsBasic(s);
    res.json({ ok: true, groups });
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`[fb_md] GROUP_LIST_FAILED: ${message}`);
    res.status(502).json({ error: message });
  }
});

app.post('/management/md-whatsapp/group', async (req, res) => {
  const s = stateFor(mdReportSessionKey);
  if (s.status !== 'READY' || !s.client) {
    return res.status(409).json({ error: 'MD WhatsApp session is not ready' });
  }

  try {
    const requestedId = String(req.body?.group_id || '').trim();
    if (!requestedId.endsWith('@g.us')) {
      return res.status(400).json({ error: 'Invalid WhatsApp group ID' });
    }

    const availableGroups = await listMdWhatsappGroupsBasic(s);
    const selected = availableGroups.find(group => group.id === requestedId);
    if (!selected) {
      return res.status(404).json({ error: 'Selected WhatsApp group is not available on the connected MD account' });
    }

    const existing = await readPendingGroupConfig();
    const firstDeliveryDateIst = currentIstDate();
    const config = {
      session_key: mdReportSessionKey,
      group_id: requestedId,
      group_name: String(selected.name || 'Marketing Group'),
      first_delivery_date_ist: firstDeliveryDateIst,
      configured_at: new Date().toISOString(),
    };

    await savePendingGroupConfig(config);

    // FIREBLADE_MD_GROUP_SELECTED_CATCHUP
    setTimeout(() => void maybeCatchupPendingGroupReport('GROUP_SELECTED'), 750);

    res.json({
      ok: true,
      group_id: config.group_id,
      group_name: config.group_name,
      first_delivery_date_ist: config.first_delivery_date_ist,
    });
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

app.post('/automation/pending-group-report', async (req, res) => {
  try {
    const result = await sendPendingGroupReport('SCHEDULED_TASK');
    if (!result.ok) return res.status(409).json(result);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: errorMessage(error), delivery_date_ist: currentIstDate(), report_date_ist: previousIstDate() });
  }
});
// FIREBLADE_MD_GROUP_REPORT_ROUTES_END

app.post('/sessions/:key/reset', async (req, res) => {
  const targetKey = cleanKey(req.params.key);
  if (targetKey === 'fb_md') {
    return res.status(403).json({ error: 'fb_md session is protected and cannot be reset' });
  }
  const s = stateFor(targetKey);
  await safeDestroySessionClient(s);
  try {
    await rm(localSessionPath(s.key), { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  } catch (error) {
    return res.status(409).json({ error: `Could not clear the local WhatsApp session: ${errorMessage(error)}` });
  }
  sessions.delete(s.key);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Fireblade Gen 2 WhatsApp Bridge listening on ${port}`);
  console.log(browserExecutablePath ? 'Using installed Chrome/Edge for WhatsApp Web.' : 'No system Chrome/Edge detected; Puppeteer will use its configured/default browser.');
});
