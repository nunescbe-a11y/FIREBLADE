import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDOVER_SOURCES, latestHandovers, currentHandoverItems, istDay,
} from "../src/lib/shane-handover.ts";

const t1 = Date.parse("2026-10-08T17:08:00Z"); // 22:38 IST
const t2 = t1 + 60_000;
const details = [
  { detail_id: "d1", device_id: "MKT-019", employee_id: "EMP-017",
    customer_name: "Original Customer", product_asked: "Gauge", location: "Coimbatore",
    phone_number_raw: "", phone_number_normalized: "", notes: "", very_urgent: false,
    call_started_at_epoch_ms: t1 - 1000 },
  { detail_id: "d2", device_id: "MKT-001", employee_id: "TEST-SHANE-001",
    customer_name: "TEST Customer", product_asked: "Sensor", location: "Chennai",
    phone_number_raw: "", phone_number_normalized: "", notes: "", very_urgent: false,
    call_started_at_epoch_ms: t1 - 1000 },
];
const e = (id, detail, recipient, kind, when) => ({
  event_id: id, detail_id: detail, assigned_to_employee_id: recipient,
  event_type: kind, occurred_at_epoch_ms: when, recorded_at: new Date(when).toISOString(),
});

test("source box contracts use exact independent device/employee pairs", () => {
  assert.deepEqual(HANDOVER_SOURCES.original, {
    deviceId: "MKT-019", employeeId: "EMP-017", title: "Original Shane's Handover",
  });
  assert.deepEqual(HANDOVER_SOURCES.test, {
    deviceId: "MKT-001", employeeId: "TEST-SHANE-001", title: "Shane Test Handover",
  });
});

test("multi-employee save appears once in each recipient drill-down", () => {
  const events = latestHandovers([
    e("a", "d2", "EMP-001", "ASSIGNED", t1),
    e("b", "d2", "EMP-003", "ASSIGNED", t1),
    e("b", "d2", "EMP-003", "ASSIGNED", t1),
    e("c", "d2", "EMP-001", "WHATSAPP_HANDOFF_OPENED", t2),
  ]);
  const scope = details.filter(d => d.device_id === HANDOVER_SOURCES.test.deviceId && d.employee_id === HANDOVER_SOURCES.test.employeeId);
  assert.equal(currentHandoverItems(scope, events, "EMP-001").length, 1);
  assert.equal(currentHandoverItems(scope, events, "EMP-003").length, 1);
  assert.equal(currentHandoverItems(scope, events, "EMP-008").length, 0);
});

test("later reassignment replaces current recipients without erasing history", () => {
  const events = [
    e("a", "d1", "EMP-001", "ASSIGNED", t1),
    e("b", "d1", "EMP-003", "REASSIGNED", t2),
    e("c", "d1", "EMP-008", "REASSIGNED", t2),
  ];
  const current = latestHandovers(events);
  const original = details.filter(d => d.device_id === "MKT-019");
  assert.equal(currentHandoverItems(original, current, "EMP-001").length, 0);
  assert.equal(currentHandoverItems(original, current, "EMP-003").length, 1);
  assert.equal(currentHandoverItems(original, current, "EMP-008").length, 1);
  assert.equal(events.length, 3); // the audit sequence is preserved
});

test("test source cannot appear in original scoped handovers", () => {
  const handovers = latestHandovers([
    e("a", "d2", "EMP-008", "ASSIGNED", t1),
  ]);
  const original = details.filter(d => d.device_id === HANDOVER_SOURCES.original.deviceId && d.employee_id === HANDOVER_SOURCES.original.employeeId);
  const qa = details.filter(d => d.device_id === HANDOVER_SOURCES.test.deviceId && d.employee_id === HANDOVER_SOURCES.test.employeeId);
  assert.equal(currentHandoverItems(original, handovers, "EMP-008").length, 0);
  assert.equal(currentHandoverItems(qa, handovers, "EMP-008").length, 1);
});

test("assignment dates are calculated using IST, not the call or server save date", () => {
  const instant = Date.parse("2026-10-08T19:15:10Z");
  assert.equal(istDay(instant), "2026-10-09");
  const events = latestHandovers([e("a", "d1", "EMP-008", "ASSIGNED", instant)]);
  const original = details.filter(d => d.device_id === "MKT-019");
  assert.equal(currentHandoverItems(original, events, "EMP-008", "2026-10-09", "2026-10-09").length, 1);
  assert.equal(currentHandoverItems(original, events, "EMP-008", "2026-10-08", "2026-10-08").length, 0);
});

test("unassigned historical customers are not attributed to employees", () => {
  assert.equal(currentHandoverItems(details, latestHandovers([]), "EMP-001").length, 0);
});
