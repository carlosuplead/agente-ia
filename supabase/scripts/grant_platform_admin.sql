-- Executar no Supabase: SQL Editor (Database → SQL).
-- Troca o email se for outro.

INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = lower(trim('SEU_EMAIL_AQUI'))
ON CONFLICT (user_id) DO NOTHING;

-- Verificar:
-- SELECT * FROM public.platform_admins;
