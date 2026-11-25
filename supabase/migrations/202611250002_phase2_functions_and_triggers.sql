-- ============================================================================
-- FASE 2 (Migracao 2/3): 32 funcoes (SET search_path = ''), 10 triggers,
-- validacao estrita de auditoria, bootstrap, outbox e postura intermediaria
-- deny-by-default (zero EXECUTE para papeis de runtime antes da Migracao 3)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- A. Helpers RLS (private) — 4 funcoes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_active_admin_principal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios_perfil
    WHERE id = auth.uid()
      AND ativo = true
      AND is_admin_principal = true
  );
$$;
ALTER FUNCTION private.is_active_admin_principal() OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.is_user_admin_principal(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.usuarios_perfil
      WHERE id = p_user_id
        AND is_admin_principal = true
    ),
    false
  );
$$;
ALTER FUNCTION private.is_user_admin_principal(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.has_permission(p_chave text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_chave IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.usuarios_perfil up
      WHERE up.id = auth.uid()
        AND up.ativo = true
        AND (
          up.is_admin_principal = true
          OR EXISTS (
            SELECT 1
            FROM public.usuario_permissoes perm
            WHERE perm.usuario_id = up.id
              AND perm.permissao = p_chave
          )
        )
    ),
    false
  );
$$;
ALTER FUNCTION private.has_permission(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.is_delegable_permission(p_chave text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(p_chave = ANY (ARRAY[]::text[]), false);
$$;
ALTER FUNCTION private.is_delegable_permission(text) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- B. Nucleo de auditoria (fail-closed contra NULL SQL / null JSON) — 2 funcoes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.validate_audit_row(p_row public.audit_logs)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_keys text[];
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_pg_actor_re constant text := '^pg:[a-z_][a-z0-9_]{0,40}$';
  v_int_re constant text := '^[0-9]+$';
  v_acoes_validas constant text[] := ARRAY[
    'BOOTSTRAP_ADMIN_PRINCIPAL',
    'ADMIN_PRINCIPAL_PROMOTED',
    'ADMIN_PRINCIPAL_DEMOTED',
    'USER_PROFILE_CREATED',
    'USER_ACCESS_LINK_REQUESTED',
    'USER_UPDATED',
    'USER_DEACTIVATED',
    'USER_REACTIVATED',
    'PERMISSION_GRANTED',
    'PERMISSION_REVOKED',
    'AUTH_SYNC_MANUAL_RETRY_REQUESTED',
    'AUTH_SYNC_LEASE_EXHAUSTED',
    'AUTH_SYNC_STALE_RECONCILE_ENQUEUED',
    'AUTH_SYNC_STALE_CLAIM_DETECTED',
    'AUTH_SYNC_FAILURE_REPORTED',
    'AUTH_DRIFT_REPORTED',
    'AUTH_DRIFT_CORRECTION_REPORTED',
    'AUTH_LOGIN_RECORDED',
    'INITIAL_SETUP_REPORTED',
    'AUTH_LOGOUT_REPORTED',
    'AUTH_PASSWORD_UPDATE_REPORTED',
    'AUDIT_LOG_VIEWED_REPORTED',
    'ACCESS_DENIED',
    'AUTH_LOGIN_FAILED',
    'AUTH_PASSWORD_RESET_REQUEST'
  ];
  v_valid boolean := false;
BEGIN
  IF p_row.metadados IS NULL
     OR pg_catalog.jsonb_typeof(p_row.metadados) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit_logs.metadados deve ser objeto JSON nao nulo' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.pg_column_size(p_row.metadados) > 1024 THEN
    RAISE EXCEPTION 'audit_logs.metadados excede 1024 bytes' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(k ORDER BY k), ARRAY[]::text[])
  INTO v_keys
  FROM pg_catalog.jsonb_object_keys(p_row.metadados) AS k;

  CASE p_row.acao
    -- === EVENTOS VERIFICADOS PELO BANCO (verificado_banco) ===
    WHEN 'BOOTSTRAP_ADMIN_PRINCIPAL' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'cli_bootstrap'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema = 'cli_bootstrap'
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['origem']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'origem') = 'string'
        AND p_row.metadados->>'origem' = 'cli_local'
      ), false);

    WHEN 'ADMIN_PRINCIPAL_PROMOTED', 'ADMIN_PRINCIPAL_DEMOTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'cli_operador_db'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema IS NOT NULL
        AND p_row.ator_sistema ~ v_pg_actor_re
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND pg_catalog.jsonb_typeof(p_row.metadados->'origem') = 'string'
        AND p_row.metadados->>'origem' = 'cli_local'
        AND pg_catalog.jsonb_typeof(p_row.metadados->'comprovacao_operador') = 'string'
        AND (
          (
            p_row.metadados->>'comprovacao_operador' = 'auth_cli_nao_verificado_pelo_db'
            AND v_keys = ARRAY['comprovacao_operador', 'operador_cli_declarado_id', 'origem']
            AND pg_catalog.jsonb_typeof(p_row.metadados->'operador_cli_declarado_id') = 'string'
            AND (p_row.metadados->>'operador_cli_declarado_id') ~* v_uuid_re
          )
          OR (
            p_row.metadados->>'comprovacao_operador' = 'emergencia_db_sem_operador_auth'
            AND v_keys = ARRAY['comprovacao_operador', 'origem']
            AND NOT (p_row.metadados ? 'operador_cli_declarado_id')
          )
        )
      ), false);

    WHEN 'USER_PROFILE_CREATED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['convite_solicitado']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'convite_solicitado') = 'boolean'
      ), false);

    WHEN 'USER_UPDATED' THEN
      v_valid := COALESCE((
        (
          (p_row.ator_tipo = 'usuario' AND p_row.usuario_id IS NOT NULL AND p_row.ator_sistema IS NULL)
          OR (p_row.ator_tipo = 'sistema' AND p_row.usuario_id IS NULL AND p_row.ator_sistema = 'db_admin_direct')
        )
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['campos']
        AND p_row.metadados = '{"campos":["nome"]}'::jsonb
      ), false);

    WHEN 'USER_DEACTIVATED', 'USER_REACTIVATED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['outbox_enqueued', 'versao']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'outbox_enqueued') = 'boolean'
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'versao') = 'number'
                   AND (p_row.metadados->>'versao') ~ v_int_re
              THEN (p_row.metadados->>'versao')::bigint >= 1
              ELSE false
            END
      ), false);

    WHEN 'PERMISSION_GRANTED', 'PERMISSION_REVOKED' THEN
      v_valid := COALESCE((
        (
          (p_row.ator_tipo = 'usuario' AND p_row.usuario_id IS NOT NULL AND p_row.ator_sistema IS NULL)
          OR (p_row.ator_tipo = 'sistema' AND p_row.usuario_id IS NULL AND p_row.ator_sistema = 'db_admin_direct')
        )
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'usuario_permissoes'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['permissao']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'permissao') = 'string'
        AND (p_row.metadados->>'permissao') IN ('usuarios.manage', 'auditoria.read')
      ), false);

    WHEN 'AUTH_SYNC_MANUAL_RETRY_REQUESTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'auth_sync_outbox'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['operacao', 'versao']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'operacao') = 'string'
        AND (p_row.metadados->>'operacao') IN ('ban_user', 'unban')
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'versao') = 'number'
                   AND (p_row.metadados->>'versao') ~ v_int_re
              THEN (p_row.metadados->>'versao')::bigint >= 1
              ELSE false
            END
      ), false);

    WHEN 'AUTH_SYNC_LEASE_EXHAUSTED', 'AUTH_SYNC_STALE_RECONCILE_ENQUEUED', 'AUTH_SYNC_STALE_CLAIM_DETECTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'sistema'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema IN ('auth_sync_worker', 'auth_sync_sweep')
        AND p_row.confiabilidade = 'verificado_banco'
        AND p_row.recurso_entidade = 'auth_sync_outbox'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND v_keys = ARRAY['operacao', 'tentativas']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'operacao') = 'string'
        AND (p_row.metadados->>'operacao') IN ('ban_user', 'unban')
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'tentativas') = 'number'
                   AND (p_row.metadados->>'tentativas') ~ v_int_re
              THEN (p_row.metadados->>'tentativas')::integer BETWEEN 1 AND 20
              ELSE false
            END
        AND (
          (p_row.acao = 'AUTH_SYNC_LEASE_EXHAUSTED'
            AND p_row.resultado = 'erro'
            AND p_row.codigo_motivo = 'lease_expirado_max_tentativas')
          OR (p_row.acao = 'AUTH_SYNC_STALE_RECONCILE_ENQUEUED'
            AND p_row.resultado = 'sucesso'
            AND p_row.codigo_motivo IS NULL)
          OR (p_row.acao = 'AUTH_SYNC_STALE_CLAIM_DETECTED'
            AND p_row.resultado = 'negado'
            AND p_row.codigo_motivo = 'claim_expirado_reconciliacao_enfileirada')
        )
      ), false);

    -- === EVENTOS CORRELACIONADOS AO AUTH (correlacionado_auth) ===
    WHEN 'AUTH_LOGIN_RECORDED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'correlacionado_auth'
        AND p_row.recurso_entidade = 'auth'
        AND p_row.recurso_id = p_row.usuario_id::text
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY[]::text[]
      ), false);

    -- === EVENTOS REPORTADOS PELA APLICACAO / WORKER (reportado_aplicacao) ===
    WHEN 'USER_ACCESS_LINK_REQUESTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY['fluxo']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'fluxo') = 'string'
        AND (p_row.metadados->>'fluxo') IN ('convite', 'definicao_senha')
      ), false);

    WHEN 'AUTH_SYNC_FAILURE_REPORTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'sistema'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema = 'auth_sync_worker'
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'auth_sync_outbox'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND p_row.resultado = 'erro'
        AND p_row.codigo_motivo IN ('auth_timeout', 'auth_5xx', 'auth_4xx', 'max_tentativas_excedido')
        AND v_keys = ARRAY['operacao', 'tentativas']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'operacao') = 'string'
        AND (p_row.metadados->>'operacao') IN ('ban_user', 'unban')
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'tentativas') = 'number'
                   AND (p_row.metadados->>'tentativas') ~ v_int_re
              THEN (p_row.metadados->>'tentativas')::integer BETWEEN 1 AND 20
              ELSE false
            END
      ), false);

    WHEN 'AUTH_DRIFT_REPORTED', 'AUTH_DRIFT_CORRECTION_REPORTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'sistema'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema IN ('auth_reconciler', 'auth_sync_worker')
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'usuarios_perfil'
        AND p_row.recurso_id IS NOT NULL
        AND p_row.recurso_id ~* v_uuid_re
        AND v_keys = ARRAY['ativo_esperado', 'versao']
        AND pg_catalog.jsonb_typeof(p_row.metadados->'ativo_esperado') = 'boolean'
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'versao') = 'number'
                   AND (p_row.metadados->>'versao') ~ v_int_re
              THEN (p_row.metadados->>'versao')::bigint >= 1
              ELSE false
            END
        AND (
          (p_row.acao = 'AUTH_DRIFT_REPORTED' AND p_row.resultado = 'erro' AND p_row.codigo_motivo = 'estado_auth_divergente')
          OR (p_row.acao = 'AUTH_DRIFT_CORRECTION_REPORTED' AND p_row.resultado = 'sucesso' AND p_row.codigo_motivo IS NULL)
        )
      ), false);

    WHEN 'INITIAL_SETUP_REPORTED', 'AUTH_LOGOUT_REPORTED', 'AUTH_PASSWORD_UPDATE_REPORTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'auth'
        AND p_row.recurso_id = p_row.usuario_id::text
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND v_keys = ARRAY[]::text[]
      ), false);

    WHEN 'AUDIT_LOG_VIEWED_REPORTED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'usuario'
        AND p_row.usuario_id IS NOT NULL
        AND p_row.ator_sistema IS NULL
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'audit_logs'
        AND p_row.recurso_id IS NULL
        AND p_row.resultado = 'sucesso'
        AND p_row.codigo_motivo IS NULL
        AND (v_keys @> ARRAY['limite', 'pagina'])
        AND (v_keys <@ ARRAY['filtro_acao', 'limite', 'pagina'])
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'pagina') = 'number'
                   AND (p_row.metadados->>'pagina') ~ v_int_re
              THEN (p_row.metadados->>'pagina')::integer BETWEEN 1 AND 10000
              ELSE false
            END
        AND CASE
              WHEN pg_catalog.jsonb_typeof(p_row.metadados->'limite') = 'number'
                   AND (p_row.metadados->>'limite') ~ v_int_re
              THEN (p_row.metadados->>'limite')::integer BETWEEN 1 AND 100
              ELSE false
            END
        AND (
          NOT (p_row.metadados ? 'filtro_acao')
          OR (
            pg_catalog.jsonb_typeof(p_row.metadados->'filtro_acao') = 'string'
            AND (p_row.metadados->>'filtro_acao') = ANY(v_acoes_validas)
          )
        )
      ), false);

    WHEN 'ACCESS_DENIED' THEN
      v_valid := COALESCE((
        (
          (p_row.ator_tipo = 'usuario' AND p_row.usuario_id IS NOT NULL AND p_row.ator_sistema IS NULL)
          OR (p_row.ator_tipo = 'sistema' AND p_row.usuario_id IS NULL AND p_row.ator_sistema = 'nextjs_server')
        )
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade IN ('auth', 'usuarios_perfil', 'usuario_permissoes', 'audit_logs', 'gestao')
        AND p_row.resultado = 'negado'
        AND p_row.codigo_motivo IN (
          'sem_sessao', 'sessao_expirada', 'conta_desativada', 'sem_perfil',
          'sem_permissao', 'csrf_invalido', 'origem_invalida', 'rate_limited'
        )
        AND (p_row.recurso_id IS NULL OR p_row.recurso_id ~* v_uuid_re)
        AND v_keys = ARRAY[]::text[]
      ), false);

    WHEN 'AUTH_LOGIN_FAILED' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'sistema'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema = 'nextjs_server'
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'auth'
        AND p_row.recurso_id IS NULL
        AND p_row.resultado = 'negado'
        AND p_row.codigo_motivo IN ('credenciais_invalidas', 'rate_limited', 'conta_bloqueada')
        AND v_keys = ARRAY[]::text[]
      ), false);

    WHEN 'AUTH_PASSWORD_RESET_REQUEST' THEN
      v_valid := COALESCE((
        p_row.ator_tipo = 'sistema'
        AND p_row.usuario_id IS NULL
        AND p_row.ator_sistema = 'nextjs_server'
        AND p_row.confiabilidade = 'reportado_aplicacao'
        AND p_row.recurso_entidade = 'auth'
        AND p_row.recurso_id IS NULL
        AND (
          (p_row.resultado = 'sucesso' AND p_row.codigo_motivo IS NULL)
          OR (p_row.resultado = 'negado' AND p_row.codigo_motivo = 'rate_limited')
        )
        AND v_keys = ARRAY[]::text[]
      ), false);

    ELSE
      v_valid := false;
  END CASE;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Registro de auditoria rejeitado por private.validate_audit_row (acao=%)', p_row.acao
      USING ERRCODE = '22023';
  END IF;
