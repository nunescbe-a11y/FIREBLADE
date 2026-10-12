// FIREBLADE Shane WhatsApp Group Business Logic

export const SHANE_SESSION_KEY = 'fb_shane_assignments';
export const SHANE_PHONE_NUMBER_CANONICAL = '9345226022';
export const SHANE_ALLOWED_SENDER_NUMBERS = [
  SHANE_PHONE_NUMBER_CANONICAL,
  `91${SHANE_PHONE_NUMBER_CANONICAL}`,
];

export function isAuthorizedShaneSender(connectedNumber, allowedList = SHANE_ALLOWED_SENDER_NUMBERS) {
  const digits = String(connectedNumber || '').replace(/\D/g, '');
  if (!digits) return false;
  const last10 = digits.slice(-10);
  return allowedList.some(allowed => {
    const a10 = String(allowed).replace(/\D/g, '').slice(-10);
    return a10 && a10 === last10;
  });
}

export function formatIstDateTime(epochMs) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(Number(epochMs)));
  } catch {
    return new Date(Number(epochMs)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }
}

export function formatShaneGroupAssignmentText(detail, employeeMentions) {
  const effectiveEpoch = Number(
    detail.call_started_at_epoch_ms ||
    (detail.created_at ? new Date(detail.created_at).getTime() : Date.now())
  );
  const sentDateTime = formatIstDateTime(effectiveEpoch);

  const mentionTags = employeeMentions.length > 0
    ? employeeMentions
        .map(m => (m.tagText ? `${m.tagText} (${m.name})` : m.name))
        .join(', ')
    : 'Not assigned';

  const lines = [
    '*NEW CUSTOMER ASSIGNMENT*',
    `*Assigned to:* ${mentionTags}`,
    '',
    `*Customer Name:* ${detail.customer_name || detail.customerName || 'Not provided'}`,
    `*Customer Number:* ${detail.phone_number_raw || detail.phoneNumberRaw || detail.phone_number_normalized || detail.phoneNumberNormalized || detail.phone || '-'}`,
    `*Product Asked:* ${detail.product_asked || detail.productAsked || 'Not provided'}`,
    `*Location:* ${detail.location || 'Not provided'}`,
    `*Date & Time:* ${sentDateTime}`,
  ];

  if (detail.very_urgent || detail.veryUrgent) {
    lines.push('*Priority:* VERY URGENT');
  }

  const required = [];
  if (detail.quotation) required.push('Quotation');
  if (detail.catalogue) required.push('Catalogue');
  if (detail.image) required.push('Image');
  if (required.length) {
    lines.push(`*Required:* ${required.join(', ')}`);
  }

  if (detail.notes && String(detail.notes).trim()) {
    lines.push(`*Notes:* ${String(detail.notes).trim()}`);
  }

  return lines.join('\n');
}

// Only a real WhatsApp user JID can become a native group @mention.
// A visible "@name" string by itself does not notify the selected person.
export function validMentionJid(value) {
  const jid = String(value || '').trim();
  return /^[0-9]{8,20}@(c\.us|lid)$/.test(jid) ? jid : null;
}

export function resolveEmployeeMentions(detailEvents, empMap, participants) {
  const employeeMentions = [];
  const mentionJids = [];
  const safeParticipants = Array.isArray(participants) ? participants : [];
  const selected = new Set();

  for (const ev of detailEvents) {
    const empId = String(ev.assigned_to_employee_id || '').trim();
    if (!empId || selected.has(empId)) continue;
    selected.add(empId);
    const empName = empMap.get(empId) || empId;
    const selectedPhone = String(ev.whatsapp_recipient_number || '').replace(/\D/g, '').slice(-10);

    // @lid user digits are *not* a phone number. Match against resolved phone
    // metadata or an actual @c.us PN alias only; never match LID digits.
    const matches = selectedPhone ? safeParticipants.filter(p => {
      const groupJid = validMentionJid(p?.id);
      if (!groupJid) return false;
      const phoneCandidates = [
        p?.number,
        p?.phoneNumberJid,
        groupJid.endsWith('@c.us') ? groupJid : null,
      ];
      return phoneCandidates.some(phone => {
        const digits = String(phone || '').replace(/\D/g, '');
        return digits.length >= 10 && digits.slice(-10) === selectedPhone;
      });
    }) : [];

    // Multiple *different* participants resolving to one number are unsafe.
    const distinct = new Map(matches.map(p => [validMentionJid(p.id), p]));
    if (distinct.size !== 1) {
      employeeMentions.push({
        employeeId: empId, name: empName, tagText: null,
        participantId: null, matched: false,
        reason: !selectedPhone ? 'EMPLOYEE_PHONE_MISSING'
          : matches.length ? 'AMBIGUOUS_GROUP_PARTICIPANT'
            : 'EMPLOYEE_NOT_RESOLVED_IN_GROUP',
      });
      continue;
    }

    const [participantId] = distinct.keys();
    if (!participantId) {
      employeeMentions.push({
        employeeId: empId, name: empName, tagText: null,
        participantId: null, matched: false, reason: 'INVALID_PARTICIPANT_JID',
      });
      continue;
    }
    mentionJids.push(participantId);
    employeeMentions.push({
      employeeId: empId,
      name: empName,
      tagText: '@' + participantId.split('@')[0],
      participantId,
      matched: true,
    });
  }

  return {
    employeeMentions,
    mentionJids: [...new Set(mentionJids)],
  };
}

export function hasCompleteEmployeeMentions(detailEvents, employeeMentions, mentionJids) {
  const assigned = [...new Set(detailEvents.map(e => String(e.assigned_to_employee_id || '').trim()).filter(Boolean))];
  const resolved = new Map(employeeMentions.filter(m =>
    m.matched && validMentionJid(m.participantId)
  ).map(m => [m.employeeId, m.participantId]));
  const uniqueJids = new Set(mentionJids.filter(validMentionJid));
  // Don't mistake an empty recipients list or a matching *name* for an @mention.
  return assigned.length > 0 &&
    assigned.every(id => resolved.has(id)) &&
    uniqueJids.size === assigned.length &&
    [...resolved.values()].every(id => uniqueJids.has(id));
}

export function shouldDeliverEvent(event, activationTimestampMs) {
  if (!event || event.event_type !== 'ASSIGNED') return false;
  const eventEpoch = Number(event.occurred_at_epoch_ms || 0);
  const cutoff = Number(activationTimestampMs || 0);
  if (cutoff <= 0) return false;
  return eventEpoch >= cutoff;
}

export function filterNewDetailEvents(detailEvents, existingState) {
  if (!existingState) return detailEvents;
  const sentEventIds = new Set(existingState.event_ids || []);
  return detailEvents.filter(e => !sentEventIds.has(e.event_id));
}
