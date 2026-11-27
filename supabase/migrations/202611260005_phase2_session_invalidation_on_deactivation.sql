-- ============================================================================
-- FASE 2 (Migracao 5/5): Invalidacao definitiva de acesso administrativo de
-- sessoes anteriores a desativacao/reativacao via marco monotonico, trigger
-- diferido no COMMIT e validacao de session_id em auth.sessions (fail-closed).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Marco monotonico persistente em public.usuarios_perfil
-- ----------------------------------------------------------------------------
ALTER TABLE public.usuarios_perfil
  ADD COLUMN IF NOT EXISTS sessoes_invalidas_antes_de timestamptz NULL;

-- ----------------------------------------------------------------------------
-- 2. Helper autoritativo de validacao da sessao atual (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_current_session_valid()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_claims jsonb;
  v_sid_text text;
  v_sid uuid;
  v_ativo boolean;
  v_min_created_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_claims := auth.jwt();
  IF v_claims IS NULL THEN
    RETURN false;
  END IF;

  v_sid_text := v_claims ->> 'session_id';
  IF v_sid_text IS NULL
     OR v_sid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_sid := v_sid_text::uuid;

  SELECT up.ativo, up.sessoes_invalidas_antes_de
  INTO v_ativo, v_min_created_at
  FROM public.usuarios_perfil up
  WHERE up.id = v_uid;

  IF NOT FOUND OR v_ativo IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_sid
      AND s.user_id = v_uid
      AND (s.not_after IS NULL OR s.not_after > pg_catalog.now())
      AND s.created_at IS NOT NULL
      AND (
        v_min_created_at IS NULL
        OR s.created_at > v_min_created_at
      )
  );
END;
$$;
ALTER FUNCTION private.is_current_session_valid() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.is_current_session_valid()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_current_session_valid()
  TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Atualizacao dos helpers RLS existentes (preservando ACLs da Migracao 3)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_active_admin_principal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_current_session_valid()
    AND EXISTS (
      SELECT 1
      FROM public.usuarios_perfil
      WHERE id = auth.uid()
        AND ativo = true
        AND is_admin_principal = true
    );
