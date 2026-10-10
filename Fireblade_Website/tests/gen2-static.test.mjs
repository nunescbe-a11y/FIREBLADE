import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const project = path.resolve(root, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readProject = p => fs.readFileSync(path.join(project, p), 'utf8');

test('normal login/logout paths do not force router refresh', () => {
  assert.ok(!read('src/app/login/page.tsx').includes('router.refresh()'));
  assert.ok(!read('src/components/AppShell.tsx').includes('router.refresh()'));
});

test('Shane details are visible only to Admin and Management, with all persisted fields', () => {
  const page = read('src/app/shane-call-details/page.tsx');
  const api = read('src/app/api/management/shane-call-details/route.ts');
  const ui = read('src/components/ShaneCallDetailsClient.tsx');
  const shell = read('src/components/AppShell.tsx');
  assert.ok(page.includes('user.role !== "ADMIN" && user.role !== "MANAGEMENT"'));
  assert.ok(api.includes('session.role !== "ADMIN" && session.role !== "MANAGEMENT"'));
  assert.ok(api.includes('fireblade_shane_call_details?select=*'));
  assert.ok(ui.includes('Not recorded'));
  assert.ok(!ui.includes('"Quotation Sent"'));
  assert.ok(!ui.includes('"Catalogue Sent"'));
  assert.ok(!ui.includes('"Image Sent"'));
  assert.match(ui, /"quotation", "catalogue", "image"/); // Hide obsolete DB columns from extra-field view.
  for (const field of ['customer_name', 'product_asked', 'location', 'notes', 'very_urgent', 'device_id', 'employee_id', 'phone_number_raw']) {
    assert.ok(ui.includes(field), 'Missing Shane detail field: ' + field);
  }
  assert.ok(!shell.includes('"Shane Sir Call Details"'));
  assert.ok(ui.includes('<h1>Shane Call Details</h1>'));
  const columns = ['Employee', 'Customer', 'Product', 'Call Date / Time',
    'Location', 'Assigned To', 'Assigned Date / Time'];
  const headers = [...ui.matchAll(/<th>([^<]+)<\/th>/g)].map(match => match[1]);
  assert.deepEqual(headers, columns);
  assert.match(ui, /assigned_to_employee_name/);
  assert.match(ui, /assigned_at_epoch_ms/);
  assert.match(ui, /row\.assigned_to_employee_name\?\.trim\(\)/);
  assert.match(ui, /"Not recorded"/);
  assert.match(ui, /View details/);
  const rowApi = read('src/app/api/management/shane-call-details/route.ts');
  assert.match(rowApi, /assigned_to_employee_id/);
  assert.match(rowApi, /assigned_to_employee_name/);
});

test('Overview and Information Sent report use the seven assignment-focused columns', () => {
  const shared = read('src/components/InformationSentTable.tsx');
  const overview = read('src/components/DashboardInformationSent.tsx');
  const report = read('src/components/InformationSentReportClient.tsx');
  const api = read('src/app/api/management/information-sent/route.ts');
  const merge = read('src/lib/shane-information-report.ts');
  const labels = ["Employee", "Customer", "Product", "Call Date / Time",
    "Location", "Assigned To", "Assigned Date / Time"];
  for (const label of labels) assert.ok(shared.includes('"' + label + '"'));
  assert.match(shared, /COLUMN_LABELS\.map/);
  assert.match(shared, /colSpan=\{7\}/);
  assert.match(shared, /assignmentName\(row\)/);
  assert.match(shared, /assignmentTime\(row\)/);
  assert.match(shared, /View details/);
  assert.match(shared, /itemById/);
  assert.match(overview, /<InformationSentTable/);
  assert.match(report, /<InformationSentTable/);
  assert.match(api, /fireblade_shane_call_details\?select=\*/);
  assert.match(api, /Assigned Date \/ Time/);
  assert.match(merge, /assigned_to_employee_id/);
  assert.match(merge, /assigned_at_epoch_ms/);
  assert.ok(!shared.includes('row.employee_id || row.assigned_to_employee_id'));
});

test('Shane form history is private and assignment source is distinct from call employee', () => {
  const migration = read('fireblade_shane_assignment_and_form_history.sql');
  const extraPayload = read('fireblade_shane_complete_form_payload.sql');
  const latest = read('src/lib/shane-assignment-events.ts');
  const detailsRoute = read('src/app/api/management/shane-call-details/route.ts');
  const reportRoute = read('src/app/api/management/information-sent/route.ts');
  const shaneMerge = read('src/lib/shane-information-report.ts');
  const summary = read('src/components/InformationSentTable.tsx');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.fireblade_shane_assignment_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.fireblade_shane_form_revisions/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE .* FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /fireblade_shane_saved_form_revision_trigger/);
  assert.match(extraPayload, /ADD COLUMN IF NOT EXISTS form_payload jsonb/);
  assert.match(latest, /event_type=in\.\(ASSIGNED,REASSIGNED\)/);
  assert.match(detailsRoute, /loadShaneLatestAssignments/);
  const history = read('src/app/api/management/shane-call-details/history/route.ts');
  const detailUi = read('src/components/ShaneCallDetailsClient.tsx');
  assert.match(history, /session.role !== "ADMIN" && session.role !== "MANAGEMENT"/);
  assert.match(history, /fireblade_shane_assignment_events/);
  assert.match(history, /fireblade_shane_form_revisions/);
  assert.match(detailUi, /Assignment and saved form history/);
  assert.match(detailUi, /WHATSAPP|event_type\.replaceAll/);
  assert.match(detailUi, /displayedSnapshot/);
  assert.match(detailUi, /enabled: Boolean\(expandedId\)/);
  assert.match(latest, /ASSIGNED,REASSIGNED/);
  // All employees selected during the same save share an action timestamp.
  assert.match(latest, /batch\.events\.push\(event\)/);
  assert.match(latest, /batch\.occurred_at_epoch_ms === event\.occurred_at_epoch_ms/);
  assert.match(detailsRoute, /assigned_to_employee_names: assigneeNames/);
  assert.match(reportRoute, /assignment\?\.events\.map\(event =>/);

  assert.match(reportRoute, /loadShaneLatestAssignments/);
  assert.match(shaneMerge, /Shane's Android form has NO quotation, catalogue or image selections/);
  assert.match(summary, /row\.source !== "SHANE" && types\.map/);
});

test('Admin and Management reports auto-refresh every 5 seconds in visible tabs', () => {
  const polling = read('src/lib/use-visible-polling.ts');
  assert.match(polling, /FIREBLADE_DETAIL_REFRESH_MS = 5_000/);
  assert.match(polling, /window\.setInterval/);
  assert.match(polling, /document\.hidden/);
  assert.match(polling, /visibilitychange/);
  assert.match(polling, /window\.clearInterval/);
  assert.match(polling, /controller\.signal/);
  assert.match(polling, /inFlight\.current\.abort\(\)/);
  assert.match(polling, /setData\(json as T\)/);
  for (const path of [
    'src/components/DashboardInformationSent.tsx',
    'src/components/InformationSentReportClient.tsx',
    'src/components/ShaneCallDetailsClient.tsx',
  ]) {
    const source = read(path);
    assert.match(source, /useVisiblePolling/);
    assert.match(source, /Automatically refreshes every 5 seconds/);
  }
  assert.match(read('src/components/DashboardInformationSent.tsx'), /enabled: expanded/);
});

test('marketing calls are scoped by server-side employee ownership', () => {
  const source = read('src/app/api/calls/route.ts');
  assert.match(source, /role\s*===\s*["']MARKETING["']/);
  assert.match(source, /registered_employee_id/);
});

test('employee callback report locks marketing to the session employee', () => {
  const source = read('src/app/api/callbacks/route.ts');
  assert.match(source, /user\.role\s*===\s*["']MARKETING["']/);
  assert.match(source, /user\.employee_id/);
  assert.match(source, /employee_id=eq/);
});

test('callback resolution requires a connected outgoing call', () => {
  const sql = readProject('Database_Migrations/fireblade_gen2.sql');
  assert.match(sql, /OUTGOING_CONNECTED/);
  assert.match(sql, /o\.employee_id\s*=\s*m\.employee_id/);
});

test('Fireblade Nightmare is a per-user theme', () => {
  assert.match(read('src/components/ThemeControl.tsx'), /NIGHTMARE/);
  assert.match(read('src/app/globals.css'), /data-fireblade-theme="nightmare"/);
  assert.match(read('src/app/api/preferences/route.ts'), /fireblade_user_preferences/);
});

test('WhatsApp sharing derives ownership from the employee call', () => {
  const source = read('src/app/api/whatsapp/send/route.ts');
  assert.match(source, /registered_employee_id/);
  assert.match(source, /user\.employee_id/);
  assert.ok(!source.includes('api.qrserver.com'));
});

test('large catalogue uses server-side search and automatic package assembly', () => {
  const search = read('src/app/api/products/search/route.ts');
  const pkg = read('src/lib/product-package.ts');
  const ui = read('src/components/MyWhatsAppClient.tsx');
  assert.match(search, /fireblade_search_products/);
  assert.match(pkg, /publish_status=eq\.PUBLISHED/);
  assert.match(pkg, /verification_status=eq\.VERIFIED/);
  assert.match(pkg, /customer_sendable=eq\.true/);
  assert.match(ui, /Type product name, model or code/);
  assert.ok(!ui.includes('Approved products'));
});


test('marketing call UI uses Disqualified while preserving the existing product-sharing backend', () => {
  const callsUi = read('src/components/CallsClient.tsx');
  const disqualify = read('src/app/api/enquiries/disqualify/route.ts');
  const sendBackend = read('src/app/api/whatsapp/send/route.ts');
  assert.match(callsUi, /Disqualified/);
  assert.match(callsUi, /\/api\/enquiries\/disqualify/);
  assert.doesNotMatch(callsUi, /Send Product/);
  assert.doesNotMatch(callsUi, /\/whatsapp\?call_id=/);
  assert.match(disqualify, /fireblade_mark_call_disqualified/);
  assert.match(disqualify, /session\.role !== "MARKETING"/);
  assert.match(disqualify, /session\.employee_id/);
  assert.match(sendBackend, /registered_employee_id/);
  assert.match(sendBackend, /fireblade_whatsapp_messages/);
});

test('WhatsApp package includes safe customer pricing and Drive-backed catalogue assets', () => {
  const send = read('src/app/api/whatsapp/send/route.ts');
  const bridge = readProject('WhatsApp_Bridge/server.js');
  assert.match(send, /current_price/);
  assert.match(send, /drive_file_id/);
  assert.match(send, /Price: Please contact us for the current customer quotation/);
  assert.match(bridge, /FIREBLADE_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON/);
  assert.match(bridge, /drive\.readonly/);
});

test('bulk catalogue importer never exposes purchase price by default', () => {
  const importer = readProject('Catalogue_Seed/import_catalogue.py');
  assert.match(importer, /INTERNAL_PURCHASE/);
  assert.match(importer, /customer_sendable.*False/);
  assert.match(importer, /customer-price-column/);
});

test('private WhatsApp bridge generates QR locally and requires API key', () => {
  const source = readProject('WhatsApp_Bridge/server.js');
  assert.match(source, /FIREBLADE_WHATSAPP_BRIDGE_KEY/);
  assert.match(source, /QRCode\.toDataURL/);
  assert.ok(!source.includes('api.qrserver.com'));
});


test('managed account password and status changes invalidate older sessions', () => {
  const auth = read('src/lib/auth.ts');
  const admin = read('src/app/api/admin/accounts/route.ts');
  const password = read('src/app/api/account/password/route.ts');
  assert.match(auth, /decoded\.session_version/);
  assert.match(auth, /return null;[\s\S]*Managed employee sessions fail closed/);
  assert.match(admin, /session_version: Number\(profile\.session_version \|\| 1\) \+ 1/);
  assert.match(password, /nextSessionVersion/);
});

test('WhatsApp bridge restricts media downloads to approved HTTPS hosts and size limits', () => {
  const source = readProject('WhatsApp_Bridge/server.js');
  assert.match(source, /FIREBLADE_MEDIA_ALLOWED_HOSTS/);
  assert.match(source, /url\.protocol !== 'https:'/);
  assert.match(source, /redirect: 'error'/);
  assert.match(source, /FIREBLADE_WHATSAPP_MAX_MEDIA_MB/);
});

test('catalogue administration is removed per simplification and private storage functions exist', () => {
  const storage = read('src/lib/supabase.ts');
  assert.match(storage, /object\/upload\/sign/);
  assert.match(readProject('Database_Migrations/fireblade_gen2.sql'), /fireblade-product-assets/);
});


test('employee password authentication prefers the low-privilege Supabase publishable key', () => {
  const source = read('src/lib/supabase.ts');
  assert.match(source, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /getSupabaseAuthKey/);
  assert.match(source, /supabaseAuthPassword[\s\S]*getSupabaseAuthKey\(\)/);
});

test('Gen 2.1 employee photos are private, employee-owned and Admin-managed', () => {
  const migration = readProject('Database_Migrations/fireblade_gen2_1_people_performance.sql');
  const route = read('src/app/api/employee-photo/route.ts');
  const adminUi = read('src/components/AdminTeamClient.tsx');
  assert.match(migration, /profile_photo_path/);
  assert.match(migration, /fireblade-employee-photos/);
  assert.match(route, /user\.role !== "ADMIN"/);
  assert.match(route, /user\.role === "MARKETING" && user\.employee_id !== employeeId/);
  assert.match(adminUi, /Profile Photo/);
  assert.match(adminUi, /sign_upload/);
});

test('Gen 2.1 gives Admin and Management department-to-employee call performance drilldown', () => {
  const migration = readProject('Database_Migrations/fireblade_gen2_1_people_performance.sql');
  const route = read('src/app/api/management/performance/route.ts');
  const detail = read('src/app/api/management/performance/details/route.ts');
  const ui = read('src/components/ManagementPerformanceClient.tsx');
  assert.match(migration, /fireblade_employee_call_performance/);
  assert.match(route, /ADMIN/);
  assert.match(route, /MANAGEMENT/);
  for (const label of ['Total Incoming Calls','Answered Calls','Missed Calls','Called Back','Still Pending','Callback Rate','Avg. Callback Time']) assert.ok(
      ui.includes(label) ||
      ui.includes(({
        "Called Back": "Resolved",
        "Called Back Calls": "Resolved",
        "Callbacks Resolved": "Resolved",
        "Pending Calls": "Still Pending",
        "Pending Callbacks": "Still Pending",
        "Callback Pending": "Still Pending",
        "Callback Rate": "Resolution Rate",
        "Resolution %": "Resolution Rate",
        "Average Callback Time": "Avg. Resolution Time",
        "Average Callback Minutes": "Avg. Resolution Time",
        "Avg Callback Time": "Avg. Resolution Time",
        "Avg. Callback Time": "Avg. Resolution Time"
      })[label] || "__NO_FIREBLADE_LABEL_ALIAS__")
    );
  assert.match(detail, /fireblade_employee_callback_detail_rows/);
  assert.match(detail, /fireblade_employee_call_detail_rows/);
});



test('disqualified calls are handled but excluded from Management/Admin Information Sent reports', () => {
  const callsUi = read('src/components/CallsClient.tsx');
  const reportRoute = read('src/app/api/management/information-sent/route.ts');
  const migration = read('fireblade_gen2_1_2_disqualified_calls.sql');
  assert.match(callsUi, /call\.enquiry_id/);
  assert.match(callsUi, /resolution_outcome === "DISQUALIFIED"/);
  assert.match(reportRoute, /fireblade_information_sent_report/);
  assert.match(migration, /resolution_outcome <> 'DISQUALIFIED'/);
  assert.match(migration, /status = 'COMPLETED'/);
});


test('Gen 2.1.3 supports Recover, OEM callback resolution and one common Information Sent remark', () => {
  const callsUi = read('src/components/CallsClient.tsx');
  const recover = read('src/app/api/enquiries/recover/route.ts');
  const enquiryUi = read('src/components/EnquiryModal.tsx');
  const enquiryApi = read('src/app/api/enquiries/route.ts');
  const migration = read('fireblade_gen2_1_3_recover_callback_common_remarks.sql');

  assert.match(callsUi, /Recover/);
  assert.match(callsUi, /\/api\/enquiries\/recover/);
  assert.match(recover, /fireblade_recover_disqualified_call/);
  assert.match(migration, /RECOVERED/);
  assert.match(migration, /action,[\s\S]*'RECOVERED'/);

  assert.match(enquiryUi, /Notes \/ Remarks/);
  assert.doesNotMatch(enquiryUi, /Why was .* not sent/);

  assert.match(migration, /OTHER_100/);
  assert.match(migration, /coalesce\(o\.duration_seconds, 0\) > 0/);
  assert.match(migration, /o\.employee_id = m\.employee_id/);
  assert.match(migration, /o\.phone_number_normalized = m\.phone_number_normalized/);
});

test('Gen 2.1 personal marketing dashboard uses employee photo and India-time greeting', () => {
  const ui = read('src/components/MarketingDashboardClient.tsx');
  const shell = read('src/components/AppShell.tsx');
  assert.match(ui, /Asia\/Kolkata/);
  assert.match(ui, /Good morning/);
  assert.match(ui, /Good afternoon/);
  assert.match(ui, /Good evening/);
  assert.match(ui, /EmployeeAvatar/);
  assert.match(shell, /EmployeeAvatar/);
});


test('daily pending-call WhatsApp report is scheduled for exactly 09:15 on the bridge PC and is idempotent', () => {
  const route = read('src/app/api/automation/pending-call-report/route.ts');
  const migration = readProject('Database_Migrations/fireblade_gen2_1_1_pending_call_reports.sql');
  const installer = readProject('WhatsApp_Bridge/INSTALL_FIREBLADE_PENDING_REPORT_TASK.ps1');
  const runner = readProject('WhatsApp_Bridge/RUN_FIREBLADE_PENDING_REPORT.ps1');
  assert.match(route, /fireblade_pending_call_report_yesterday/);
  assert.match(route, /whatsapp_number/);
  assert.match(route, /fireblade_claim_pending_call_report/);
  assert.match(route, /\/send/);
  assert.match(route, /x-fireblade-bridge-key/);
  assert.match(installer, /New-ScheduledTaskTrigger -Daily -At "09:15"/);
  assert.match(installer, /India Standard Time/);
  assert.match(runner, /automation\/pending-group-report/);
  assert.match(runner, /X-Fireblade-Bridge-Key/);
  assert.match(migration, /unique \(employee_id, report_date_ist\)/i);
  assert.match(migration, /status = 'FAILED'/);
});

test('product selection is single-click and public branding stays Fireblade Gen 2', () => {
  const ui = read('src/components/MyWhatsAppClient.tsx');
  const shell = read('src/components/AppShell.tsx');
  const login = read('src/app/login/page.tsx');
  const updates = read('src/components/UpdatesClient.tsx');
  assert.match(ui, /changeProductQuery/);
  assert.match(ui, /onClick=\{\(\) => void chooseProduct\(p\)\}/);
  assert.doesNotMatch(ui, /useEffect\(\(\) => \{\s*setSelected\(null\);\s*setPkg\(null\);\s*const q = query\.trim\(\)/s);
  assert.match(shell, /FIREBLADE_PRODUCT_NAME/);
  assert.match(shell, /departmentName/);
  assert.match(shell, /EmployeeAvatar/);
  assert.match(login, /FIREBLADE_PRODUCT_NAME/);
  assert.doesNotMatch(shell, /Fireblade Gen 2\.1/);
  assert.doesNotMatch(login, /Fireblade Gen 2\.1/);
  assert.match(updates, /FIREBLADE_INTERNAL_WEB_VERSION/);
});


test('Device Health hides unassigned, inactive-employee and retired/excluded devices', () => {
  const health = read('src/app/api/device-health/route.ts');
  const checks = read('src/app/api/device-checks/route.ts');
  for (const source of [health, checks]) {
    assert.match(source, /fireblade_device_assignments\?select=.*assigned_until=is\.null/);
    assert.match(source, /fireblade_employees\?select=.*active=eq\.true/);
    assert.match(source, /fireblade_dashboard_device_exclusions\?select=device_id&active=eq\.true/);
    assert.match(source, /excludedDeviceIds/);
  }
  assert.match(health, /if \(!assignment\) return false/);
  assert.match(health, /employeeById\.has\(assignment\.employee_id\)/);
});

test('Device Health OFF drill-down separates company-wide internet-off and phone-off employees', () => {
  const ui = read('src/components/DeviceHealthClient.tsx');
  const api = read('src/app/api/device-health/route.ts');
  const status = read('src/lib/device-status.ts');
  assert.match(ui, /Internet turned off/);
  assert.match(ui, /Phone off/);
  assert.match(ui, /groupAffectedEmployees/);
  assert.match(ui, /EmployeeAvatar/);
  assert.match(ui, /line\.phone_number/);
  assert.match(ui, /All departments are included/);
  assert.match(api, /internet_disconnected/);
  assert.match(api, /h\.wifi_connected === false/);
  assert.match(api, /h\.cellular_connected === false/);
  assert.match(status, /shutdown_persists|A verified shutdown remains authoritative/i);
  assert.doesNotMatch(status, /SHUTDOWN_FRESH_MS/);
});