END;
$$;
ALTER FUNCTION private.validate_audit_row(public.audit_logs) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.write_audit_log(
  p_ator_tipo text,
  p_usuario_id uuid,
  p_ator_sistema text,
  p_confiabilidade text,
  p_acao text,
  p_recurso_entidade text,
  p_recurso_id text,
  p_resultado text,
  p_codigo_motivo text,
  p_metadados jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_logs (
    ator_tipo, usuario_id, ator_sistema, confiabilidade,
    acao, recurso_entidade, recurso_id, resultado, codigo_motivo, metadados
  )
  VALUES (
    p_ator_tipo, p_usuario_id, p_ator_sistema, p_confiabilidade,
    p_acao, p_recurso_entidade, p_recurso_id, p_resultado, p_codigo_motivo,
    COALESCE(p_metadados, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
ALTER FUNCTION private.write_audit_log(text, uuid, text, text, text, text, text, text, text, jsonb) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- C. Sweep interno de jobs expirados (Nivel 3 com SKIP LOCKED) — 1 funcao
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.sweep_expired_auth_sync_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rec record;
BEGIN
  WITH antigos AS (
    SELECT o.id
    FROM private.auth_sync_outbox o
    JOIN public.usuarios_perfil up ON up.id = o.target_user_id
    WHERE o.status = 'processing'
      AND o.lease_expires_at <= pg_catalog.now()
      AND o.target_versao < up.estado_ativacao_versao
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE private.auth_sync_outbox o
  SET status = 'expired_stale',
      claim_token = NULL,
      lease_expires_at = NULL,
      concluido_em = pg_catalog.now()
  FROM antigos a
  WHERE o.id = a.id;

  FOR v_rec IN
    WITH esgotados AS (
      SELECT o.id
      FROM private.auth_sync_outbox o
      JOIN public.usuarios_perfil up ON up.id = o.target_user_id
      WHERE o.status = 'processing'
        AND o.lease_expires_at <= pg_catalog.now()
        AND o.target_versao = up.estado_ativacao_versao
        AND o.tentativas >= o.max_tentativas
      FOR UPDATE OF o SKIP LOCKED
    )
    UPDATE private.auth_sync_outbox o
    SET status = 'failed_permanent',
        ultimo_erro_codigo = 'lease_expirado_max_tentativas',
        claim_token = NULL,
        lease_expires_at = NULL,
        concluido_em = pg_catalog.now()
    FROM esgotados e
    WHERE o.id = e.id
    RETURNING o.id, o.operacao, o.tentativas
  LOOP
    PERFORM private.write_audit_log(
      'sistema', NULL, 'auth_sync_sweep', 'verificado_banco',
      'AUTH_SYNC_LEASE_EXHAUSTED', 'auth_sync_outbox', v_rec.id::text,
      'erro', 'lease_expirado_max_tentativas',
      pg_catalog.jsonb_build_object('operacao', v_rec.operacao, 'tentativas', v_rec.tentativas)
    );
  END LOOP;
END;
$$;
ALTER FUNCTION private.sweep_expired_auth_sync_jobs() OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- D. Triggers (8 funcoes de trigger + 10 triggers)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.trg_audit_logs_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs e append-only: operacao % bloqueada', TG_OP USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION private.trg_audit_logs_block_mutation() OWNER TO postgres;

CREATE TRIGGER trg_audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.trg_audit_logs_block_mutation();

CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION private.trg_audit_logs_block_mutation();

CREATE OR REPLACE FUNCTION private.trg_audit_logs_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.metadados IS NULL THEN
    NEW.metadados := '{}'::jsonb;
  END IF;
  PERFORM private.validate_audit_row(NEW);
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.trg_audit_logs_validate_insert() OWNER TO postgres;

CREATE TRIGGER trg_audit_logs_validate_insert
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.trg_audit_logs_validate_insert();

CREATE OR REPLACE FUNCTION private.trg_usuarios_perfil_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.nome := pg_catalog.btrim(NEW.nome);
  NEW.email := pg_catalog.lower(pg_catalog.btrim(NEW.email));

  IF NEW.is_admin_principal = true THEN
    IF current_user IN ('anon', 'authenticated', 'service_role') THEN
      RAISE EXCEPTION 'Papel % nao autorizado a criar Administrador Principal', current_user USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM private.admin_principal_op_guard
      WHERE xid = pg_catalog.pg_current_xact_id()
        AND operacao = 'bootstrap'
        AND target_user_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Criacao de Administrador Principal exige procedimento controlado de bootstrap' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.trg_usuarios_perfil_before_insert() OWNER TO postgres;

CREATE TRIGGER trg_usuarios_perfil_guard_insert
  BEFORE INSERT ON public.usuarios_perfil
  FOR EACH ROW EXECUTE FUNCTION private.trg_usuarios_perfil_before_insert();

CREATE OR REPLACE FUNCTION private.trg_usuarios_perfil_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.criado_por IS DISTINCT FROM OLD.criado_por
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
    RAISE EXCEPTION 'Colunas imutaveis de usuarios_perfil nao podem ser alteradas' USING ERRCODE = '42501';
  END IF;

  IF current_user = 'authenticated' THEN
    IF NEW.is_admin_principal IS DISTINCT FROM OLD.is_admin_principal
       OR NEW.ativo IS DISTINCT FROM OLD.ativo
       OR NEW.estado_ativacao_versao IS DISTINCT FROM OLD.estado_ativacao_versao
       OR NEW.desativado_em IS DISTINCT FROM OLD.desativado_em
       OR NEW.desativado_por IS DISTINCT FROM OLD.desativado_por
       OR NEW.convite_solicitado_em IS DISTINCT FROM OLD.convite_solicitado_em
       OR NEW.email_confirmado_em IS DISTINCT FROM OLD.email_confirmado_em
       OR NEW.configuracao_inicial_reportada_em IS DISTINCT FROM OLD.configuracao_inicial_reportada_em
       OR NEW.primeiro_acesso_observado_em IS DISTINCT FROM OLD.primeiro_acesso_observado_em
       OR NEW.ultimo_acesso_auth_em IS DISTINCT FROM OLD.ultimo_acesso_auth_em THEN
      RAISE EXCEPTION 'Alteracao direta de coluna sensivel nao permitida para authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.is_admin_principal IS DISTINCT FROM OLD.is_admin_principal THEN
    IF current_user IN ('anon', 'authenticated', 'service_role') THEN
      RAISE EXCEPTION 'Papel % nao autorizado a alterar is_admin_principal', current_user USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM private.admin_principal_op_guard
      WHERE xid = pg_catalog.pg_current_xact_id()
        AND target_user_id = OLD.id
        AND (
          (NEW.is_admin_principal = true AND operacao = 'promote')
          OR (NEW.is_admin_principal = false AND operacao = 'demote')
        )
    ) THEN
      RAISE EXCEPTION 'Alteracao de is_admin_principal exige funcao controlada em private' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND OLD.id = auth.uid() AND NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'Usuario nao pode alterar o proprio estado de ativacao' USING ERRCODE = '42501';
  END IF;

  -- Defesa em profundidade: invariante de >= 1 Administrador Principal ativo
  IF OLD.is_admin_principal = true
     AND OLD.ativo = true
     AND (NEW.ativo = false OR NEW.is_admin_principal = false) THEN
    IF pg_catalog.current_setting('transaction_isolation') = 'repeatable read' THEN
      RAISE EXCEPTION 'Operacao sobre Administrador Principal exige isolamento read committed ou serializable'
        USING ERRCODE = '25001';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('clinica_recriar_admin_principal_lock')::bigint
    );

    PERFORM 1
    FROM public.usuarios_perfil
    WHERE is_admin_principal = true
      AND ativo = true
      AND id <> OLD.id
    ORDER BY id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nao e permitido desativar ou rebaixar o ultimo Administrador Principal ativo'
        USING ERRCODE = 'CR001';
    END IF;
  END IF;

  NEW.nome := pg_catalog.btrim(NEW.nome);

  IF NEW.ativo = false AND OLD.ativo = true THEN
    NEW.desativado_em := COALESCE(NEW.desativado_em, pg_catalog.now());
  ELSIF NEW.ativo = true AND OLD.ativo = false THEN
    NEW.desativado_em := NULL;
    NEW.desativado_por := NULL;
  END IF;

  NEW.atualizado_em := pg_catalog.now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.trg_usuarios_perfil_before_update() OWNER TO postgres;

CREATE TRIGGER trg_usuarios_perfil_guard_update
  BEFORE UPDATE ON public.usuarios_perfil
  FOR EACH ROW EXECUTE FUNCTION private.trg_usuarios_perfil_before_update();

CREATE OR REPLACE FUNCTION private.trg_usuarios_perfil_after_update_nome_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM private.write_audit_log(
      'usuario', v_uid, NULL, 'verificado_banco',
      'USER_UPDATED', 'usuarios_perfil', NEW.id::text, 'sucesso', NULL,
      '{"campos":["nome"]}'::jsonb
    );
  ELSE
    PERFORM private.write_audit_log(
      'sistema', NULL, 'db_admin_direct', 'verificado_banco',
      'USER_UPDATED', 'usuarios_perfil', NEW.id::text, 'sucesso', NULL,
      '{"campos":["nome"]}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.trg_usuarios_perfil_after_update_nome_audit() OWNER TO postgres;

CREATE TRIGGER trg_usuarios_perfil_audit_nome
  AFTER UPDATE ON public.usuarios_perfil
  FOR EACH ROW
  WHEN (OLD.nome IS DISTINCT FROM NEW.nome)
  EXECUTE FUNCTION private.trg_usuarios_perfil_after_update_nome_audit();

CREATE OR REPLACE FUNCTION private.trg_usuario_permissoes_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
    END IF;
    NEW.concedida_por := auth.uid();
    NEW.concedida_em := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.trg_usuario_permissoes_before_insert() OWNER TO postgres;

CREATE TRIGGER trg_usuario_permissoes_guard_insert
  BEFORE INSERT ON public.usuario_permissoes
  FOR EACH ROW EXECUTE FUNCTION private.trg_usuario_permissoes_before_insert();

CREATE OR REPLACE FUNCTION private.trg_usuario_permissoes_after_change_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acao text := CASE WHEN TG_OP = 'INSERT' THEN 'PERMISSION_GRANTED' ELSE 'PERMISSION_REVOKED' END;
  v_target_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.usuario_id ELSE OLD.usuario_id END;
  v_perm text := CASE WHEN TG_OP = 'INSERT' THEN NEW.permissao ELSE OLD.permissao END;
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM private.write_audit_log(
      'usuario', v_uid, NULL, 'verificado_banco',
      v_acao, 'usuario_permissoes', v_target_id::text, 'sucesso', NULL,
      pg_catalog.jsonb_build_object('permissao', v_perm)
    );
  ELSE
    PERFORM private.write_audit_log(
      'sistema', NULL, 'db_admin_direct', 'verificado_banco',
      v_acao, 'usuario_permissoes', v_target_id::text, 'sucesso', NULL,
      pg_catalog.jsonb_build_object('permissao', v_perm)
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
ALTER FUNCTION private.trg_usuario_permissoes_after_change_audit() OWNER TO postgres;

CREATE TRIGGER trg_usuario_permissoes_audit_change
  AFTER INSERT OR DELETE ON public.usuario_permissoes
  FOR EACH ROW EXECUTE FUNCTION private.trg_usuario_permissoes_after_change_audit();

CREATE OR REPLACE FUNCTION private.trg_sistema_bootstrap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM public.sistema_bootstrap WHERE status = 'completed') THEN
      RAISE EXCEPTION 'sistema_bootstrap concluido nao pode ser truncado' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'sistema_bootstrap concluido e imutavel (% bloqueado)', TG_OP USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
ALTER FUNCTION private.trg_sistema_bootstrap_guard() OWNER TO postgres;

CREATE TRIGGER trg_sistema_bootstrap_no_change_after_complete
  BEFORE UPDATE OR DELETE ON public.sistema_bootstrap
  FOR EACH ROW EXECUTE FUNCTION private.trg_sistema_bootstrap_guard();

CREATE TRIGGER trg_sistema_bootstrap_no_truncate_after_complete
  BEFORE TRUNCATE ON public.sistema_bootstrap
  FOR EACH STATEMENT EXECUTE FUNCTION private.trg_sistema_bootstrap_guard();

-- ----------------------------------------------------------------------------
-- E. Funcoes exclusivas de CLI (conexao PostgreSQL TLS verify-full) — 4 funcoes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.acquire_bootstrap_admin(
  p_email text,
  p_nome text,
  p_recover boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_nome text;
  v_recover boolean := COALESCE(p_recover, false);
  v_row public.sistema_bootstrap%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_nome IS NULL THEN
    RAISE EXCEPTION 'Nome e e-mail nao nulos sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_nome := pg_catalog.btrim(p_nome);

  IF pg_catalog.char_length(v_nome) < 2 OR v_email = '' THEN
    RAISE EXCEPTION 'Nome e e-mail validos sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clinica_recriar_bootstrap_lock')::bigint
  );

  IF EXISTS (SELECT 1 FROM public.usuarios_perfil WHERE is_admin_principal = true) THEN
    RAISE EXCEPTION 'Bootstrap bloqueado: ja existe Administrador Principal' USING ERRCODE = 'CR010';
  END IF;

  SELECT * INTO v_row FROM public.sistema_bootstrap WHERE singleton = true FOR UPDATE;

  IF NOT FOUND THEN
    IF v_recover THEN
      RAISE EXCEPTION 'Nao existe bootstrap pendente para recuperacao' USING ERRCODE = 'CR011';
    END IF;
    INSERT INTO public.sistema_bootstrap (singleton, status, target_email)
    VALUES (true, 'in_progress', v_email);
    RETURN 'acquired';
  END IF;

  IF v_row.status = 'completed' THEN
    RAISE EXCEPTION 'Bootstrap ja concluido definitivamente' USING ERRCODE = 'CR010';
  END IF;

  IF NOT v_recover THEN
    RAISE EXCEPTION 'Bootstrap pendente em andamento. Use --recover com o mesmo e-mail' USING ERRCODE = 'CR012';
  END IF;

  IF v_row.target_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'E-mail informado diverge do bootstrap pendente' USING ERRCODE = 'CR013';
  END IF;

  RETURN 'recovering';
END;
$$;
ALTER FUNCTION private.acquire_bootstrap_admin(text, text, boolean) OWNER TO postgres;

-- Ajuste defensivo 2.1 aplicado: auth.users.email IS NOT NULL + validacao de NULL e NOT FOUND
CREATE OR REPLACE FUNCTION private.complete_bootstrap_admin(
  p_user_id uuid,
  p_email text,
  p_nome text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_nome text;
  v_row public.sistema_bootstrap%ROWTYPE;
  v_auth_id uuid;
  v_confirmed_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_email IS NULL OR p_nome IS NULL THEN
    RAISE EXCEPTION 'p_user_id, p_email e p_nome nao podem ser nulos' USING ERRCODE = '22023';
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_nome := pg_catalog.btrim(p_nome);

  IF v_email = '' OR pg_catalog.char_length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Nome e e-mail validos sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Bootstrap exige isolamento read committed ou serializable' USING ERRCODE = '25001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clinica_recriar_admin_principal_lock')::bigint
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clinica_recriar_bootstrap_lock')::bigint
  );

  SELECT * INTO v_row FROM public.sistema_bootstrap WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR v_row.status IS DISTINCT FROM 'in_progress' OR v_row.target_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Estado de bootstrap invalido ou e-mail divergente' USING ERRCODE = 'CR013';
  END IF;

  IF EXISTS (SELECT 1 FROM public.usuarios_perfil WHERE is_admin_principal = true) THEN
    RAISE EXCEPTION 'Ja existe Administrador Principal cadastrado' USING ERRCODE = 'CR010';
  END IF;

  SELECT u.id, u.email_confirmed_at
  INTO v_auth_id, v_confirmed_at
  FROM auth.users u
  WHERE u.id = p_user_id
    AND u.email IS NOT NULL
    AND pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    AND u.deleted_at IS NULL;

  IF NOT FOUND OR v_auth_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id nao corresponde a um registro ativo com e-mail valido em auth.users'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.admin_principal_op_guard (xid, operacao, target_user_id)
  VALUES (pg_catalog.pg_current_xact_id(), 'bootstrap', p_user_id);

  INSERT INTO public.usuarios_perfil (
    id, nome, email, is_admin_principal, ativo, convite_solicitado_em, email_confirmado_em
  )
  VALUES (
    p_user_id, v_nome, v_email, true, true, pg_catalog.now(), v_confirmed_at
  );

  DELETE FROM private.admin_principal_op_guard WHERE xid = pg_catalog.pg_current_xact_id();

  UPDATE public.sistema_bootstrap
  SET status = 'completed',
      admin_inicial_id = p_user_id,
      inicializado_em = pg_catalog.now()
  WHERE singleton = true;

  PERFORM private.write_audit_log(
    'cli_bootstrap', NULL, 'cli_bootstrap', 'verificado_banco',
    'BOOTSTRAP_ADMIN_PRINCIPAL', 'usuarios_perfil', p_user_id::text, 'sucesso', NULL,
    '{"origem":"cli_local"}'::jsonb
  );
END;
$$;
ALTER FUNCTION private.complete_bootstrap_admin(uuid, text, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.promote_admin_principal(
  p_target_user_id uuid,
  p_declared_admin_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_target public.usuarios_perfil%ROWTYPE;
  v_meta jsonb;
BEGIN
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'p_target_user_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Transferencia exige isolamento read committed ou serializable' USING ERRCODE = '25001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clinica_recriar_admin_principal_lock')::bigint
  );

  IF p_declared_admin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios_perfil
      WHERE id = p_declared_admin_id AND is_admin_principal = true AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Operador CLI declarado nao e Administrador Principal ativo' USING ERRCODE = '42501';
    END IF;
    v_meta := pg_catalog.jsonb_build_object(
      'origem', 'cli_local',
      'comprovacao_operador', 'auth_cli_nao_verificado_pelo_db',
      'operador_cli_declarado_id', p_declared_admin_id::text
    );
  ELSE
    v_meta := pg_catalog.jsonb_build_object(
      'origem', 'cli_local',
      'comprovacao_operador', 'emergencia_db_sem_operador_auth'
    );
  END IF;

  SELECT * INTO v_target FROM public.usuarios_perfil WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND OR v_target.ativo IS DISTINCT FROM true OR v_target.is_admin_principal = true THEN
    RAISE EXCEPTION 'Alvo invalido, inativo ou ja e Administrador Principal' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.admin_principal_op_guard (xid, operacao, target_user_id)
  VALUES (pg_catalog.pg_current_xact_id(), 'promote', p_target_user_id);

  UPDATE public.usuarios_perfil SET is_admin_principal = true WHERE id = p_target_user_id;

  DELETE FROM private.admin_principal_op_guard WHERE xid = pg_catalog.pg_current_xact_id();

  PERFORM private.write_audit_log(
    'cli_operador_db', NULL, 'pg:' || session_user, 'verificado_banco',
    'ADMIN_PRINCIPAL_PROMOTED', 'usuarios_perfil', p_target_user_id::text, 'sucesso', NULL,
    v_meta
  );
END;
$$;
ALTER FUNCTION private.promote_admin_principal(uuid, uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.demote_admin_principal(
  p_target_user_id uuid,
  p_declared_admin_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_target public.usuarios_perfil%ROWTYPE;
  v_meta jsonb;
BEGIN
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'p_target_user_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Transferencia exige isolamento read committed ou serializable' USING ERRCODE = '25001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clinica_recriar_admin_principal_lock')::bigint
  );

  IF p_declared_admin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios_perfil
      WHERE id = p_declared_admin_id AND is_admin_principal = true AND ativo = true
    ) THEN
      RAISE EXCEPTION 'Operador CLI declarado nao e Administrador Principal ativo' USING ERRCODE = '42501';
    END IF;
    v_meta := pg_catalog.jsonb_build_object(
      'origem', 'cli_local',
      'comprovacao_operador', 'auth_cli_nao_verificado_pelo_db',
      'operador_cli_declarado_id', p_declared_admin_id::text
    );
  ELSE
    v_meta := pg_catalog.jsonb_build_object(
      'origem', 'cli_local',
      'comprovacao_operador', 'emergencia_db_sem_operador_auth'
    );
  END IF;

  SELECT * INTO v_target FROM public.usuarios_perfil WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND OR v_target.is_admin_principal IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Alvo nao e Administrador Principal' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.admin_principal_op_guard (xid, operacao, target_user_id)
  VALUES (pg_catalog.pg_current_xact_id(), 'demote', p_target_user_id);

  -- Trigger BEFORE UPDATE valida invariante >= 1 Admin Principal ativo (ERRCODE CR001)
  UPDATE public.usuarios_perfil SET is_admin_principal = false WHERE id = p_target_user_id;

  DELETE FROM private.admin_principal_op_guard WHERE xid = pg_catalog.pg_current_xact_id();

  PERFORM private.write_audit_log(
    'cli_operador_db', NULL, 'pg:' || session_user, 'verificado_banco',
    'ADMIN_PRINCIPAL_DEMOTED', 'usuarios_perfil', p_target_user_id::text, 'sucesso', NULL,
    v_meta
  );
END;
$$;
ALTER FUNCTION private.demote_admin_principal(uuid, uuid) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- F. RPCs autenticadas (public | SECURITY DEFINER | search_path = '') — 7 funcoes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_my_login()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perfil public.usuarios_perfil%ROWTYPE;
  v_auth_last_sign_in timestamptz;
  v_auth_confirmed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_perfil FROM public.usuarios_perfil WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_profile';
  END IF;

  IF v_perfil.ativo = false THEN
    PERFORM private.write_audit_log(
      'usuario', v_uid, NULL, 'reportado_aplicacao',
      'ACCESS_DENIED', 'auth', v_uid::text, 'negado', 'conta_desativada', '{}'::jsonb
    );
    RETURN 'inactive';
  END IF;

  SELECT u.last_sign_in_at, u.email_confirmed_at
  INTO v_auth_last_sign_in, v_auth_confirmed_at
  FROM auth.users u
  WHERE u.id = v_uid AND u.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'no_auth_user';
  END IF;

  IF v_auth_confirmed_at IS NOT NULL AND v_perfil.email_confirmado_em IS NULL THEN
    UPDATE public.usuarios_perfil
    SET email_confirmado_em = v_auth_confirmed_at
    WHERE id = v_uid;
  END IF;

  IF v_auth_last_sign_in IS NOT NULL
     AND (v_perfil.ultimo_acesso_auth_em IS NULL OR v_auth_last_sign_in > v_perfil.ultimo_acesso_auth_em) THEN
    UPDATE public.usuarios_perfil
    SET primeiro_acesso_observado_em = COALESCE(primeiro_acesso_observado_em, v_auth_last_sign_in),
        ultimo_acesso_auth_em = v_auth_last_sign_in,
        email_confirmado_em = COALESCE(email_confirmado_em, v_auth_confirmed_at)
    WHERE id = v_uid;

    PERFORM private.write_audit_log(
      'usuario', v_uid, NULL, 'correlacionado_auth',
      'AUTH_LOGIN_RECORDED', 'auth', v_uid::text, 'sucesso', NULL, '{}'::jsonb
    );
    RETURN 'recorded';
  END IF;

  RETURN 'already_recorded';
END;
$$;
ALTER FUNCTION public.rpc_record_my_login() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_report_initial_setup_completed()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perfil public.usuarios_perfil%ROWTYPE;
  v_auth_confirmed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_perfil FROM public.usuarios_perfil WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_perfil.ativo IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Perfil inexistente ou desativado' USING ERRCODE = '42501';
  END IF;

  SELECT u.email_confirmed_at INTO v_auth_confirmed_at
  FROM auth.users u
  WHERE u.id = v_uid AND u.deleted_at IS NULL;

  IF v_perfil.configuracao_inicial_reportada_em IS NOT NULL THEN
    RETURN 'already_reported';
  END IF;

  UPDATE public.usuarios_perfil
  SET configuracao_inicial_reportada_em = pg_catalog.now(),
      email_confirmado_em = COALESCE(email_confirmado_em, v_auth_confirmed_at)
  WHERE id = v_uid;

  PERFORM private.write_audit_log(
    'usuario', v_uid, NULL, 'reportado_aplicacao',
    'INITIAL_SETUP_REPORTED', 'auth', v_uid::text, 'sucesso', NULL, '{}'::jsonb
  );
  RETURN 'reported';
END;
$$;
ALTER FUNCTION public.rpc_report_initial_setup_completed() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_log_authenticated_event(
  p_acao text,
  p_recurso_entidade text,
  p_codigo_motivo text DEFAULT NULL,
  p_pagina integer DEFAULT NULL,
  p_limite integer DEFAULT NULL,
  p_filtro_acao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ativo boolean;
  v_meta jsonb := '{}'::jsonb;
  v_recurso_id text := NULL;
  v_resultado text := 'sucesso';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
  END IF;

  IF p_acao IS NULL OR p_recurso_entidade IS NULL THEN
    RAISE EXCEPTION 'p_acao e p_recurso_entidade sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT ativo INTO v_ativo FROM public.usuarios_perfil WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil administrativo nao encontrado' USING ERRCODE = '42501';
  END IF;

  CASE p_acao
    WHEN 'AUTH_LOGOUT_REPORTED' THEN
      v_recurso_id := v_uid::text;
    WHEN 'AUTH_PASSWORD_UPDATE_REPORTED' THEN
      IF v_ativo IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Conta desativada' USING ERRCODE = '42501';
      END IF;
      v_recurso_id := v_uid::text;
    WHEN 'AUDIT_LOG_VIEWED_REPORTED' THEN
      IF NOT private.has_permission('auditoria.read') THEN
        RAISE EXCEPTION 'Permissao auditoria.read obrigatoria' USING ERRCODE = '42501';
      END IF;
      IF p_pagina IS NULL OR p_limite IS NULL THEN
        RAISE EXCEPTION 'Parametros pagina e limite sao obrigatorios' USING ERRCODE = '22023';
      END IF;
      v_meta := pg_catalog.jsonb_build_object('pagina', p_pagina, 'limite', p_limite);
      IF p_filtro_acao IS NOT NULL THEN
        v_meta := v_meta || pg_catalog.jsonb_build_object('filtro_acao', p_filtro_acao);
      END IF;
    WHEN 'ACCESS_DENIED' THEN
      v_resultado := 'negado';
    ELSE
      RAISE EXCEPTION 'Acao nao permitida em rpc_log_authenticated_event' USING ERRCODE = '22023';
  END CASE;

  RETURN private.write_audit_log(
    'usuario', v_uid, NULL, 'reportado_aplicacao',
    p_acao, p_recurso_entidade, v_recurso_id, v_resultado, p_codigo_motivo, v_meta
  );
END;
$$;
ALTER FUNCTION public.rpc_log_authenticated_event(text, text, text, integer, integer, text) OWNER TO postgres;

-- Ajuste defensivo 2.1 aplicado: auth.users.email IS NOT NULL + validacao de NULL e NOT FOUND
CREATE OR REPLACE FUNCTION public.rpc_admin_create_invited_profile(
  p_user_id uuid,
  p_nome text,
  p_email text,
  p_convite_solicitado boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_email text;
  v_nome text;
  v_auth_id uuid;
  v_confirmed_at timestamptz;
  v_solicitado boolean := COALESCE(p_convite_solicitado, false);
BEGIN
  IF v_actor_id IS NULL OR NOT private.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'Permissao usuarios.manage obrigatoria' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_nome IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'p_user_id, p_nome e p_email nao podem ser nulos' USING ERRCODE = '22023';
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_nome := pg_catalog.btrim(p_nome);

  IF v_email = '' OR pg_catalog.char_length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Nome e e-mail validos sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT u.id, u.email_confirmed_at
  INTO v_auth_id, v_confirmed_at
  FROM auth.users u
  WHERE u.id = p_user_id
    AND u.email IS NOT NULL
    AND pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    AND u.deleted_at IS NULL;

  IF NOT FOUND OR v_auth_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao encontrado, inativo ou sem e-mail valido em auth.users'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.usuarios_perfil (
    id, nome, email, is_admin_principal, ativo, criado_por,
    convite_solicitado_em, email_confirmado_em
  )
  VALUES (
    p_user_id, v_nome, v_email, false, true, v_actor_id,
    CASE WHEN v_solicitado THEN pg_catalog.now() ELSE NULL END,
    v_confirmed_at
  );

  PERFORM private.write_audit_log(
    'usuario', v_actor_id, NULL, 'verificado_banco',
    'USER_PROFILE_CREATED', 'usuarios_perfil', p_user_id::text, 'sucesso', NULL,
    pg_catalog.jsonb_build_object('convite_solicitado', v_solicitado)
  );

  RETURN p_user_id;
END;
$$;
ALTER FUNCTION public.rpc_admin_create_invited_profile(uuid, text, text, boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_admin_mark_access_link_requested(
  p_target_user_id uuid,
  p_fluxo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_target public.usuarios_perfil%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT private.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'Permissao usuarios.manage obrigatoria' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL OR p_fluxo IS NULL OR p_fluxo NOT IN ('convite', 'definicao_senha') THEN
    RAISE EXCEPTION 'Parametros de link de acesso invalidos' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.usuarios_perfil WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND OR v_target.ativo IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Usuario alvo inexistente ou inativo' USING ERRCODE = '22023';
  END IF;

  IF v_target.primeiro_acesso_observado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Usuario ja concluiu primeiro acesso observado; use recuperacao de senha'
      USING ERRCODE = 'CR020';
  END IF;

  UPDATE public.usuarios_perfil
  SET convite_solicitado_em = pg_catalog.now()
  WHERE id = p_target_user_id;

  PERFORM private.write_audit_log(
    'usuario', v_actor_id, NULL, 'reportado_aplicacao',
    'USER_ACCESS_LINK_REQUESTED', 'usuarios_perfil', p_target_user_id::text, 'sucesso', NULL,
    pg_catalog.jsonb_build_object('fluxo', p_fluxo)
  );
END;
$$;
ALTER FUNCTION public.rpc_admin_mark_access_link_requested(uuid, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_admin_set_user_active(
  p_target_user_id uuid,
  p_ativo boolean
)
RETURNS TABLE (resultado text, outbox_job_id uuid, nova_versao bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_target public.usuarios_perfil%ROWTYPE;
  v_nova_versao bigint;
  v_job_id uuid;
  v_op text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Operacao administrativa exige isolamento read committed ou serializable'
      USING ERRCODE = '25001';
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sessao autenticada obrigatoria' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL OR p_ativo IS NULL THEN
    RAISE EXCEPTION 'p_target_user_id e p_ativo sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Usuario nao pode alterar o proprio estado de ativacao' USING ERRCODE = '42501';
  END IF;

  -- NIVEL 1: advisory lock global ANTES de qualquer leitura/lock de linha
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('clinica_recriar_admin_principal_lock')::bigint
  );

  -- NIVEL 2: bloqueio deterministico de ator e alvo em ORDER BY id
  PERFORM 1
  FROM public.usuarios_perfil
  WHERE id IN (v_actor_id, p_target_user_id)
  ORDER BY id
  FOR UPDATE;

  -- Revalidacao de autorizacao APOS locks
  IF NOT private.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'Permissao usuarios.manage obrigatoria ou ator desativado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM public.usuarios_perfil WHERE id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario alvo nao encontrado' USING ERRCODE = '22023';
  END IF;

  IF v_target.is_admin_principal = true AND NOT private.is_active_admin_principal() THEN
    RAISE EXCEPTION 'Apenas Administrador Principal ativo pode alterar estado de outro Administrador Principal'
      USING ERRCODE = '42501';
  END IF;

  IF v_target.ativo = p_ativo THEN
    RETURN QUERY SELECT 'no_change'::text, NULL::uuid, v_target.estado_ativacao_versao;
    RETURN;
  END IF;

  UPDATE public.usuarios_perfil
  SET ativo = p_ativo,
      estado_ativacao_versao = estado_ativacao_versao + 1,
      desativado_em = CASE WHEN p_ativo = false THEN pg_catalog.now() ELSE NULL END,
      desativado_por = CASE WHEN p_ativo = false THEN v_actor_id ELSE NULL END
  WHERE id = p_target_user_id
  RETURNING estado_ativacao_versao INTO v_nova_versao;

  -- NIVEL 3: atualizacao e insercao em private.auth_sync_outbox
  UPDATE private.auth_sync_outbox
  SET status = 'superseded',
      concluido_em = pg_catalog.now(),
      claim_token = NULL,
      lease_expires_at = NULL
  WHERE target_user_id = p_target_user_id
    AND status = 'pending';

  v_op := CASE WHEN p_ativo = false THEN 'ban_user' ELSE 'unban' END;

  INSERT INTO private.auth_sync_outbox (
    target_user_id, target_versao, operacao, origem, criado_por
  )
  VALUES (
    p_target_user_id, v_nova_versao, v_op, 'status_change', v_actor_id
  )
  RETURNING id INTO v_job_id;

  PERFORM private.write_audit_log(
    'usuario', v_actor_id, NULL, 'verificado_banco',
    CASE WHEN p_ativo = false THEN 'USER_DEACTIVATED' ELSE 'USER_REACTIVATED' END,
    'usuarios_perfil', p_target_user_id::text, 'sucesso', NULL,
    pg_catalog.jsonb_build_object('outbox_enqueued', true, 'versao', v_nova_versao)
  );

  RETURN QUERY SELECT
    CASE WHEN p_ativo = false THEN 'deactivated'::text ELSE 'reactivated'::text END,
    v_job_id,
    v_nova_versao;
END;
$$;
ALTER FUNCTION public.rpc_admin_set_user_active(uuid, boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_admin_retry_auth_sync(p_target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_target public.usuarios_perfil%ROWTYPE;
  v_op text;
  v_job_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT private.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'Permissao usuarios.manage obrigatoria' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'p_target_user_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM public.usuarios_perfil WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario alvo nao encontrado' USING ERRCODE = '22023';
  END IF;

  v_op := CASE WHEN v_target.ativo = false THEN 'ban_user' ELSE 'unban' END;

  INSERT INTO private.auth_sync_outbox (
    target_user_id, target_versao, operacao, origem, criado_por
  )
  VALUES (
    v_target.id, v_target.estado_ativacao_versao, v_op, 'manual_retry', v_actor_id
  )
  ON CONFLICT (target_user_id, target_versao) WHERE status IN ('pending', 'processing')
  DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Ja existe sincronizacao ativa ou pendente para a versao vigente deste usuario'
      USING ERRCODE = 'CR021';
  END IF;

  PERFORM private.write_audit_log(
    'usuario', v_actor_id, NULL, 'verificado_banco',
    'AUTH_SYNC_MANUAL_RETRY_REQUESTED', 'auth_sync_outbox', v_job_id::text, 'sucesso', NULL,
    pg_catalog.jsonb_build_object('operacao', v_op, 'versao', v_target.estado_ativacao_versao)
  );

  RETURN v_job_id;
END;
$$;
ALTER FUNCTION public.rpc_admin_retry_auth_sync(uuid) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- G. RPCs de sistema, Outbox e Reconciliacao (service_role APENAS) — 6 funcoes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_log_system_audit_event(
  p_acao text,
  p_recurso_entidade text,
  p_resultado text DEFAULT 'negado',
  p_codigo_motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_acao IS NULL OR p_acao NOT IN ('AUTH_LOGIN_FAILED', 'AUTH_PASSWORD_RESET_REQUEST', 'ACCESS_DENIED') THEN
    RAISE EXCEPTION 'Acao de sistema nao permitida' USING ERRCODE = '22023';
  END IF;

  IF p_recurso_entidade IS NULL OR p_resultado IS NULL THEN
    RAISE EXCEPTION 'p_recurso_entidade e p_resultado sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  RETURN private.write_audit_log(
    'sistema', NULL, 'nextjs_server', 'reportado_aplicacao',
    p_acao, p_recurso_entidade, NULL, p_resultado, p_codigo_motivo, '{}'::jsonb
  );
END;
$$;
ALTER FUNCTION public.rpc_log_system_audit_event(text, text, text, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_claim_auth_sync_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  job_id uuid,
  claim_token uuid,
  target_user_id uuid,
  target_versao bigint,
  operacao text,
  origem text,
  tentativas integer,
  max_tentativas integer,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_lease integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 60), 300);
BEGIN
  IF p_worker_id IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_worker_id)) < 3 THEN
    RAISE EXCEPTION 'p_worker_id obrigatorio' USING ERRCODE = '22023';
  END IF;

  PERFORM private.sweep_expired_auth_sync_jobs();

  UPDATE private.auth_sync_outbox o
  SET status = 'superseded',
      concluido_em = pg_catalog.now(),
      claim_token = NULL,
      lease_expires_at = NULL
  FROM public.usuarios_perfil up
  WHERE o.target_user_id = up.id
    AND o.status = 'pending'
    AND o.target_versao < up.estado_ativacao_versao;

  RETURN QUERY
  WITH candidatos AS (
    SELECT o.id
    FROM private.auth_sync_outbox o
    JOIN public.usuarios_perfil up ON up.id = o.target_user_id
    WHERE o.target_versao = up.estado_ativacao_versao
      AND o.tentativas < o.max_tentativas
      AND (
        (o.status = 'pending' AND o.proxima_tentativa_em <= pg_catalog.now())
        OR (o.status = 'processing' AND o.lease_expires_at <= pg_catalog.now())
      )
    ORDER BY o.criado_em ASC
    LIMIT v_limit
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE private.auth_sync_outbox o
  SET status = 'processing',
      claim_token = pg_catalog.gen_random_uuid(),
      lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => v_lease),
      tentativas = o.tentativas + 1,
      claimed_at = pg_catalog.now(),
      claimed_by = pg_catalog.btrim(p_worker_id)
  FROM candidatos c
  WHERE o.id = c.id
  RETURNING
    o.id, o.claim_token, o.target_user_id, o.target_versao,
    o.operacao, o.origem, o.tentativas, o.max_tentativas, o.lease_expires_at;
END;
$$;
ALTER FUNCTION public.rpc_claim_auth_sync_jobs(text, integer, integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_verify_auth_sync_job(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job private.auth_sync_outbox%ROWTYPE;
  v_versao_atual bigint;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL THEN
    RETURN 'claim_invalid';
  END IF;

  SELECT * INTO v_job
  FROM private.auth_sync_outbox
  WHERE id = p_job_id
    AND status = 'processing'
    AND claim_token = p_claim_token
    AND lease_expires_at > pg_catalog.now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'claim_invalid';
  END IF;

  SELECT estado_ativacao_versao INTO v_versao_atual
  FROM public.usuarios_perfil
  WHERE id = v_job.target_user_id;

  IF v_job.target_versao < v_versao_atual THEN
    UPDATE private.auth_sync_outbox
    SET status = 'superseded',
        concluido_em = pg_catalog.now(),
        claim_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_id;
    RETURN 'abort_stale';
  END IF;

  RETURN 'valid';
END;
$$;
ALTER FUNCTION public.rpc_verify_auth_sync_job(uuid, uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_complete_auth_sync_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_sucesso boolean,
  p_erro_codigo text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user_id uuid;
  v_perfil public.usuarios_perfil%ROWTYPE;
  v_job private.auth_sync_outbox%ROWTYPE;
  v_op_vigente text;
  v_novo_status text;
  v_erro_final text;
  v_backoff_min integer;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL OR p_sucesso IS NULL THEN
    RAISE EXCEPTION 'p_job_id, p_claim_token e p_sucesso sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  SELECT target_user_id INTO v_target_user_id
  FROM private.auth_sync_outbox
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job de outbox inexistente' USING ERRCODE = '22023';
  END IF;

  -- NIVEL 2: usuarios_perfil primeiro
  SELECT * INTO v_perfil
  FROM public.usuarios_perfil
  WHERE id = v_target_user_id
  FOR UPDATE;

  -- NIVEL 3: auth_sync_outbox depois
  SELECT * INTO v_job
  FROM private.auth_sync_outbox
  WHERE id = p_job_id
  FOR UPDATE;

  v_op_vigente := CASE WHEN v_perfil.ativo = false THEN 'ban_user' ELSE 'unban' END;

  -- CASO 1: Claim expirado ou substituido por outro worker
  IF v_job.status <> 'processing' OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    INSERT INTO private.auth_sync_outbox (
      target_user_id, target_versao, operacao, origem, criado_por
    )
    VALUES (
      v_perfil.id, v_perfil.estado_ativacao_versao, v_op_vigente, 'stale_claim_recovery', NULL
    )
    ON CONFLICT (target_user_id, target_versao) WHERE status IN ('pending', 'processing')
    DO NOTHING;

    PERFORM private.write_audit_log(
      'sistema', NULL, 'auth_sync_worker', 'verificado_banco',
      'AUTH_SYNC_STALE_CLAIM_DETECTED', 'auth_sync_outbox', p_job_id::text,
      'negado', 'claim_expirado_reconciliacao_enfileirada',
      pg_catalog.jsonb_build_object('operacao', v_job.operacao, 'tentativas', GREATEST(v_job.tentativas, 1))
    );
    RETURN 'stale_claim_reconcile_enqueued';
  END IF;

  -- CASO 2: Versao do usuario avancou durante a chamada HTTP
  IF v_job.target_versao < v_perfil.estado_ativacao_versao THEN
    UPDATE private.auth_sync_outbox
    SET status = 'stale_after_external_call',
        concluido_em = pg_catalog.now(),
        claim_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_id;

    INSERT INTO private.auth_sync_outbox (
      target_user_id, target_versao, operacao, origem, criado_por
    )
    VALUES (
      v_perfil.id, v_perfil.estado_ativacao_versao, v_op_vigente, 'stale_claim_recovery', NULL
    )
    ON CONFLICT (target_user_id, target_versao) WHERE status IN ('pending', 'processing')
    DO NOTHING;

    PERFORM private.write_audit_log(
      'sistema', NULL, 'auth_sync_worker', 'verificado_banco',
      'AUTH_SYNC_STALE_RECONCILE_ENQUEUED', 'auth_sync_outbox', p_job_id::text, 'sucesso', NULL,
      pg_catalog.jsonb_build_object('operacao', v_job.operacao, 'tentativas', v_job.tentativas)
    );
    RETURN 'stale_reconcile_enqueued';
  END IF;

  -- CASO 3: Sucesso reportado na versao vigente
  IF p_sucesso THEN
    UPDATE private.auth_sync_outbox
    SET status = 'succeeded',
        ultimo_erro_codigo = NULL,
        concluido_em = pg_catalog.now(),
        claim_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_id;

    IF v_job.origem = 'drift_reconciler' THEN
      PERFORM private.write_audit_log(
        'sistema', NULL, 'auth_sync_worker', 'reportado_aplicacao',
        'AUTH_DRIFT_CORRECTION_REPORTED', 'usuarios_perfil', v_perfil.id::text, 'sucesso', NULL,
        pg_catalog.jsonb_build_object('ativo_esperado', v_perfil.ativo, 'versao', v_perfil.estado_ativacao_versao)
      );
    END IF;
    RETURN 'succeeded';
  END IF;

  -- CASO 4: Falha reportada -> backoff exponencial ou failed_permanent
  IF v_job.tentativas >= v_job.max_tentativas THEN
    v_novo_status := 'failed_permanent';
    v_erro_final := COALESCE(p_erro_codigo, 'max_tentativas_excedido');
  ELSE
    v_novo_status := 'pending';
    v_erro_final := COALESCE(p_erro_codigo, 'auth_5xx');
  END IF;

  v_backoff_min := pg_catalog.power(2, LEAST(v_job.tentativas, 6))::integer;

  UPDATE private.auth_sync_outbox
  SET status = v_novo_status,
      ultimo_erro_codigo = v_erro_final,
      claim_token = NULL,
      lease_expires_at = NULL,
      proxima_tentativa_em = CASE
        WHEN v_novo_status = 'pending' THEN pg_catalog.now() + pg_catalog.make_interval(mins => v_backoff_min)
        ELSE proxima_tentativa_em
      END,
      concluido_em = CASE WHEN v_novo_status = 'failed_permanent' THEN pg_catalog.now() ELSE NULL END
  WHERE id = p_job_id;

  PERFORM private.write_audit_log(
    'sistema', NULL, 'auth_sync_worker', 'reportado_aplicacao',
    'AUTH_SYNC_FAILURE_REPORTED', 'auth_sync_outbox', p_job_id::text, 'erro', v_erro_final,
    pg_catalog.jsonb_build_object('operacao', v_job.operacao, 'tentativas', v_job.tentativas)
  );

  RETURN v_novo_status;
END;
$$;
ALTER FUNCTION public.rpc_complete_auth_sync_job(uuid, uuid, boolean, text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_list_users_for_auth_reconcile(
  p_grace_seconds integer DEFAULT 60,
  p_limit integer DEFAULT 100,
  p_after_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  ativo boolean,
  estado_ativacao_versao bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grace integer := GREATEST(COALESCE(p_grace_seconds, 60), 15);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  PERFORM private.sweep_expired_auth_sync_jobs();

  RETURN QUERY
  SELECT up.id, up.ativo, up.estado_ativacao_versao
  FROM public.usuarios_perfil up
  WHERE (p_after_id IS NULL OR up.id > p_after_id)
    AND NOT EXISTS (
      SELECT 1
      FROM private.auth_sync_outbox o
      WHERE o.target_user_id = up.id
        AND o.target_versao = up.estado_ativacao_versao
        AND (
          o.status IN ('pending', 'processing', 'failed_permanent')
          OR (
            o.status = 'succeeded'
            AND o.concluido_em IS NOT NULL
            AND o.concluido_em > pg_catalog.now() - pg_catalog.make_interval(secs => v_grace)
          )
        )
    )
  ORDER BY up.id ASC
  LIMIT v_limit;
END;
$$;
ALTER FUNCTION public.rpc_list_users_for_auth_reconcile(integer, integer, uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rpc_report_auth_drift_and_enqueue(
  p_target_user_id uuid,
  p_expected_versao bigint,
  p_auth_currently_banned boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_perfil public.usuarios_perfil%ROWTYPE;
  v_divergente boolean;
  v_op text;
  v_job_id uuid;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_versao IS NULL OR p_auth_currently_banned IS NULL THEN
    RAISE EXCEPTION 'Parametros de drift nao podem ser nulos' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_perfil
  FROM public.usuarios_perfil
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_perfil.estado_ativacao_versao <> p_expected_versao THEN
    RETURN 'version_changed_skip';
  END IF;

  v_divergente := (v_perfil.ativo = true AND p_auth_currently_banned = true)
               OR (v_perfil.ativo = false AND p_auth_currently_banned = false);

  IF NOT v_divergente THEN
    RETURN 'in_sync';
  END IF;

  v_op := CASE WHEN v_perfil.ativo = false THEN 'ban_user' ELSE 'unban' END;

  INSERT INTO private.auth_sync_outbox (
    target_user_id, target_versao, operacao, origem, criado_por
  )
  VALUES (
    v_perfil.id, v_perfil.estado_ativacao_versao, v_op, 'drift_reconciler', NULL
  )
  ON CONFLICT (target_user_id, target_versao) WHERE status IN ('pending', 'processing')
  DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    RETURN 'already_enqueued';
  END IF;

  PERFORM private.write_audit_log(
    'sistema', NULL, 'auth_reconciler', 'reportado_aplicacao',
    'AUTH_DRIFT_REPORTED', 'usuarios_perfil', v_perfil.id::text,
    'erro', 'estado_auth_divergente',
    pg_catalog.jsonb_build_object('ativo_esperado', v_perfil.ativo, 'versao', v_perfil.estado_ativacao_versao)
  );

  RETURN 'drift_enqueued';
END;
$$;
ALTER FUNCTION public.rpc_report_auth_drift_and_enqueue(uuid, bigint, boolean) OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- H. Blindagem intermediaria antes da Migracao 3 (zero EXECUTE para runtime)
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  private.is_active_admin_principal(),
  private.is_user_admin_principal(uuid),
  private.has_permission(text),
  private.is_delegable_permission(text),
  private.validate_audit_row(public.audit_logs),
  private.write_audit_log(text, uuid, text, text, text, text, text, text, text, jsonb),
  private.sweep_expired_auth_sync_jobs(),
  private.trg_audit_logs_block_mutation(),
  private.trg_audit_logs_validate_insert(),
  private.trg_usuarios_perfil_before_insert(),
  private.trg_usuarios_perfil_before_update(),
  private.trg_usuarios_perfil_after_update_nome_audit(),
  private.trg_usuario_permissoes_before_insert(),
  private.trg_usuario_permissoes_after_change_audit(),
  private.trg_sistema_bootstrap_guard(),
  private.acquire_bootstrap_admin(text, text, boolean),
  private.complete_bootstrap_admin(uuid, text, text),
  private.promote_admin_principal(uuid, uuid),
  private.demote_admin_principal(uuid, uuid),
  public.rpc_record_my_login(),
  public.rpc_report_initial_setup_completed(),
  public.rpc_log_authenticated_event(text, text, text, integer, integer, text),
  public.rpc_admin_create_invited_profile(uuid, text, text, boolean),
  public.rpc_admin_mark_access_link_requested(uuid, text),
  public.rpc_admin_set_user_active(uuid, boolean),
  public.rpc_admin_retry_auth_sync(uuid),
  public.rpc_log_system_audit_event(text, text, text, text),
  public.rpc_claim_auth_sync_jobs(text, integer, integer),
  public.rpc_verify_auth_sync_job(uuid, uuid),
  public.rpc_complete_auth_sync_job(uuid, uuid, boolean, text),
  public.rpc_list_users_for_auth_reconcile(integer, integer, uuid),
  public.rpc_report_auth_drift_and_enqueue(uuid, bigint, boolean)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;