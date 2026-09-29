// Production HTTP smoke test with temporary credentials; never contacts Supabase.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
const password = randomBytes(20).toString('hex');
const processEnv = { ...process.env, NODE_ENV: 'production', FIREBLADE_SESSION_SECRET: secret,
  FIREBLADE_ADMIN_USER: 'local-test-admin', FIREBLADE_ADMIN_PASSWORD: password,
  SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', FIREBASE_SERVICE_ACCOUNT_JSON: '' };
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { env: processEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', data => { log += data; });
child.stderr.on('data', data => { log += data; });
const cookie = role => {
  const payload = Buffer.from(JSON.stringify({ username: 'local-test', role, exp: Date.now() + 60000 })).toString('base64url');
  return `fireblade_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
let checks = 0;
async function status(path, expected, options = {}) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}`);
  checks++;
  return response;
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`${origin}/login`)).ok; } catch { }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, `Production server did not start: ${log.slice(-1500)}`);
  const login = await status('/login', 200);
  assert.match(await login.text(), /Fireblade Web/);
  await status('/device-health', 307);
  for (const path of ['/api/device-health', '/api/departments', '/api/admin/releases', '/api/admin/audit']) {
    await status(path, 401);
    await status(path, 403, { headers: { cookie: cookie('MARKETING') } });
  }
  for (const path of ['/api/admin/releases', '/api/admin/audit']) {
    await status(path, 403, { headers: { cookie: cookie('MANAGEMENT') } });
  }
  await status('/api/departments', 403, { method: 'POST', headers: { cookie: cookie('MANAGEMENT'), 'content-type': 'application/json' }, body: '{}' });
  await status('/api/device-checks', 403, { method: 'POST', headers: { cookie: cookie('MARKETING'), 'content-type': 'application/json' }, body: '{}' });
  await status('/api/device-checks', 403, { method: 'POST', headers: { cookie: cookie('ADMIN'), origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: '{}' });
  await status('/api/departments', 400, { method: 'POST', headers: { cookie: cookie('ADMIN'), origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'INVALID' }) });
  await status('/api/admin/releases', 400, { method: 'POST', headers: { cookie: cookie('ADMIN'), origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'PREPARE', version_code: 1 }) });
  const signedIn = await status('/api/auth/login', 200, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'local-test-admin', password }) });
  assert.match(signedIn.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(signedIn.headers.get('set-cookie'), /Secure/i);
  assert.match(signedIn.headers.get('set-cookie'), /SameSite=lax/i);
  console.log(`PASS: ${checks} production HTTP checks (login, protected pages, roles, origin rejection, validation, secure session cookie).`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
}