$$;
ALTER FUNCTION private.is_active_admin_principal() OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.has_permission(p_chave text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_chave IS NOT NULL
    AND private.is_current_session_valid()
    AND EXISTS (
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

-- ----------------------------------------------------------------------------
-- 4. Trigger BEFORE UPDATE + CONSTRAINT TRIGGER DEFERRED no COMMIT
--    - Bloqueia alteracao direta de sessoes_invalidas_antes_de por authenticated
--    - Garante monotonicidade estrita (nunca retrocede nem volta a NULL)
--    - Avanca o marco no UPDATE e lineariza novamente no momento do COMMIT
-- ----------------------------------------------------------------------------
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
       OR NEW.sessoes_invalidas_antes_de IS DISTINCT FROM OLD.sessoes_invalidas_antes_de
       OR NEW.convite_solicitado_em IS DISTINCT FROM OLD.convite_solicitado_em
       OR NEW.email_confirmado_em IS DISTINCT FROM OLD.email_confirmado_em
       OR NEW.configuracao_inicial_reportada_em IS DISTINCT FROM OLD.configuracao_inicial_reportada_em
       OR NEW.primeiro_acesso_observado_em IS DISTINCT FROM OLD.primeiro_acesso_observado_em
       OR NEW.ultimo_acesso_auth_em IS DISTINCT FROM OLD.ultimo_acesso_auth_em THEN
      RAISE EXCEPTION 'Alteracao direta de coluna sensivel nao permitida para authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.sessoes_invalidas_antes_de IS NOT NULL
     AND (
       NEW.sessoes_invalidas_antes_de IS NULL
       OR NEW.sessoes_invalidas_antes_de < OLD.sessoes_invalidas_antes_de
     ) THEN
    RAISE EXCEPTION 'sessoes_invalidas_antes_de e um marco monotonico e nao pode retroceder'
      USING ERRCODE = '42501';
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

  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    NEW.sessoes_invalidas_antes_de := GREATEST(
      COALESCE(OLD.sessoes_invalidas_antes_de, '-infinity'::timestamptz),
      COALESCE(NEW.sessoes_invalidas_antes_de, '-infinity'::timestamptz),
      pg_catalog.clock_timestamp()
    );
  END IF;

  NEW.atualizado_em := pg_catalog.now();
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.trg_usuarios_perfil_before_update() OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.trg_usuarios_perfil_after_ativo_commit_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Executado no COMMIT (DEFERRABLE INITIALLY DEFERRED): lineariza o marco de
  -- invalidacao imediatamente antes de a mudanca de estado tornar-se visivel.
  -- Nao altera a coluna 'ativo', evitando recursao no trigger AFTER UPDATE OF ativo.
  UPDATE public.usuarios_perfil
  SET sessoes_invalidas_antes_de = GREATEST(
        COALESCE(sessoes_invalidas_antes_de, '-infinity'::timestamptz),
        pg_catalog.clock_timestamp()
      )
  WHERE id = NEW.id;
  RETURN NULL;
END;
$$;
ALTER FUNCTION private.trg_usuarios_perfil_after_ativo_commit_stamp() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.trg_usuarios_perfil_after_ativo_commit_stamp()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_usuarios_perfil_stamp_sessions_on_commit ON public.usuarios_perfil;
CREATE CONSTRAINT TRIGGER trg_usuarios_perfil_stamp_sessions_on_commit
  AFTER UPDATE OF ativo ON public.usuarios_perfil
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.ativo IS DISTINCT FROM NEW.ativo)
  EXECUTE FUNCTION private.trg_usuarios_perfil_after_ativo_commit_stamp();

-- Backfill delimitado apenas a contas atualmente desativadas (nao invalida retroativamente
-- sessoes de contas que ja foram reativadas antes da aplicacao desta migracao).
UPDATE public.usuarios_perfil
SET sessoes_invalidas_antes_de = COALESCE(desativado_em, pg_catalog.clock_timestamp())
WHERE ativo = false
  AND sessoes_invalidas_antes_de IS NULL;

-- ----------------------------------------------------------------------------
-- 5. Politicas RLS com ramo self-select direto
-- ----------------------------------------------------------------------------
DROP POLICY usuarios_perfil_select ON public.usuarios_perfil;
CREATE POLICY usuarios_perfil_select
  ON public.usuarios_perfil
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (id = auth.uid() AND private.is_current_session_valid())
    OR private.has_permission('usuarios.manage')
  );

DROP POLICY usuario_permissoes_select ON public.usuario_permissoes;
CREATE POLICY usuario_permissoes_select
  ON public.usuario_permissoes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (usuario_id = auth.uid() AND private.is_current_session_valid())
    OR private.has_permission('usuarios.manage')
  );

-- ----------------------------------------------------------------------------
-- 6. RPCs SECURITY DEFINER autenticadas que consultam perfil diretamente
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

  IF NOT private.is_current_session_valid() THEN
    RAISE EXCEPTION 'Sessao administrativa invalida ou revogada' USING ERRCODE = '42501';
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
  IF v_uid IS NULL OR NOT private.is_current_session_valid() THEN
    RAISE EXCEPTION 'Sessao administrativa invalida ou revogada' USING ERRCODE = '42501';
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
  IF v_uid IS NULL OR NOT private.is_current_session_valid() THEN
    RAISE EXCEPTION 'Sessao administrativa invalida ou revogada' USING ERRCODE = '42501';
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

  -- Revalidacao de autorizacao e sessao APOS locks
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
      desativado_por = CASE WHEN p_ativo = false THEN v_actor_id ELSE NULL END,
      sessoes_invalidas_antes_de = GREATEST(
        COALESCE(sessoes_invalidas_antes_de, '-infinity'::timestamptz),
        pg_catalog.clock_timestamp()
      )
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

COMMIT;
