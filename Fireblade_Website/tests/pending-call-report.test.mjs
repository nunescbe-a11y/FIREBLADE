import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPendingCallReportMessages, formatPendingCallIST, reportDateIST } from '../src/lib/pending-call-report.ts';

test('pending report uses India date/time and excludes resolved calls', () => {
  const pendingEpoch = Date.parse('2026-09-15T03:20:00.000Z'); // 08:50 IST
  const resolvedEpoch = Date.parse('2026-09-15T03:30:00.000Z');
  const messages = buildPendingCallReportMessages('DEVI', [
    { missed_call_id: 1, employee_id: 'EMP-008', employee_name: 'DEVI', department_name: 'Marketing', phone_number_raw: null, phone_number_normalized: '918940933000', missed_at_epoch_ms: pendingEpoch, callback_status: 'PENDING' },
    { missed_call_id: 2, employee_id: 'EMP-008', employee_name: 'DEVI', department_name: 'Marketing', phone_number_raw: null, phone_number_normalized: '919999999999', missed_at_epoch_ms: resolvedEpoch, callback_status: 'RESOLVED' },
  ]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /DEVI/);
  assert.match(messages[0], /\+918940933000/);
  assert.match(messages[0], /08:50\s*am/i);
  assert.doesNotMatch(messages[0], /919999999999/);
  assert.equal(reportDateIST(new Date('2026-09-14T20:00:00.000Z')), '2026-09-15');
  assert.match(formatPendingCallIST(pendingEpoch), /08:50\s*am/i);
});

test('pending report returns no WhatsApp message when there are no pending calls', () => {
  const messages = buildPendingCallReportMessages('DEVI', [
    { missed_call_id: 2, employee_id: 'EMP-008', employee_name: 'DEVI', department_name: 'Marketing', phone_number_raw: null, phone_number_normalized: '919999999999', missed_at_epoch_ms: Date.now(), callback_status: 'RESOLVED' },
  ]);
  assert.deepEqual(messages, []);
});

test('large pending reports split into safe WhatsApp-sized chunks', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({
    missed_call_id: i + 1,
    employee_id: 'EMP-008',
    employee_name: 'DEVI',
    department_name: 'Marketing',
    phone_number_raw: null,
    phone_number_normalized: `919000${String(i).padStart(6, '0')}`,
    missed_at_epoch_ms: Date.parse('2026-09-15T03:20:00.000Z') + i * 60000,
    callback_status: 'PENDING',
  }));
  const messages = buildPendingCallReportMessages('DEVI', rows);
  assert.ok(messages.length > 1);
  assert.ok(messages.every(message => message.length <= 12000));
});
