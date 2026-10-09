-- Fireblade: enable receipt and employee-save audit events for Shane in-app assignments.
-- Additive deployment prerequisite for the new /assigned-customers endpoints.
--
-- The production constraint (inspected 2026-10-09) currently allows only:
-- ASSIGNED, REASSIGNED, WHATSAPP_HANDOFF_OPENED, WHATSAPP_SEND_CONFIRMED.
-- Therefore inserts of EMPLOYEE_SAVED_DETAILS / RECEIVED_ON_APP / SEEN_ON_APP
-- would fail without this migration even after the backend deploys.
--
-- IMPORTANT: Apply in staging first, then during an approved production
-- release window with backup. This file is NOT auto-applied by a deployment.
BEGIN;

ALTER TABLE public.fireblade_shane_assignment_events
  DROP CONSTRAINT IF EXISTS fireblade_shane_assignment_events_event_type_check;

ALTER TABLE public.fireblade_shane_assignment_events
  ADD CONSTRAINT fireblade_shane_assignment_events_event_type_check
  CHECK (
    event_type IN (
      'ASSIGNED',
      'REASSIGNED',
      'WHATSAPP_HANDOFF_OPENED',
      'WHATSAPP_SEND_CONFIRMED',
      'EMPLOYEE_SAVED_DETAILS',
      'RECEIVED_ON_APP',
      'SEEN_ON_APP'
    )
  );

CREATE INDEX IF NOT EXISTS idx_fb_shane_assignment_recipient_type_time
  ON public.fireblade_shane_assignment_events
  (assigned_to_employee_id, event_type, occurred_at_epoch_ms DESC);

CREATE INDEX IF NOT EXISTS idx_fb_shane_assignment_detail_recipient_type
  ON public.fireblade_shane_assignment_events
  (detail_id, assigned_to_employee_id, event_type);

COMMIT;

-- Postflight (read-only):
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname='fireblade_shane_assignment_events_event_type_check';
-- SELECT indexname FROM pg_indexes WHERE tablename='fireblade_shane_assignment_events';
