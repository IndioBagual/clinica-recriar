-- ============================================================================
-- FASE 2 (Migracao 1/3): Schemas, default privileges globais/schema, 6 tabelas,
-- constraints, indices e postura deny-by-default (REVOKE ALL + RLS sem policies)
-- Papel confirmado na Etapa 2: current_user = postgres / session_user = postgres
-- ============================================================================

BEGIN;

-- 1. Schema privado (NAO exposto no PostgREST)
CREATE SCHEMA IF NOT EXISTS private;
ALTER SCHEMA private OWNER TO postgres;

-- 2. Bloqueio de CREATE em public e acesso total em private para papeis de runtime
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- 3. Default privileges GLOBAIS (sem IN SCHEMA) para objetos futuros criados por postgres
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;

-- 4. Default privileges POR SCHEMA (neutraliza defaults pre-existentes em public e blinda private)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;

-- 5. Tabela 1/6: public.usuarios_perfil
CREATE TABLE public.usuarios_perfil (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  nome text NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(nome)) BETWEEN 2 AND 160),
  email text NOT NULL UNIQUE CHECK (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    AND pg_catalog.char_length(email) <= 254
  ),
  is_admin_principal boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  estado_ativacao_versao bigint NOT NULL DEFAULT 1 CHECK (estado_ativacao_versao >= 1),
  desativado_em timestamptz,
  desativado_por uuid REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  convite_solicitado_em timestamptz,
  email_confirmado_em timestamptz,
  configuracao_inicial_reportada_em timestamptz,
  primeiro_acesso_observado_em timestamptz,
  ultimo_acesso_auth_em timestamptz,
  criado_por uuid REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  atualizado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT chk_usuarios_perfil_desativacao_coerente CHECK (
    (ativo = true AND desativado_em IS NULL AND desativado_por IS NULL)
    OR (ativo = false AND desativado_em IS NOT NULL)
  ),
  CONSTRAINT chk_usuarios_perfil_acessos_coerentes CHECK (
    ultimo_acesso_auth_em IS NULL
    OR (primeiro_acesso_observado_em IS NOT NULL AND ultimo_acesso_auth_em >= primeiro_acesso_observado_em)
  )
);
ALTER TABLE public.usuarios_perfil OWNER TO postgres;

CREATE INDEX idx_usuarios_perfil_ativo_admin
  ON public.usuarios_perfil (ativo, is_admin_principal);

CREATE INDEX idx_usuarios_perfil_criado_em
  ON public.usuarios_perfil (criado_em DESC);

-- 6. Tabela 2/6: public.usuario_permissoes (escopo exclusivo Fase 2)
CREATE TABLE public.usuario_permissoes (
  usuario_id uuid NOT NULL REFERENCES public.usuarios_perfil(id) ON DELETE CASCADE,
  permissao text NOT NULL,
  concedida_por uuid NOT NULL DEFAULT auth.uid() REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  concedida_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (usuario_id, permissao),
  CONSTRAINT chk_usuario_permissoes_catalogo_fase2 CHECK (
    permissao IN ('usuarios.manage', 'auditoria.read')
  )
);
ALTER TABLE public.usuario_permissoes OWNER TO postgres;

CREATE INDEX idx_usuario_permissoes_permissao
  ON public.usuario_permissoes (permissao);

-- 7. Tabela 3/6: public.audit_logs (append-only)
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  ator_tipo text NOT NULL CHECK (
    ator_tipo IN ('usuario', 'sistema', 'cli_operador_db', 'cli_bootstrap')
  ),
  usuario_id uuid REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  ator_sistema text CHECK (
    ator_sistema IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(ator_sistema)) BETWEEN 2 AND 64
  ),
  confiabilidade text NOT NULL CHECK (
    confiabilidade IN ('verificado_banco', 'correlacionado_auth', 'reportado_aplicacao')
  ),
  acao text NOT NULL CHECK (
    acao IN (
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
    )
  ),
  recurso_entidade text NOT NULL CHECK (
    pg_catalog.char_length(pg_catalog.btrim(recurso_entidade)) BETWEEN 2 AND 64
  ),
  recurso_id text CHECK (
    recurso_id IS NULL OR pg_catalog.char_length(recurso_id) <= 128
  ),
  resultado text NOT NULL CHECK (resultado IN ('sucesso', 'negado', 'erro')),
  codigo_motivo text CHECK (
    codigo_motivo IS NULL OR pg_catalog.char_length(codigo_motivo) <= 64
  ),
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(metadados) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT chk_audit_logs_ator_coerente CHECK (
    (ator_tipo = 'usuario' AND usuario_id IS NOT NULL AND ator_sistema IS NULL)
    OR (ator_tipo = 'sistema' AND usuario_id IS NULL AND ator_sistema IS NOT NULL)
    OR (ator_tipo = 'cli_operador_db' AND usuario_id IS NULL AND ator_sistema IS NOT NULL)
    OR (ator_tipo = 'cli_bootstrap' AND usuario_id IS NULL AND ator_sistema = 'cli_bootstrap')
  )
);
ALTER TABLE public.audit_logs OWNER TO postgres;

