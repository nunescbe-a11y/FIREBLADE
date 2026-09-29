# Fireblade Gen 2 WhatsApp Bridge

Persistent, employee-scoped WhatsApp Web transport for Fireblade Gen 2.

## What it does
- One private WhatsApp Web session per Fireblade employee (`fb_<employee-id>`).
- Generates QR codes locally for employee pairing.
- Sends the Fireblade-controlled text package assembled from the master product catalogue.
- Sends approved product files either from private Supabase Storage or directly from the existing Google Drive catalogue index.
- Never lets a browser choose another employee's WhatsApp session.

## Security
- Run this service only on a trusted company host/VPN/private network.
- Set `FIREBLADE_WHATSAPP_BRIDGE_KEY` to a long random secret and use the same value in the Fireblade website server environment.
- Do not expose port 3100 directly to the public internet.
- QR payloads are converted to image data inside this bridge. They are never sent to a public QR-generation website.
- WhatsApp session files stay under `.wwebjs_auth`. Back them up securely and never commit them.
- `FIREBLADE_MEDIA_ALLOWED_HOSTS` is required for arbitrary signed HTTPS media URLs such as Supabase Storage.
- Google Drive attachments are fetched only by Drive file ID using a server-side readonly service account.
- Media is size-limited by `FIREBLADE_WHATSAPP_MAX_MEDIA_MB`; package attachment count is limited by `FIREBLADE_WHATSAPP_MAX_ATTACHMENTS`.

## Google Drive catalogue attachments
Set `FIREBLADE_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` to a service-account JSON credential and share the catalogue source folders/files with that service account's `client_email` as Viewer. If this variable is absent, the bridge can use `FIREBASE_SERVICE_ACCOUNT_JSON` as a credential fallback, but the corresponding service account must still have Drive access.

The website sends only Drive file IDs that were linked to VERIFIED + customer-sendable Fireblade product assets by the bulk catalogue importer. The employee cannot supply an arbitrary Drive file ID.

## Install and start (Windows PowerShell)
```powershell
$env:PUPPETEER_SKIP_DOWNLOAD="true"
npm.cmd install
$env:FIREBLADE_WHATSAPP_BRIDGE_KEY="replace-with-long-random-secret"
$env:FIREBLADE_MEDIA_ALLOWED_HOSTS="YOUR_PROJECT.supabase.co"
$env:FIREBLADE_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
npm.cmd start
```

Website environment:
```text
FIREBLADE_WHATSAPP_BRIDGE_URL=http://127.0.0.1:3100
FIREBLADE_WHATSAPP_BRIDGE_KEY=<same secret>
```

This bridge uses `whatsapp-web.js`, an unofficial WhatsApp Web automation transport. Fireblade's employee/product/message architecture is transport-independent so the bridge can later be replaced by the official WhatsApp Business Platform without changing call ownership, catalogue search, package assembly, or message audit data.

### Browser handling
On Windows the bridge automatically uses an installed Google Chrome or Microsoft Edge executable. This avoids downloading a second Chromium copy through Puppeteer. On a non-Windows host, either install Chrome/Chromium in a standard location or set `FIREBLADE_WHATSAPP_BROWSER_PATH` explicitly. `PUPPETEER_SKIP_DOWNLOAD=true` is safe when a system browser is available.
