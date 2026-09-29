# Fireblade Web

Next.js 16 / React 19 / TypeScript, using the existing Supabase and company login configuration.

Read `../README_FIRST.txt` before updating a working installation.

- Start on Windows: `../START_FIREBLADE_WEB.bat`
- Build: `npm ci` then `npm run build`
- Status rules: `npm run test:status`
- Login and access checks: `npm run test:access` (after the production build; uses temporary local credentials)
- Firebase setup: `../FIREBASE_SETUP.txt`
- Production: keep the original server environment values and deployment project.

## Fireblade Web 2.1.2 - Disqualified Call Handling

Before deploying Web 2.1.2 to an environment that has not already received the database change, run:

`fireblade_gen2_1_2_disqualified_calls.sql`

Behavior:
- Marketing employee call rows show **Add Details** and **Disqualified**.
- The old **Send Product** button is removed from the Calls UI only; WhatsApp/product-sharing backend routes remain in the codebase.
- A Disqualified call is stored as a completed/handled enquiry outcome and therefore no longer counts as details pending.
- Disqualified calls are excluded from Management/Admin **Information Sent** rows, counts, CSV and Excel exports.
