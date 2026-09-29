# Antigravity Task — Fix Fireblade MD WhatsApp 502

Track this work against GitHub Issue #1.

## Goal
Find and fix the production failure where Fireblade Web's `/api/management/md-whatsapp` endpoint returns HTTP 502.

## Confirmed architecture
- Website code: `Fireblade_Website/`
- WhatsApp bridge: `WhatsApp_Bridge/`
- Website bridge helper: `Fireblade_Website/src/lib/whatsapp.ts`
- Bridge base URL comes from `FIREBLADE_WHATSAPP_BRIDGE_URL`
- Bridge auth key comes from `FIREBLADE_WHATSAPP_BRIDGE_KEY`
- Website sends the key using `X-Fireblade-Bridge-Key`
- Bridge timeout is 30 seconds
- Local bridge listens on `127.0.0.1:3100`
- An unauthenticated local request returns 401, so the local bridge process is alive
- `cloudflared` is running as a named/token tunnel
- Cloudflare metrics showed 4 active HA tunnel connections
- Vercel Production has both bridge environment variables configured
- Other Fireblade routes are healthy; this investigation must stay scoped to the MD WhatsApp bridge path

## Required investigation
1. Reproduce the failing production request.
2. Trace `GET /api/management/md-whatsapp` to the exact outbound bridge request.
3. Verify the active Cloudflare public hostname and its origin mapping.
4. Verify the public hostname routes to the correct local origin `http://127.0.0.1:3100`.
5. Verify the Vercel Production value of `FIREBLADE_WHATSAPP_BRIDGE_URL` matches that public hostname.
6. Verify the Vercel Production bridge key matches the bridge runtime key without exposing either secret.
7. Check whether Cloudflare Access, hostname routing, TLS, origin rules, or tunnel ingress is returning an error before the Node bridge is reached.
8. Check whether the bridge receives the expected `X-Fireblade-Bridge-Key` header.
9. Implement the smallest safe fix.
10. Add or update tests where practical and provide exact rollout/verification steps.

## Safety constraints
- Do not commit or print secrets.
- Do not commit `.env` files, service-account JSON, WhatsApp sessions, QR images, Cloudflare credentials, tunnel tokens, or runtime delivery-state files.
- Do not change Supabase schema/data unless concrete evidence proves it is required.
- Do not alter the call collector backend.
- Do not redesign the Fireblade application.
- Do not weaken authentication.
- Preserve Calls Dashboard, Device Health, login/auth, employee WhatsApp behavior, and existing production data.
- Prefer a minimal configuration or routing fix over broad code changes.

## Completion criteria
The task is complete only when:
- Production `GET /api/management/md-whatsapp` no longer returns 502.
- MD WhatsApp status is returned successfully.
- Connect/reconnect flow works.
- Group refresh works when the MD session is READY.
- Existing non-WhatsApp Fireblade functions remain healthy.
- The root cause and exact changed files/configuration are documented.
- No secrets are committed.

## Repository hygiene
The root `.gitignore` intentionally excludes:
- `WhatsApp_Bridge/secure/`
- `WhatsApp_Bridge/logs/`
- WhatsApp session/cache directories
- `.env*` except examples
- Cloudflare credentials
- generated build/cache output

Do not remove those protections.