CREATE INDEX idx_audit_logs_criado_em
  ON public.audit_logs (criado_em DESC);

CREATE INDEX idx_audit_logs_usuario_criado_em
  ON public.audit_logs (usuario_id, criado_em DESC)
  WHERE usuario_id IS NOT NULL;

CREATE INDEX idx_audit_logs_acao_criado_em
  ON public.audit_logs (acao, criado_em DESC);

-- 8. Tabela 4/6: public.sistema_bootstrap
CREATE TABLE public.sistema_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  target_email text NOT NULL CHECK (
    target_email = pg_catalog.lower(pg_catalog.btrim(target_email))
    AND pg_catalog.char_length(target_email) <= 254
  ),
  admin_inicial_id uuid REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  iniciado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  inicializado_em timestamptz,
  CONSTRAINT chk_sistema_bootstrap_estado_coerente CHECK (
    (status = 'in_progress' AND admin_inicial_id IS NULL AND inicializado_em IS NULL)
    OR (status = 'completed' AND admin_inicial_id IS NOT NULL AND inicializado_em IS NOT NULL)
  )
);
ALTER TABLE public.sistema_bootstrap OWNER TO postgres;

-- 9. Tabela 5/6: private.admin_principal_op_guard
CREATE TABLE private.admin_principal_op_guard (
  xid xid8 PRIMARY KEY,
  operacao text NOT NULL CHECK (operacao IN ('bootstrap', 'promote', 'demote')),
  target_user_id uuid NOT NULL
);
ALTER TABLE private.admin_principal_op_guard OWNER TO postgres;

-- 10. Tabela 6/6: private.auth_sync_outbox
CREATE TABLE private.auth_sync_outbox (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  target_versao bigint NOT NULL CHECK (target_versao >= 1),
  operacao text NOT NULL CHECK (operacao IN ('ban_user', 'unban')),
  origem text NOT NULL DEFAULT 'status_change' CHECK (
    origem IN ('status_change', 'stale_claim_recovery', 'drift_reconciler', 'manual_retry')
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'processing',
      'succeeded',
      'superseded',
      'expired_stale',
      'stale_after_external_call',
      'failed_permanent'
    )
  ),
  claim_token uuid,
  lease_expires_at timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  max_tentativas integer NOT NULL DEFAULT 5 CHECK (max_tentativas BETWEEN 1 AND 20),
  proxima_tentativa_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  claimed_at timestamptz,
  claimed_by text CHECK (claimed_by IS NULL OR pg_catalog.char_length(claimed_by) <= 64),
  ultimo_erro_codigo text CHECK (
    ultimo_erro_codigo IS NULL
    OR ultimo_erro_codigo IN (
      'auth_timeout',
      'auth_5xx',
      'auth_4xx',
      'lease_expirado_max_tentativas',
      'max_tentativas_excedido'
    )
  ),
  criado_por uuid REFERENCES public.usuarios_perfil(id) ON DELETE RESTRICT,
  criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  concluido_em timestamptz,
  CONSTRAINT chk_auth_sync_outbox_tentativas_limite CHECK (tentativas <= max_tentativas),
  CONSTRAINT chk_auth_sync_outbox_lease_coerente CHECK (
    (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
  )
);
ALTER TABLE private.auth_sync_outbox OWNER TO postgres;

CREATE UNIQUE INDEX uq_auth_sync_outbox_active_user_version
  ON private.auth_sync_outbox (target_user_id, target_versao)
  WHERE status IN ('pending', 'processing');

CREATE INDEX idx_auth_sync_outbox_claimable
  ON private.auth_sync_outbox (status, proxima_tentativa_em, lease_expires_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX idx_auth_sync_outbox_target
  ON private.auth_sync_outbox (target_user_id, target_versao DESC, criado_em DESC);

-- 11. Postura deny-by-default explicita no intervalo entre Etapas 3 e 4:
--     ZERO privilegios para PUBLIC/anon/authenticated/service_role + RLS habilitada sem policies
REVOKE ALL PRIVILEGES ON TABLE
  public.usuarios_perfil,
  public.usuario_permissoes,
  public.audit_logs,
  public.sistema_bootstrap,
  private.admin_principal_op_guard,
  private.auth_sync_outbox
FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.usuarios_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sistema_bootstrap ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.admin_principal_op_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auth_sync_outbox ENABLE ROW LEVEL SECURITY;

COMMIT;