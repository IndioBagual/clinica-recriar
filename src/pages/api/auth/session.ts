import type { NextApiRequest, NextApiResponse } from 'next';
import { deriveAccountLifecycleStatus } from '@/lib/admin/accountLifecycle';
import { type AdminProfileRow } from '@/lib/admin/auth';
import type { Phase2Permission } from '@/lib/admin/schemas';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';
import { createUserServerClient } from '@/lib/supabase/userServerClient';

/**
 * GET somente leitura: valida sessao no servidor Auth (getUser) e carrega perfil/permissoes via RLS.
 * Nunca executa mutacoes em GET.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET'])) return;

  const supabase = createUserServerClient(req, res);
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData?.user?.id) {
    res.status(200).json({ authenticated: false });
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('usuarios_perfil')
    .select(
      'id, nome, email, is_admin_principal, ativo, estado_ativacao_versao, convite_solicitado_em, email_confirmado_em, configuracao_inicial_reportada_em, primeiro_acesso_observado_em, ultimo_acesso_auth_em, desativado_em, criado_em'
    )
    .eq('id', userData.user.id)
    .maybeSingle<AdminProfileRow>();

  if (profileError || !profile || !profile.ativo) {
    res.status(200).json({ authenticated: false, reason: 'inactive_or_no_profile' });
    return;
  }

  const { data: permRows } = await supabase
    .from('usuario_permissoes')
    .select('permissao')
    .eq('usuario_id', profile.id);

  const permissions: Phase2Permission[] = profile.is_admin_principal
    ? ['usuarios.manage', 'auditoria.read']
    : (permRows ?? [])
        .map((r) => r.permissao)
        .filter((p): p is Phase2Permission => p === 'usuarios.manage' || p === 'auditoria.read');

  res.status(200).json({
    authenticated: true,
    user: {
      id: profile.id,
      nome: profile.nome,
      email: profile.email,
      isAdminPrincipal: profile.is_admin_principal,
      ativo: profile.ativo,
      permissions,
      lifecycleStatus: deriveAccountLifecycleStatus(profile),
      conviteSolicitadoEm: profile.convite_solicitado_em,
      emailConfirmadoEm: profile.email_confirmado_em,
      configuracaoInicialReportadaEm: profile.configuracao_inicial_reportada_em,
      primeiroAcessoObservadoEm: profile.primeiro_acesso_observado_em,
      ultimoAcessoAuthEm: profile.ultimo_acesso_auth_em,
    },
  });
}