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

export function resolveEmployeeMentions(detailEvents, empMap, participants) {
  const employeeMentions = [];
  const mentionJids = [];

  const safeParticipants = Array.isArray(participants) ? participants : [];

  for (const ev of detailEvents) {
    const empId = ev.assigned_to_employee_id;
    const empName = empMap.get(empId) || empId;
    const rawPhone = String(ev.whatsapp_recipient_number || '').replace(/\D/g, '');
    const phone10 = rawPhone.slice(-10);

    const matched = safeParticipants.find(p => {
      const pNum = String(p.number || '').replace(/\D/g, '');
      const pUser = String(p.user || '').replace(/\D/g, '');
      const p10 = pNum.slice(-10) || pUser.slice(-10);
      return phone10 && p10 && (p10 === phone10);
    });

    if (matched) {
      if (matched.id) mentionJids.push(matched.id);
      if (matched.phoneNumberJid && matched.phoneNumberJid !== matched.id) {
        mentionJids.push(matched.phoneNumberJid);
      }
      employeeMentions.push({
        employeeId: empId,
        name: empName,
        tagText: `@${matched.user}`,
        participantId: matched.id,
        matched: true,
      });
    } else {
      employeeMentions.push({
        employeeId: empId,
        name: empName,
        tagText: null,
        participantId: null,
        matched: false,
      });
    }
  }

  return {
    employeeMentions,
    mentionJids: [...new Set(mentionJids)],
  };
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
