import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeShaneReportRows, shaneDateWindow } from "../src/lib/shane-information-report.ts";

const types = [
  { id: "q", code: "QUOTATION", label: "Quotation", sort_order: 10, active: true },
  { id: "c", code: "CATALOGUE", label: "Catalogue", sort_order: 20, active: true },
  { id: "i", code: "IMAGE", label: "Image", sort_order: 30, active: true },
];

function savedDetail(overrides = {}) {
  return {
    detail_id: "11111111-1111-4111-8111-111111111111", call_id: 101,
    device_id: "MKT-019", employee_id: "E01",
    phone_number_raw: "9999900000", phone_number_normalized: "9999900000",
    call_started_at_epoch_ms: Date.parse("2026-10-08T06:00:00.000Z"),
    customer_name: "Test Customer", product_asked: "Test Product", location: "Chennai",
    notes: "Send technical specification", very_urgent: true,
    quotation: null, catalogue: false, image: true,
    updated_at: "2026-10-08T07:00:00.000Z", ...overrides,
  };
}

test("Shane calls use the inclusive India-date window", () => {
  const { start, end } = shaneDateWindow("2026-10-08", "2026-10-08");
  assert.equal(new Date(start).toISOString(), "2026-10-07T18:30:00.000Z");
  assert.equal(new Date(end).toISOString(), "2026-10-08T18:30:00.000Z");
  assert.ok(start <= savedDetail().call_started_at_epoch_ms);
  assert.ok(savedDetail().call_started_at_epoch_ms < end);
});

test("Shane data displays location and urgency without inventing unoffered information options", () => {
  const rows = mergeShaneReportRows([], [savedDetail()], types, new Map([["E01", "Test Employee"]]));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source, "SHANE");
  assert.equal(row.employee_name, "Test Employee");
  assert.equal(row.customer_name, "Test Customer");
  assert.equal(row.product_name, "Test Product");
  assert.equal(row.location, "Chennai");
  assert.equal(row.very_urgent, true);
  // Even a legacy DB row with old boolean columns must NOT display those
  // fields as choices on Shane's actual customer-entry page.
  assert.deepEqual(row.information_items, []);
});

test("A Shane entry takes precedence for the same call ID rather than duplicating it", () => {
  const existing = {
    enquiry_id: "old", call_id: 101, call_at: "2026-10-08T06:00:00Z",
    employee_id: "E01", employee_name: "Employee", customer_name: "Original",
    customer_company: "", customer_phone: "9999900000", product_name: "Old",
    requirement_details: null, notes: null, information_items: [],
  };
  const rows = mergeShaneReportRows([existing], [savedDetail()], types, new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "SHANE");
  assert.equal(rows[0].product_name, "Test Product");
});

test("Unlinked Shane entries still appear as their own saved records", () => {
  const rows = mergeShaneReportRows([], [savedDetail({ call_id: null })], types, new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].call_id, null);
});

test("Assignment remains unrecorded until a separate assignment event is saved", () => {
  const rows = mergeShaneReportRows([], [savedDetail()], types, new Map([["E01", "Shane"]]));
  assert.equal(rows[0].employee_name, "Shane");
  assert.equal(rows[0].assigned_to_employee_id, null);
  assert.equal(rows[0].assigned_to_employee_name, null);
  assert.equal(rows[0].assigned_at, null);
  assert.equal(rows[0].assigned_at_epoch_ms, null);
});

test("Saved assignee and exact event timestamp are forwarded, independently of call employee", () => {
  const assignedTime = Date.parse("2026-10-08T06:07:31.000Z");
  const rows = mergeShaneReportRows([], [
    savedDetail({ assigned_to_employee_id: "E02", assigned_at_epoch_ms: assignedTime }),
  ], types, new Map([["E01", "Shane"], ["E02", "Kumar"]]));
  assert.equal(rows[0].employee_name, "Shane");
  assert.equal(rows[0].assigned_to_employee_id, "E02");
  assert.equal(rows[0].assigned_to_employee_name, "Kumar");
  assert.equal(rows[0].assigned_at_epoch_ms, assignedTime);
});
