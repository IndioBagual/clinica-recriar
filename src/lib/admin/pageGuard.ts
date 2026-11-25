import type { GetServerSidePropsContext, Redirect } from 'next';
import { deriveAccountLifecycleStatus } from './accountLifecycle';
import type { AdminProfileRow } from './auth';
import type { AdminViewer } from './navigation';
import type { Phase2Permission } from './schemas';
import { applyNoStoreHeaders, sanitizeInternalRedirect } from '@/lib/security/http';
import { createUserServerClient } from '@/lib/supabase/userServerClient';

export type AdminPageGuardResult =
  | { status: 'redirect'; redirect: Redirect }
  | { status: 'forbidden'; viewer: AdminViewer; requiredPermission: Phase2Permission }
  | {
      status: 'authorized';
      viewer: AdminViewer;
      supabase: ReturnType<typeof createUserServerClient>;
    };

function hasSupabaseSessionCookie(cookies: Partial<Record<string, string>> | undefined): boolean {
  if (!cookies) return false;
  return Object.keys(cookies).some((name) => name.startsWith('sb-'));
}

function buildLoginRedirect(nextPath: string, motivo?: string): Redirect {
  const safeNext = sanitizeInternalRedirect(nextPath, '/gestao');
  const params = new URLSearchParams();
  if (motivo) params.set('motivo', motivo);
  if (safeNext !== '/gestao') params.set('next', safeNext);
  const qs = params.toString();
  return {
    destination: qs ? `/gestao/login?${qs}` : '/gestao/login',
    permanent: false,
  };
}

/**
 * Guard SSR obrigatorio para todas as paginas privadas sob /gestao.
 * - Aplica Cache-Control: no-store, private e X-Robots-Tag: noindex, nofollow.
 * - Valida sessao diretamente no servidor Auth via getUser() preservando Set-Cookie.
 * - Consulta perfil ativo e permissoes estritamente via RLS (nunca usa service_role).
 * - Nunca serializa tokens, segredos ou cookies nas props da pagina.
 */
export async function requireAdminPageAuth(
  ctx: Pick<GetServerSidePropsContext, 'req' | 'res' | 'resolvedUrl'>,
  options?: {
    requiredPermission?: Phase2Permission;
    createClient?: typeof createUserServerClient;
  }
): Promise<AdminPageGuardResult> {
  applyNoStoreHeaders(ctx.res);

  const clientFactory = options?.createClient ?? createUserServerClient;
  const supabase = clientFactory(ctx.req, ctx.res);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    const expired = hasSupabaseSessionCookie(ctx.req.cookies);
    return {
      status: 'redirect',
      redirect: buildLoginRedirect(ctx.resolvedUrl || '/gestao', expired ? 'sessao_expirada' : undefined),
    };
  }

  const userId = userData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from('usuarios_perfil')
    .select(
      'id, nome, email, is_admin_principal, ativo, estado_ativacao_versao, convite_solicitado_em, email_confirmado_em, configuracao_inicial_reportada_em, primeiro_acesso_observado_em, ultimo_acesso_auth_em, desativado_em, criado_em'
    )
    .eq('id', userId)
    .maybeSingle<AdminProfileRow>();

  // RLS exige (id = auth.uid() AND ativo = true): conta desativada ou sem perfil retorna null
  if (profileError || !profile || !profile.ativo) {
    return {
      status: 'redirect',
      redirect: buildLoginRedirect('/gestao', 'acesso_indisponivel'),
    };
  }

  const { data: permRows, error: permError } = await supabase
    .from('usuario_permissoes')
    .select('permissao')
    .eq('usuario_id', userId);

  if (permError) {
    return {
      status: 'redirect',
      redirect: buildLoginRedirect('/gestao', 'acesso_indisponivel'),
    };
  }

  const permissions: Phase2Permission[] = profile.is_admin_principal
    ? ['usuarios.manage', 'auditoria.read']
    : (permRows ?? [])
        .map((r) => r.permissao)
        .filter((p): p is Phase2Permission => p === 'usuarios.manage' || p === 'auditoria.read');

  const viewer: AdminViewer = {
    id: profile.id,
    nome: profile.nome,
    email: profile.email,
    isAdminPrincipal: profile.is_admin_principal,
    permissions,
    lifecycleStatus: deriveAccountLifecycleStatus(profile),
    conviteSolicitadoEm: profile.convite_solicitado_em,
    emailConfirmadoEm: profile.email_confirmado_em,
    configuracaoInicialReportadaEm: profile.configuracao_inicial_reportada_em,
    primeiroAcessoObservadoEm: profile.primeiro_acesso_observado_em,
    ultimoAcessoAuthEm: profile.ultimo_acesso_auth_em,
    criadoEm: profile.criado_em,
  };

  if (options?.requiredPermission && !viewer.permissions.includes(options.requiredPermission)) {
    ctx.res.statusCode = 403;
    return {
      status: 'forbidden',
      viewer,
      requiredPermission: options.requiredPermission,
    };
  }

  return {
    status: 'authorized',
    viewer,
    supabase,
  };
}

/**
 * Para /gestao/login: se ja houver sessao valida com perfil ativo, redireciona para destino seguro.
 */
export async function redirectIfAuthenticatedAdmin(
  ctx: Pick<GetServerSidePropsContext, 'req' | 'res' | 'query'>,
  options?: { createClient?: typeof createUserServerClient }
): Promise<Redirect | null> {
  applyNoStoreHeaders(ctx.res);

  const clientFactory = options?.createClient ?? createUserServerClient;
  const supabase = clientFactory(ctx.req, ctx.res);

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user?.id) return null;

  const { data: profile } = await supabase
    .from('usuarios_perfil')
    .select('id, ativo')
    .eq('id', userData.user.id)
    .maybeSingle<{ id: string; ativo: boolean }>();

  if (!profile || !profile.ativo) return null;

  const rawNext = Array.isArray(ctx.query.next) ? ctx.query.next[0] : ctx.query.next;
  return {
    destination: sanitizeInternalRedirect(rawNext, '/gestao'),
    permanent: false,
  };
}