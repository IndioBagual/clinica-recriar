import type { NextApiRequest, NextApiResponse } from 'next';
import { createAdminServiceClient } from '@/lib/supabase/adminServiceClient';
import { createUserServerClient } from '@/lib/supabase/userServerClient';
import type { Phase2Permission } from './schemas';

export interface AdminProfileRow {
  id: string;
  nome: string;
  email: string;
  is_admin_principal: boolean;
  ativo: boolean;
  estado_ativacao_versao: number;
  convite_solicitado_em: string | null;
  email_confirmado_em: string | null;
  configuracao_inicial_reportada_em: string | null;
  primeiro_acesso_observado_em: string | null;
  ultimo_acesso_auth_em: string | null;
  desativado_em: string | null;
  criado_em: string;
}

export interface AuthenticatedAdminContext {
  supabase: ReturnType<typeof createUserServerClient>;
  userId: string;
  authEmail: string | null;
  profile: AdminProfileRow;
  permissions: Phase2Permission[];
}

export async function logSystemAuditSafe(
  acao: 'AUTH_LOGIN_FAILED' | 'AUTH_PASSWORD_RESET_REQUEST' | 'ACCESS_DENIED',
  recursoEntidade: 'auth' | 'usuarios_perfil' | 'usuario_permissoes' | 'audit_logs' | 'gestao',
  resultado: 'sucesso' | 'negado',
  codigoMotivo: string | null
): Promise<void> {
  try {
    const admin = createAdminServiceClient();
    await admin.rpc('rpc_log_system_audit_event', {
      p_acao: acao,
      p_recurso_entidade: recursoEntidade,
      p_resultado: resultado,
      p_codigo_motivo: codigoMotivo,
    });
  } catch {
    // Nunca vaza detalhes de erro de auditoria para o cliente
  }
}

export async function requireApiAuth(
  req: NextApiRequest,
  res: NextApiResponse,
  options?: {
    permission?: Phase2Permission;
    requireAdminPrincipal?: boolean;
    resource?: 'auth' | 'usuarios_perfil' | 'usuario_permissoes' | 'audit_logs' | 'gestao';
  }
): Promise<AuthenticatedAdminContext | null> {
  const resource = options?.resource ?? 'gestao';
  const supabase = createUserServerClient(req, res);

  // Valida identidade autenticada diretamente com o servidor Auth (NAO usa getSession)
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    await logSystemAuditSafe('ACCESS_DENIED', resource, 'negado', 'sem_sessao');
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Sessão autenticada obrigatória.' },
    });
    return null;
  }

  const userId = userData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from('usuarios_perfil')
    .select(
      'id, nome, email, is_admin_principal, ativo, estado_ativacao_versao, convite_solicitado_em, email_confirmado_em, configuracao_inicial_reportada_em, primeiro_acesso_observado_em, ultimo_acesso_auth_em, desativado_em, criado_em'
    )
    .eq('id', userId)
    .maybeSingle<AdminProfileRow>();

  // Como RLS de usuarios_perfil exige (id = auth.uid() AND ativo = true),
  // conta inativa ou sem perfil retorna null para o proprio usuario.
  if (profileError || !profile || !profile.ativo) {
    await logSystemAuditSafe('ACCESS_DENIED', resource, 'negado', 'conta_desativada');
    res.status(403).json({
      error: { code: 'ACCOUNT_INACTIVE_OR_NO_PROFILE', message: 'Conta sem permissão ativa de acesso.' },
    });
    return null;
  }

  const { data: permRows, error: permError } = await supabase
    .from('usuario_permissoes')
    .select('permissao')
    .eq('usuario_id', userId);

  if (permError) {
    res.status(500).json({
      error: { code: 'AUTHORIZATION_CHECK_FAILED', message: 'Falha ao validar permissões.' },
    });
    return null;
  }

  const permissions: Phase2Permission[] = profile.is_admin_principal
    ? ['usuarios.manage', 'auditoria.read']
    : (permRows ?? [])
        .map((r) => r.permissao)
        .filter((p): p is Phase2Permission => p === 'usuarios.manage' || p === 'auditoria.read');

  if (options?.requireAdminPrincipal && !profile.is_admin_principal) {
    await supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: resource,
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Operação restrita ao Administrador Principal.' },
    });
    return null;
  }

  if (options?.permission && !permissions.includes(options.permission)) {
    await supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: resource,
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Permissão insuficiente para esta operação.' },
    });
    return null;
  }

  return {
    supabase,
    userId,
    authEmail: userData.user.email ?? null,
    profile,
    permissions,
  };
}