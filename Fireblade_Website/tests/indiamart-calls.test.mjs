import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(resolve(root, path), "utf8");

test("IndiaMART dashboard is Admin/Management-only, also at API level", () => {
  const page = source("src/app/indiamart-calls/page.tsx");
  const api = source("src/app/api/indiamart-calls/route.ts");
  const shell = source("src/components/AppShell.tsx");
  assert.match(page, /role !== "ADMIN" && user\.role !== "MANAGEMENT"/);
  assert.match(api, /session\.role !== "ADMIN" && session\.role !== "MANAGEMENT"/);
  assert.match(api, /status: 403/);
  assert.match(shell, /canManage && item\("\/indiamart-calls", "IndiaMART Calls"\)/);
  assert.match(shell, /isMarketing \? "My Calls" : "General Calls"/);
});
test("Krishna and SF share tracking number, distinguished by receiving SIM", () => {
  const sql = source("migrations/20261012_indiamart_profile_call_attribution.sql");
  assert.match(sql, /tracking_number = '7942554266' AND receiving_sim IN \('9159242000','7305966225'\) THEN 'KRISHNA'/);
  assert.match(sql, /tracking_number = '7942554266' AND receiving_sim IN \('8940944000','7550093383'\) THEN 'SF'/);
  assert.match(sql, /tracking_number = '8048250260' AND receiving_sim IN \('9345226022','9087753000'\) THEN 'MOHAMMED'/);
  assert.match(sql, /ELSE 'OTHER'/);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /REVOKE ALL.*anon, authenticated/);
});
test("Call totals are PostgreSQL-aggregated and phone-record labeled; history paginated", () => {
  const sql = source("migrations/20261012_indiamart_profile_call_attribution.sql");
  const api = source("src/app/api/indiamart-calls/route.ts");
  const ui = source("src/components/IndiaMartCallsClient.tsx");
  assert.match(sql, /COUNT\(\*\) FILTER/);
  assert.match(api, /rpc\/fireblade_indiamart_call_summary/);
  assert.match(api, /supabaseRestWithCount/);
  assert.match(api, /const pageSize = 50/);
  assert.match(api, /countUnit: "device_call_records"/);
  assert.match(ui, /not unique customer enquiries/);
  assert.match(ui, /Single-line fallback/);
  assert.match(ui, /type="date"/);
  assert.match(ui, /Other receivers/);
});
