import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// ---------------------------------------------------------------------------
// Source-level guard: bridgeRequest must reject localhost on Vercel
// ---------------------------------------------------------------------------

test('bridgeRequest guards against localhost bridge URL on Vercel', () => {
  const source = read('src/lib/whatsapp.ts');

  // Must check for the VERCEL environment variable
  assert.match(source, /process\.env\.VERCEL/,
    'bridgeRequest should check process.env.VERCEL to detect serverless');

  // Must reject localhost / 127.0.0.1
  assert.match(source, /localhost|127\.0\.0\.1/,
    'bridgeRequest should detect localhost bridge URLs');

  // Must mention the Cloudflare Tunnel requirement in the error
  assert.match(source, /Cloudflare Tunnel/i,
    'bridgeRequest should tell the operator to use the Cloudflare Tunnel hostname');
});

// ---------------------------------------------------------------------------
// Source-level guard: bridgeRequest must wrap network errors
// ---------------------------------------------------------------------------

test('bridgeRequest wraps fetch failures with the target URL', () => {
  const source = read('src/lib/whatsapp.ts');

  // The fetch call should be inside a try/catch
  assert.match(source, /catch\s*\(\s*fetchError/,
    'bridgeRequest should catch network-level fetch errors');

  // Error message should include the URL for diagnostics
  assert.match(source, /WhatsApp bridge network error/,
    'bridgeRequest should surface the URL in network error messages');
});

// ---------------------------------------------------------------------------
// Deploy checklist includes bridge environment variables
// ---------------------------------------------------------------------------

test('Vercel deploy steps document bridge environment variables', () => {
  const deploy = read('VERCEL_DEPLOY_STEPS.txt');

  assert.match(deploy, /FIREBLADE_WHATSAPP_BRIDGE_URL/,
    'Deploy steps must list FIREBLADE_WHATSAPP_BRIDGE_URL');

  assert.match(deploy, /FIREBLADE_WHATSAPP_BRIDGE_KEY/,
    'Deploy steps must list FIREBLADE_WHATSAPP_BRIDGE_KEY');

  // URL entry should warn against localhost
  assert.match(deploy, /NOT localhost/i,
    'Deploy steps should warn that bridge URL must not be localhost');
});

// ---------------------------------------------------------------------------
// Bridge server exposes the expected MD WhatsApp routes
// ---------------------------------------------------------------------------

test('bridge server has MD WhatsApp management routes', () => {
  const bridge = fs.readFileSync(
    path.join(root, '..', 'WhatsApp_Bridge', 'server.js'), 'utf8');

  assert.match(bridge, /\/management\/md-whatsapp\/status/,
    'Bridge must serve GET /management/md-whatsapp/status');

  assert.match(bridge, /\/management\/md-whatsapp\/groups/,
    'Bridge must serve GET /management/md-whatsapp/groups');

  assert.match(bridge, /\/management\/md-whatsapp\/group/,
    'Bridge must serve POST /management/md-whatsapp/group');
});

// ---------------------------------------------------------------------------
// Website API route forwards to bridge correctly
// ---------------------------------------------------------------------------

test('MD WhatsApp API route uses bridgeRequest for all bridge calls', () => {
  const route = read('src/app/api/management/md-whatsapp/route.ts');

  // Status path
  assert.match(route, /bridgeRequest.*\/management\/md-whatsapp\/status/,
    'GET handler should call bridgeRequest for status');

  // Group list path
  assert.match(route, /bridgeRequest.*\/management\/md-whatsapp\/groups/,
    'GET handler should call bridgeRequest for groups');

  // Connect path
  assert.match(route, /bridgeRequest.*\/sessions\/fb_md\/start/,
    'POST connect handler should call bridgeRequest for session start');

  // Set group path
  assert.match(route, /bridgeRequest.*\/management\/md-whatsapp\/group/,
    'POST set_group handler should call bridgeRequest for group selection');
});

// ---------------------------------------------------------------------------
// Auth header name matches between website helper and bridge
// ---------------------------------------------------------------------------

test('bridge auth header name is consistent', () => {
  const helper = read('src/lib/whatsapp.ts');
  const bridge = fs.readFileSync(
    path.join(root, '..', 'WhatsApp_Bridge', 'server.js'), 'utf8');

  // Both must use the exact same header name
  assert.match(helper, /X-Fireblade-Bridge-Key/,
    'Website helper must send X-Fireblade-Bridge-Key');

  assert.match(bridge, /X-Fireblade-Bridge-Key/,
    'Bridge must read X-Fireblade-Bridge-Key');
});
