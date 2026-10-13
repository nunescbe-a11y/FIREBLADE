# Shane WhatsApp group rollback — 13 October 2026

Owner decision: cancel Shane group assignment auto-sending. Restore Shane's existing local-first individual WhatsApp handoff.

## Required order (Windows / Antigravity)
1. **STOP group dispatch now on the CURRENT running bridge.** If old Admin page offers Pause Automatic Sending, pause it. On the Windows bridge machine, back up `WhatsApp_Bridge/secure/shane-assignment-group.json` and set its `enabled` property to `false` (do not modify MD files). Confirm no group messages can be generated while the old process is still running; do not press Process Queue Now.
2. Preserve all uncommitted local changes, fetch branch `revert/shane-direct-whatsapp-20261013`. Its base is production-compatible `feature/indiamart-calls-dashboard`; do not reset/revert the entire repository to a past commit.
3. Run tests and builds: from `Fireblade_Website`, `npm ci && npm run check && npm run build`; from `WhatsApp_Bridge`, `npm test`; from `Cloud_Backend_V1_2`, run the existing backend tests including `tests/test_api.py` using the project's configured Python environment; run the Android Gradle compile/test suite.
4. Confirm the active Windows bridge process was safely stopped/restarted using the updated `WhatsApp_Bridge/server.js` and updated `START_FIREBLADE_WHATSAPP_PERMANENT.ps1`. Restart may briefly interrupt the independent MD session. Never delete or reset `fb_md` auth, pending-report state, or schedule. Verify MD READY after restart, and no Shane group routes/background polling exist.
5. Deploy only the backend update `Cloud_Backend_V1_2/api/fireblade_v3.py` to the *existing* FastAPI Vercel project. Confirm the employee recipient API returns names/numbers without `group_mode_enabled`.
6. Build the **Shane Android APK** with the existing original production signing key. Verify signing certificate SHA256 `35890540b4a0ed76048dd02a5eaabf638eaecef6969cf91ec20b73c9816061f7`. Install as an **in-place update on Shane MKT-019 only**, preserving Room outbox/credentials; no uninstall or data clearing.
7. Deploy updated `Fireblade_Website` to the existing production project via linked Vercel CLI, preserving IndiaMART Calls, General Calls, Overview and other tabs. Verify `/admin/shane-whatsapp` and `/api/admin/shane-whatsapp` no longer exist (404), while MD's `/management/md-whatsapp` routes remain.
8. On Shane phone, select exactly one valid employee, fill a **synthetic test customer** and tap Save & Assign & Send. Confirm local Fireblade save / outbox sync and direct recipient WhatsApp chat opening with correctly prefilled text. **Do not press WhatsApp Send** without explicit user approval. On returning, test multiple selected employees display sequential individual chats and never launch a group. `WHATSAPP_HANDOFF_OPENED` means chat opened, **not sent**.
9. Confirm MD 9:15 AM IST daily pending report remains unchanged, and the old Shane group sender is not running anywhere else (no duplicate Windows process).

## Final semantics
- Shane selects recipients and saves; the Android app opens each target employee's WhatsApp chat on **Shane's phone**, with the customer message prefilled.
- Shane must tap **Send** in WhatsApp to actually deliver to each employee. The app cannot verify the send, and must never log it as confirmed SENT solely because the chat opened.
- Group @mentions, group dispatch, Shane QR, Shane bridge management dashboard and Shane group worker are removed.
- Existing assignment event rows and historical audit records remain intact.
- No Windows always-on requirement for *Shane's direct-chat handoff*. The *MD scheduled report* still requires its own always-on bridge.

## Evidence to return
- Git SHA, Android APK version & production signing certificate, backend/web deployment IDs, Android test screenshots/logcat, server and web test/build outputs, group-worker absence, MD READY and scheduled report preservation.
