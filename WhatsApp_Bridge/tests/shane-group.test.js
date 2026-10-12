import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHANE_SESSION_KEY,
  SHANE_PHONE_NUMBER_CANONICAL,
  isAuthorizedShaneSender,
  formatIstDateTime,
  formatShaneGroupAssignmentText,
  resolveEmployeeMentions,
  hasCompleteEmployeeMentions,
  validMentionJid,
  shouldDeliverEvent,
  filterNewDetailEvents,
} from '../shane-group-logic.js';

describe('Shane Group Assignment Logic Tests', () => {
  test('constants and session keys are isolated', () => {
    assert.equal(SHANE_SESSION_KEY, 'fb_shane_assignments');
    assert.notEqual(SHANE_SESSION_KEY, 'fb_md');
    assert.equal(SHANE_PHONE_NUMBER_CANONICAL, '9345226022');
  });

  test('sender validation only allows Shane Sir canonical number', () => {
    assert.equal(isAuthorizedShaneSender('9345226022'), true);
    assert.equal(isAuthorizedShaneSender('919345226022'), true);
    assert.equal(isAuthorizedShaneSender('+91 93452 26022'), true);
    assert.equal(isAuthorizedShaneSender('918940944000'), false); // MD number rejected
    assert.equal(isAuthorizedShaneSender('919363226022'), false); // Employee number rejected
    assert.equal(isAuthorizedShaneSender(''), false);
    assert.equal(isAuthorizedShaneSender(null), false);
  });

  test('shouldDeliverEvent enforces activation timestamp cutoff (no historical replay)', () => {
    const activationCutoff = 1790000000000;
    
    // Past event before activation
    const pastEvent = {
      event_type: 'ASSIGNED',
      occurred_at_epoch_ms: activationCutoff - 1000,
    };
    assert.equal(shouldDeliverEvent(pastEvent, activationCutoff), false);

    // Event after activation
    const freshEvent = {
      event_type: 'ASSIGNED',
      occurred_at_epoch_ms: activationCutoff + 500,
    };
    assert.equal(shouldDeliverEvent(freshEvent, activationCutoff), true);

    // Non-assigned event type ignored
    const nonAssigned = {
      event_type: 'WHATSAPP_HANDOFF_OPENED',
      occurred_at_epoch_ms: activationCutoff + 500,
    };
    assert.equal(shouldDeliverEvent(nonAssigned, activationCutoff), false);

    // If activation cutoff is 0 or invalid, never deliver
    assert.equal(shouldDeliverEvent(freshEvent, 0), false);
  });

  test('filterNewDetailEvents detects already delivered events', () => {
    const events = [
      { event_id: 'ev-1', detail_id: 'det-1' },
      { event_id: 'ev-2', detail_id: 'det-1' },
    ];

    // No existing state -> all are new
    assert.equal(filterNewDetailEvents(events, null).length, 2);

    // State with ev-1 already sent -> only ev-2 is new
    const statePartial = { event_ids: ['ev-1'], status: 'SENT' };
    const filtered = filterNewDetailEvents(events, statePartial);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].event_id, 'ev-2');

    // State with both sent -> empty
    const stateComplete = { event_ids: ['ev-1', 'ev-2'], status: 'SENT' };
    assert.equal(filterNewDetailEvents(events, stateComplete).length, 0);
  });

  test('resolveEmployeeMentions maps participants by phone including LID', () => {
    const detailEvents = [
      { assigned_to_employee_id: 'EMP-001', whatsapp_recipient_number: '919087763000' },
      { assigned_to_employee_id: 'EMP-004', whatsapp_recipient_number: '916380371372' },
      { assigned_to_employee_id: 'EMP-999', whatsapp_recipient_number: '919999999999' }, // not in group
    ];

    const empMap = new Map([
      ['EMP-001', 'Gayathri'],
      ['EMP-004', 'Yazhini'],
      ['EMP-999', 'Unknown Employee'],
    ]);

    const participants = [
      {
        id: '919087763000@c.us',
        user: '919087763000',
        number: '919087763000',
        name: 'Gayathri N',
      },
      {
        id: '25481729019283@lid', // LID participant
        user: '25481729019283',
        number: '916380371372',
        phoneNumberJid: '916380371372@c.us',
        name: 'Yazhini',
      },
    ];

    const { employeeMentions, mentionJids } = resolveEmployeeMentions(detailEvents, empMap, participants);

    assert.equal(employeeMentions.length, 3);

    // EMP-001 matched via @c.us
    assert.equal(employeeMentions[0].matched, true);
    assert.equal(employeeMentions[0].tagText, '@919087763000');
    assert.equal(employeeMentions[0].name, 'Gayathri');

    // EMP-004 matched via @lid
    assert.equal(employeeMentions[1].matched, true);
    assert.equal(employeeMentions[1].tagText, '@25481729019283');
    assert.equal(employeeMentions[1].name, 'Yazhini');

    // EMP-999 not matched
    assert.equal(employeeMentions[2].matched, false);
    assert.equal(employeeMentions[2].tagText, null);
    assert.equal(employeeMentions[2].name, 'Unknown Employee');

    // Exactly one native group participant JID per employee, including LID.
    assert.deepEqual(mentionJids, ['919087763000@c.us', '25481729019283@lid']);
    assert.equal(hasCompleteEmployeeMentions(detailEvents, employeeMentions, mentionJids), false);
    assert.equal(hasCompleteEmployeeMentions(detailEvents.slice(0, 2), employeeMentions.slice(0, 2), mentionJids), true);
  });


  test('empty participant ID can never silently turn a group message into an untagged SENT', () => {
    const assigned = [{ assigned_to_employee_id: 'EMP-004', whatsapp_recipient_number: '6380371372' }];
    const { employeeMentions, mentionJids } = resolveEmployeeMentions(
      assigned, new Map([['EMP-004', 'Yazhini']]),
      [{ id: '', user: '', number: '916380371372', name: 'Yazhini' }],
    );
    assert.deepEqual(mentionJids, []);
    assert.equal(employeeMentions[0].matched, false);
    assert.equal(hasCompleteEmployeeMentions(assigned, employeeMentions, mentionJids), false);
    assert.equal(validMentionJid(''), null);
    assert.equal(validMentionJid('120363413977876124@g.us'), null);
    assert.equal(validMentionJid('25481729019283@lid'), '25481729019283@lid');
  });

  test('LID member must have a resolved phone alias matching the selected employee', () => {
    const assigned = [{ assigned_to_employee_id: 'EMP-004', whatsapp_recipient_number: '6380371372' }];
    const groupMembers = [
      { id: '25481729019283@lid', user: '25481729019283', number: '',
        phoneNumberJid: null, name: 'Yazhini' },
    ];
    const notResolved = resolveEmployeeMentions(
      assigned, new Map([['EMP-004', 'Yazhini']]), groupMembers,
    );
    assert.equal(notResolved.employeeMentions[0].matched, false);
    assert.equal(hasCompleteEmployeeMentions(assigned, notResolved.employeeMentions, notResolved.mentionJids), false);

    const resolved = resolveEmployeeMentions(assigned,
      new Map([['EMP-004', 'Yazhini']]),
      [{ ...groupMembers[0], phoneNumberJid: '916380371372@c.us' }]);
    assert.equal(resolved.employeeMentions[0].matched, true);
    assert.deepEqual(resolved.mentionJids, ['25481729019283@lid']);
    assert.equal(hasCompleteEmployeeMentions(assigned, resolved.employeeMentions, resolved.mentionJids), true);
  });

  test('duplicate or ambiguous WhatsApp group JIDs are not a verified mention', () => {
    const assigned = [{ assigned_to_employee_id: 'EMP-004', whatsapp_recipient_number: '6380371372' }];
    const members = [
      { id: '25481729019283@lid', phoneNumberJid: '916380371372@c.us' },
      { id: '919999999999@c.us', number: '916380371372' },
    ];
    const plan = resolveEmployeeMentions(assigned, new Map([['EMP-004', 'Yazhini']]), members);
    assert.equal(plan.employeeMentions[0].matched, false);
    assert.equal(plan.employeeMentions[0].reason, 'AMBIGUOUS_GROUP_PARTICIPANT');
    assert.equal(hasCompleteEmployeeMentions(assigned, plan.employeeMentions, plan.mentionJids), false);
  });

  test('Shane bridge fails closed before sending with empty native mentions', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(src, /if \(!mentionsComplete\)/);
    assert.match(src, /hasCompleteEmployeeMentions\(newEvents, employeeMentions, mentionJids\)/);
    assert.match(src, /mentions: mentionJids/);
    assert.match(src, /const deliveryStatus = mentionVerified \? 'SENT' : 'UNCERTAIN'/);
    assert.match(src, /await s\.client\.getChatById\(groupId\)/);
    assert.match(src, /WAWebApiContact/);
    // Regression: never call the direct employee-chat send endpoint for group assignments.
    assert.match(src, /s\.client\.sendMessage\(config\.groupId, messageText/);
  });

  test('formatShaneGroupAssignmentText formats all customer fields correctly', () => {
    const detail = {
      customer_name: 'Acme Corp',
      phone_number_raw: '+91 98765 43210',
      productAsked: 'Pressure Gauge',
      location: 'Coimbatore Industrial Estate',
      very_urgent: true,
      quotation: true,
      catalogue: false,
      image: true,
      notes: 'Customer wants calibration certificate included',
      call_started_at_epoch_ms: 1791800000000,
    };

    const employeeMentions = [
      { name: 'Gayathri', tagText: '@919087763000' },
      { name: 'Yazhini', tagText: '@916380371372' },
    ];

    const message = formatShaneGroupAssignmentText(detail, employeeMentions);

    assert.ok(message.includes('*NEW CUSTOMER ASSIGNMENT*'));
    assert.ok(message.includes('*Assigned to:* @919087763000 (Gayathri), @916380371372 (Yazhini)'));
    assert.ok(message.includes('*Customer Name:* Acme Corp'));
    assert.ok(message.includes('*Customer Number:* +91 98765 43210'));
    assert.ok(message.includes('*Product Asked:* Pressure Gauge'));
    assert.ok(message.includes('*Location:* Coimbatore Industrial Estate'));
    assert.ok(message.includes('*Priority:* VERY URGENT'));
    assert.ok(message.includes('*Required:* Quotation, Image'));
    assert.ok(message.includes('*Notes:* Customer wants calibration certificate included'));
    assert.ok(message.includes('*Date & Time:*'));
  });

  test('formatShaneGroupAssignmentText handles missing/optional fields gracefully', () => {
    const detail = {
      customer_name: '',
      phone_number_normalized: '9876543210',
      call_started_at_epoch_ms: 1791800000000,
    };

    const employeeMentions = [
      { name: 'Gayathri', tagText: null }, // unmatched in group
    ];

    const message = formatShaneGroupAssignmentText(detail, employeeMentions);

    assert.ok(message.includes('*Assigned to:* Gayathri'));
    assert.ok(message.includes('*Customer Name:* Not provided'));
    assert.ok(message.includes('*Customer Number:* 9876543210'));
    assert.ok(!message.includes('*Priority:* VERY URGENT'));
    assert.ok(!message.includes('*Required:*'));
    assert.ok(!message.includes('*Notes:*'));
  });
});
