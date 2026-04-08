DROP FUNCTION IF EXISTS public.tenant_exec(text, jsonb);

CREATE FUNCTION public.tenant_exec(p_query text, p_params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  result jsonb;
  q text;
  pc int;
  i int;
  val text;
BEGIN
  q := p_query;
  pc := jsonb_array_length(p_params);

  FOR i IN REVERSE pc..1 LOOP
    val := p_params->>( i - 1 );
    IF val IS NULL THEN
      q := replace(q, '$' || i::text || '::uuid', 'NULL');
      q := replace(q, '$' || i::text || '::int', 'NULL');
      q := replace(q, '$' || i::text || '::text', 'NULL');
      q := replace(q, '$' || i::text, 'NULL');
    ELSE
      q := replace(q, '$' || i::text || '::uuid', quote_literal(val) || '::uuid');
      q := replace(q, '$' || i::text || '::int', quote_literal(val) || '::int');
      q := replace(q, '$' || i::text || '::text', quote_literal(val) || '::text');
      q := replace(q, '$' || i::text, quote_literal(val));
    END IF;
  END LOOP;

  EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', q) INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_exec(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_exec(text, jsonb) TO service_role;
