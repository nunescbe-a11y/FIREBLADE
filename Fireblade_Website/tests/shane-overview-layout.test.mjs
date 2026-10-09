import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("both Shane sidebar tabs are removed for Admin and Management", () => {
  const nav = read("src/components/AppShell.tsx");
  assert.doesNotMatch(nav, /item\("\/shane-call-details"/);
  assert.doesNotMatch(nav, /item\("\/shane-handover"/);
  assert.match(nav, /item\("\/dashboard"/);
});

test("Overview displays two boxes before selecting a department and employee", () => {
  const dashboard = read("src/components/DashboardClient.tsx");
  const handover = read("src/components/DashboardShaneHandover.tsx");
  assert.match(dashboard, /<DashboardShaneHandover \/>/);
  assert.match(handover, /Original Shane's Handover/);
  assert.match(handover, /Shane Test Handover/);
  assert.match(handover, /departmentCards\.map/);
  assert.match(handover, /className=\{\`department-card/);
  assert.match(handover, /chooseDepartment\(dept\)/);
  assert.match(handover, /chooseEmployee\(person.employee_id\)/);
  assert.match(handover, /EmployeeAvatar/);
  assert.match(handover, /photoUpdatedAt=\{person.profile_photo_updated_at\}/);
  assert.doesNotMatch(handover, /<option value="MARKETING">/);
  assert.doesNotMatch(handover, /<option value="SERVICE">/);
  assert.match(handover, /profile photos/);
});

test("after employee drill-down, render the same original Information Sent table", () => {
  const ui = read("src/components/DashboardShaneHandover.tsx");
  assert.match(ui, /import InformationSentTable/);
  assert.match(ui, /className="overview-information-table"/);
  assert.match(ui, /rows=\{rows\}/);
  assert.match(ui, /onViewShaneDetails=/);
  assert.match(ui, /format: "csv"/);
  assert.match(ui, /format: "xlsx"/);
  assert.match(ui, /tableExpanded/);
});

test("original and test scopes remain exact, server-enforced, and history role-guarded", () => {
  const sources = read("src/lib/shane-handover.ts");
  const api = read("src/app/api/management/shane-handover/route.ts");
  assert.match(sources, /deviceId: "MKT-019", employeeId: "EMP-017"/);
  assert.match(sources, /deviceId: "MKT-001", employeeId: "TEST-SHANE-001"/);
  assert.match(api, /session\.role !== "ADMIN"/);
  assert.match(api, /session\.role !== "MANAGEMENT"/);
  assert.match(api, /device_id=eq\.\$\{source\.deviceId\}/);
  assert.match(api, /employee_id=eq\.\$\{source\.employeeId\}/);
});

test("ordinary employee reports are separate from both handover boxes", () => {
  const report = read("src/components/DashboardInformationSent.tsx");
  const api = read("src/app/api/management/information-sent/route.ts");
  assert.match(report, /source: "ENQUIRY"/);
  assert.match(report, /Other Employee Information Sent/);
  assert.match(api, /row\.source === source/);
});

test("Marketing and Service totals count unique assigned customer records", () => {
  const api = read("src/app/api/management/shane-handover/route.ts");
  assert.match(api, /uniqueByDepartment/);
  assert.match(api, /uniqueByDepartment.MARKETING.size/);
  assert.match(api, /uniqueByDepartment.SERVICE.size/);
  assert.match(api, /department_totals:/);
});

test("employee roster comes from active database profiles, not hardcoded photos", () => {
  const api = read("src/app/api/management/shane-handover/route.ts");
  const ui = read("src/components/DashboardShaneHandover.tsx");
  assert.match(api, /profile_photo_updated_at/);
  assert.match(api, /active=eq.true/);
  assert.match(ui, /photoUpdatedAt=\{person.profile_photo_updated_at\}/);
  assert.match(ui, /size="md"/);
  assert.match(ui, /person.count/);
});

test("expired Shane handover sessions require sign-in without exposing recipients", () => {
  const ui = read("src/components/DashboardShaneHandover.tsx");
  const api = read("src/app/api/management/shane-handover/route.ts");
  assert.match(ui, /result\.status === 401/);
  assert.match(ui, /credentials: "same-origin"/);
  assert.match(ui, /Your session has expired\. Please sign in again\./);
  assert.match(ui, /href="\/login"/);
  assert.match(ui, /!sessionExpired && <div className="department-grid"/);
  assert.match(ui, /!sessionExpired && employee && tableExpanded/);
  assert.match(api, /if \(!session\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(api, /session\.role !== "ADMIN" && session\.role !== "MANAGEMENT"/);
});
