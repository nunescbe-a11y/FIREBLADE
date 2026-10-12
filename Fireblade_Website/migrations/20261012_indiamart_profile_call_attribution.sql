-- Applied to Supabase as fireblade_indiamart_profile_call_attribution.
-- Tracking number 07942554266 is shared by Krishna and SF. Assign by receiving SIM,
-- never by the employee's device alone. Unknown/cross-routed calls stay OTHER.
CREATE OR REPLACE VIEW public.fireblade_indiamart_call_records
WITH (security_invoker = true) AS
WITH call_lines AS (
 SELECT c.call_id, c.device_id, c.registered_employee_id AS employee_id,
   COALESCE(c.registered_employee_name, c.collector_employee) AS employee_name,
   c.started_at_epoch_ms, c.started_at, c.direction, c.duration_seconds,
   c.phone_number_normalized,
   RIGHT(REGEXP_REPLACE(COALESCE(c.phone_number_normalized, ''), '[^0-9]', '', 'g'), 10) AS tracking_number,
   NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(line.phone_number, c.company_phone_number, ''), '[^0-9]', '', 'g'), 10),'') AS receiving_sim,
   c.call_sim_slot_index, c.resolved_sim_slot_index, c.line_resolution,
   CASE WHEN c.line_resolution = 'EXACT_SIM' THEN 'CONFIRMED'
        WHEN c.line_resolution = 'SINGLE_LINE_FALLBACK' THEN 'INFERRED'
        ELSE 'UNKNOWN' END AS sim_confidence
 FROM public.fireblade_incoming_calls c
 LEFT JOIN public.fireblade_device_lines line ON line.id = c.resolved_line_id
 WHERE c.direction IN ('INCOMING_ANSWERED', 'INCOMING_MISSED')
)
SELECT call_id, device_id, employee_id, employee_name, started_at_epoch_ms, started_at,
 direction, duration_seconds, phone_number_normalized, tracking_number, receiving_sim,
 call_sim_slot_index, resolved_sim_slot_index, line_resolution, sim_confidence,
 CASE
  WHEN tracking_number = '7942554266' AND receiving_sim IN ('9159242000','7305966225') THEN 'KRISHNA'
  WHEN tracking_number = '7942554266' AND receiving_sim IN ('8940944000','7550093383') THEN 'SF'
  WHEN tracking_number = '8048250260' AND receiving_sim IN ('9345226022','9087753000') THEN 'MOHAMMED'
  ELSE 'OTHER'
 END AS site
FROM call_lines WHERE tracking_number IN ('7942554266','8048250260');

CREATE OR REPLACE FUNCTION public.fireblade_indiamart_call_summary(p_since_ms bigint, p_until_ms bigint)
RETURNS TABLE(site text, employee_id text, employee_name text, receiving_sim text,
 total bigint, answered bigint, missed bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT c.site, COALESCE(c.employee_id, ''), COALESCE(c.employee_name, 'Unassigned'),
   COALESCE(c.receiving_sim, ''), COUNT(*)::bigint,
   COUNT(*) FILTER (WHERE c.direction = 'INCOMING_ANSWERED')::bigint,
   COUNT(*) FILTER (WHERE c.direction = 'INCOMING_MISSED')::bigint
 FROM public.fireblade_indiamart_call_records c
 WHERE c.started_at_epoch_ms >= p_since_ms AND c.started_at_epoch_ms < p_until_ms
 GROUP BY c.site, c.employee_id, c.employee_name, c.receiving_sim
 ORDER BY c.site, COUNT(*) DESC;
$$;
-- Service-role-only access. Next.js enforces ADMIN/MANAGEMENT sessions.
REVOKE ALL ON public.fireblade_indiamart_call_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fireblade_indiamart_call_records TO service_role;
REVOKE ALL ON FUNCTION public.fireblade_indiamart_call_summary(bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fireblade_indiamart_call_summary(bigint,bigint) TO service_role;
