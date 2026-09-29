import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const shell = read("src/components/AppShell.tsx");
const page = read("src/app/performance/page.tsx");
const client = read("src/components/PerformanceIntelligenceClient.tsx");
const route = read("src/app/api/management/performance/intelligence/route.ts");
const css = read("src/app/globals.css");

test("navigation exposes Performance Intelligence",()=>assert.match(shell,/Performance Intelligence/));
test("navigation restricted through canManage",()=>assert.match(shell,/canManage && item\("\/performance"/));
test("page requires session",()=>assert.match(page,/if \(!user\) redirect\("\/login"\)/));
test("page blocks marketing",()=>assert.match(page,/user\.role === "MARKETING"/));
test("page uses AppShell",()=>assert.match(page,/<AppShell user=\{user\}>/));
test("supports same-period, previous-month and custom comparison modes", () => {
  assert.match(client, /type CompareMode = "same-period" \| "previous-month" \| "custom"/);
  assert.match(client, /comparisonFor/);
});
test("uses one optimized intelligence endpoint",()=>assert.doesNotMatch(client,/\/api\/management\/performance\?/));
test("uses intelligence API",()=>assert.match(client,/performance\/intelligence/));
test("route uses fast performance RPC",()=>assert.match(route,/fireblade_performance_intelligence_fast/));
test("shows incoming KPI",()=>assert.match(client,/Incoming calls/));
test("shows answer rate",()=>assert.match(client,/Answer rate/));
test("shows callback completion",()=>assert.match(client,/Callback completion/));
test("shows median callback time",()=>assert.match(client,/Median callback time/));
test("shows pending per 100",()=>assert.match(client,/Pending \/ 100 incoming/));
test("shows dynamic period comparison", () => {
  assert.match(client, /BarPair/);
  assert.match(client, /periodLabel/);
  assert.match(client, /previousLabel/);
  assert.match(client, /currentLabel/);
});
test("shows historical backlog",()=>assert.match(client,/Historical backlog/));
test("shows aging",()=>assert.match(client,/Backlog aging/));
test("distinguishes 0915 report",()=>assert.match(client,/09:15 WhatsApp report/));
test("management attention view",()=>assert.match(client,/Employees needing attention/));
test("admin employee comparison",()=>assert.match(client,/Employee performance comparison/));
test("admin technical backlog",()=>assert.match(client,/Technical backlog/));
test("admin CSV export",()=>assert.match(client,/Export CSV/));
test("print PDF",()=>assert.match(client,/Print \/ Save PDF/));
test("route authenticates",()=>assert.match(route,/const user = await getSession\(\)/));
test("route role checks",()=>assert.match(route,/user\.role !== "ADMIN" && user\.role !== "MANAGEMENT"/));
test("secret remains server-side",()=>assert.match(route,/SUPABASE_SECRET_KEY/));
test("route does not select phone numbers",()=>assert.doesNotMatch(route,/phone_number/));
test("under 2h bucket is consumed from optimized report",()=>assert.match(client,/intelligence\.aging\.under_2h/));
test("over 7d bucket is consumed from optimized report",()=>assert.match(client,/intelligence\.aging\.over_7d/));
test("median callback timing is consumed from optimized report",()=>assert.match(client,/timing\.current\.median_minutes/));
test("p90 callback timing is consumed from optimized report",()=>assert.match(client,/timing\.current\.p90_minutes/));
test("optimized report avoids paginated raw reads",()=>{assert.match(route,/fireblade_performance_intelligence_fast/);assert.doesNotMatch(route,/restPaged/);});
test("CSS marker",()=>assert.match(css,/FIREBLADE_PERFORMANCE_INTELLIGENCE_V1/));
test("responsive KPI grid",()=>assert.match(css,/pi-kpi-grid/));
test("print CSS",()=>assert.match(css,/@media print/));
test("no external chart library", () => {
  assert.doesNotMatch(
    client,
    /(?:from\s*["'](?:recharts|chart\.js|highcharts|d3)(?:\/[^"']*)?["']|require\(\s*["'](?:recharts|chart\.js|highcharts|d3)(?:\/[^"']*)?["']\s*\))/,
  );
});
test("manual date range inputs are available",()=>{assert.match(client,/type="date"/);assert.match(client,/Select dates manually/);});
test("future dates are blocked",()=>{assert.match(client,/max=\{today\}/);assert.match(client,/Future dates are not allowed/);});
test("from after to is rejected",()=>assert.match(client,/From date cannot be after To date/));
test("report range is capped at 366 days",()=>assert.match(client,/cannot exceed 366 days/));
test("same-period previous-month comparison is available",()=>assert.match(client,/Same period previous month/));
test("previous calendar month comparison is available",()=>assert.match(client,/Previous calendar month/));
test("custom comparison mode is available",()=>assert.match(client,/Custom comparison/));
test("quick Today range exists",()=>assert.match(client,/>Today</));
test("quick Last 7 Days range exists",()=>assert.match(client,/Last 7 Days/));
test("quick Last 30 Days range exists",()=>assert.match(client,/Last 30 Days/));
test("quick This Month range exists",()=>assert.match(client,/>This Month</));
test("selected dates drive optimized endpoint",()=>assert.match(client,/new URLSearchParams\(ranges\)/));
test("print and CSV use selected report",()=>{assert.match(client,/Print \/ Save PDF/);assert.match(client,/appliedRanges\.currentFrom/);});