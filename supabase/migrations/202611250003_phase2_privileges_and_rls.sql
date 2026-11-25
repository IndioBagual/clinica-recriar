-- ============================================================================
-- FASE 2 (Migracao 3/3): REVOKE completo, GRANT minimo por assinatura/coluna
-- e politicas RLS (RESTRICTIVE + PERMISSIVE)
-- ============================================================================

BEGIN;

-- 1. Schema private: USAGE apenas para authenticated (avaliacao de helpers RLS)
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

-- 2. REVOKE ALL PRIVILEGES (inclui MAINTAIN no PG17) nas 6 tabelas
REVOKE ALL PRIVILEGES ON TABLE
  public.usuarios_perfil,
  public.usuario_permissoes,
  public.audit_logs,
  public.sistema_bootstrap,
  private.admin_principal_op_guard,
  private.auth_sync_outbox
FROM PUBLIC, anon, authenticated, service_role;

-- 3. GRANTs minimos de tabela e coluna (ZERO concessoes em tabela para PUBLIC, anon e service_role)
GRANT SELECT ON TABLE public.usuarios_perfil TO authenticated;
GRANT UPDATE (nome) ON TABLE public.usuarios_perfil TO authenticated;

GRANT SELECT ON TABLE public.usuario_permissoes TO authenticated;
GRANT INSERT (usuario_id, permissao) ON TABLE public.usuario_permissoes TO authenticated;
GRANT DELETE ON TABLE public.usuario_permissoes TO authenticated;

GRANT SELECT ON TABLE public.audit_logs TO authenticated;

-- 4. REVOKE ALL explicito nas 32 funcoes antes dos GRANTs nominais
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

-- 5. GRANT EXECUTE nominal por assinatura e papel
GRANT EXECUTE ON FUNCTION
  private.is_active_admin_principal(),
  private.is_user_admin_principal(uuid),
  private.has_permission(text),
  private.is_delegable_permission(text)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.rpc_record_my_login(),
  public.rpc_report_initial_setup_completed(),
  public.rpc_log_authenticated_event(text, text, text, integer, integer, text),
  public.rpc_admin_create_invited_profile(uuid, text, text, boolean),
  public.rpc_admin_mark_access_link_requested(uuid, text),
  public.rpc_admin_set_user_active(uuid, boolean),
  public.rpc_admin_retry_auth_sync(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.rpc_log_system_audit_event(text, text, text, text),
  public.rpc_claim_auth_sync_jobs(text, integer, integer),
  public.rpc_verify_auth_sync_job(uuid, uuid),
  public.rpc_complete_auth_sync_job(uuid, uuid, boolean, text),
  public.rpc_list_users_for_auth_reconcile(integer, integer, uuid),
  public.rpc_report_auth_drift_and_enqueue(uuid, bigint, boolean)
TO service_role;

-- 6. RLS habilitada nas 6 tabelas
ALTER TABLE public.usuarios_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sistema_bootstrap ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.admin_principal_op_guard ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auth_sync_outbox ENABLE ROW LEVEL SECURITY;

-- 7. Politicas RLS — public.usuarios_perfil
CREATE POLICY usuarios_perfil_select
  ON public.usuarios_perfil
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (id = auth.uid() AND ativo = true)
    OR private.has_permission('usuarios.manage')
  );

CREATE POLICY usuarios_perfil_update_nome
  ON public.usuarios_perfil
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    private.is_active_admin_principal()
    OR (private.has_permission('usuarios.manage') AND is_admin_principal = false)
  )
  WITH CHECK (
    private.is_active_admin_principal()
    OR (private.has_permission('usuarios.manage') AND is_admin_principal = false)
  );

-- 8. Politicas RLS — public.usuario_permissoes (RESTRICTIVE + PERMISSIVE)
CREATE POLICY usuario_permissoes_select
  ON public.usuario_permissoes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (
      usuario_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.usuarios_perfil up
        WHERE up.id = auth.uid() AND up.ativo = true
      )
    )
    OR private.has_permission('usuarios.manage')
  );

CREATE POLICY usuario_permissoes_restrict_insert
  ON public.usuario_permissoes
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    usuario_id <> auth.uid()
    AND concedida_por = auth.uid()
    AND NOT private.is_user_admin_principal(usuario_id)
  );

CREATE POLICY usuario_permissoes_restrict_delete
  ON public.usuario_permissoes
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    usuario_id <> auth.uid()
    AND NOT private.is_user_admin_principal(usuario_id)
  );

CREATE POLICY usuario_permissoes_insert
  ON public.usuario_permissoes
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    private.is_active_admin_principal()
    OR (private.has_permission('usuarios.manage') AND private.is_delegable_permission(permissao))
  );

CREATE POLICY usuario_permissoes_delete
  ON public.usuario_permissoes
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    private.is_active_admin_principal()
    OR (private.has_permission('usuarios.manage') AND private.is_delegable_permission(permissao))
  );

-- 9. Politicas RLS — public.audit_logs
CREATE POLICY audit_logs_select
  ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (private.has_permission('auditoria.read'));

COMMIT;