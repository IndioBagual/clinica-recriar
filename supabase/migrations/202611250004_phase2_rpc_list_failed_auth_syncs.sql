-- ============================================================================
-- FASE 2 (Migracao 4/4): RPC exclusivamente de leitura para visibilidade
-- operacional de falhas permanentes vigentes em private.auth_sync_outbox.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_admin_list_failed_auth_syncs(
  p_limit integer DEFAULT 50,
  p_after_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  job_id uuid,
  target_user_id uuid,
  target_versao bigint,
  operacao text,
  tentativas integer,
  max_tentativas integer,
  ultimo_erro_codigo text,
  concluido_em timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  -- private.has_permission('usuarios.manage') exige auth.uid() valido,
  -- perfil ativo e (is_admin_principal = true OR permissao 'usuarios.manage').
  IF auth.uid() IS NULL OR NOT private.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'Permissao usuarios.manage obrigatoria' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ultimo_job_terminal AS (
    SELECT DISTINCT ON (o.target_user_id)
      o.id AS job_id,
      o.target_user_id,
      o.target_versao,
      o.operacao,
      o.status,
      o.tentativas,
      o.max_tentativas,
      o.ultimo_erro_codigo,
      o.concluido_em
    FROM private.auth_sync_outbox o
    JOIN public.usuarios_perfil up ON up.id = o.target_user_id
    WHERE o.target_versao = up.estado_ativacao_versao
      AND o.status IN ('failed_permanent', 'succeeded')
      -- Se existe job ativo (pending|processing) na versao vigente, ele e necessariamente
      -- posterior a qualquer falha permanente anterior (garantido pelo indice unico parcial).
      AND NOT EXISTS (
        SELECT 1
        FROM private.auth_sync_outbox ativo_job
        WHERE ativo_job.target_user_id = o.target_user_id
          AND ativo_job.target_versao = up.estado_ativacao_versao
          AND ativo_job.status IN ('pending', 'processing')
      )
    ORDER BY
      o.target_user_id ASC,
      COALESCE(o.concluido_em, o.criado_em) DESC,
      o.criado_em DESC,
      CASE WHEN o.status = 'succeeded' THEN 1 ELSE 0 END DESC,
      o.id DESC
  )
  SELECT
    u.job_id,
    u.target_user_id,
    u.target_versao,
    u.operacao,
    u.tentativas,
    u.max_tentativas,
    u.ultimo_erro_codigo,
    u.concluido_em
  FROM ultimo_job_terminal u
  WHERE u.status = 'failed_permanent'
    AND (p_after_user_id IS NULL OR u.target_user_id > p_after_user_id)
  ORDER BY u.target_user_id ASC
  LIMIT v_limit;
END;
$$;

ALTER FUNCTION public.rpc_admin_list_failed_auth_syncs(integer, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.rpc_admin_list_failed_auth_syncs(integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rpc_admin_list_failed_auth_syncs(integer, uuid)
  TO authenticated;

COMMIT;