import type { GetServerSidePropsContext } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canEditUserName,
  canManageUserPermissions,
  canToggleUserStatus,
  getAuthorizedNavigation,
} from '@/lib/admin/navigation';
import { requireAdminPageAuth } from '@/lib/admin/pageGuard';
import {
  createPasswordFlowCookieValue,
  verifyPasswordFlowCookie,
} from '@/lib/security/passwordFlow';
import { inspectAuthHashFragment } from '@/pages/gestao/atualizar-senha';

function createMockSsrContext(overrides?: {
  resolvedUrl?: string;
  cookies?: Record<string, string>;
}) {
  const headers: Record<string, string | string[]> = {};
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
  };
  const req = {
    headers: { 'x-forwarded-proto': 'https' },
    cookies: overrides?.cookies ?? {},
  };
  return {
    ctx: {
      req,
      res,
      resolvedUrl: overrides?.resolvedUrl ?? '/gestao',
    } as unknown as Pick<GetServerSidePropsContext, 'req' | 'res' | 'resolvedUrl'>,
    getHeaders: () => headers,
    getStatusCode: () => res.statusCode,
  };
}

function makeFakeSupabase(options: {
  userId?: string | null;
  profile?: Record<string, unknown> | null;
  permissions?: string[];
  emitRefreshCookie?: boolean;
}) {
  return (req: unknown, res: { setHeader: (k: string, v: string[]) => void }) => {
    void req;
    if (options.emitRefreshCookie) {
      res.setHeader('Set-Cookie', ['sb-refresh=rotated; Path=/; HttpOnly; Secure; SameSite=Lax']);
    }
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: options.userId ? { id: options.userId, email: 'u@clinica.local' } : null },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'usuarios_perfil') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: options.profile ?? null, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: async () => ({
              data: (options.permissions ?? []).map((permissao) => ({ permissao })),
              error: null,
            }),
          }),
        };
      }),
    };
  };
}

const BASE_PROFILE = {
  id: '11111111-1111-4111-8111-111111111111',
  nome: 'Perfil Teste',
  email: 'perfil@clinica.local',
  is_admin_principal: false,
  ativo: true,
  estado_ativacao_versao: 1,
  convite_solicitado_em: null,
  email_confirmado_em: '2026-11-25T10:00:00Z',
  configuracao_inicial_reportada_em: null,
  primeiro_acesso_observado_em: '2026-11-25T10:05:00Z',
  ultimo_acesso_auth_em: '2026-11-25T10:05:00Z',
  desativado_em: null,
  criado_em: '2026-11-25T09:00:00Z',
};

describe('Etapa 7/8B — Guards SSR, matriz de navegacao, cache privado e fluxo token_hash', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('[1 & 18] redireciona visitante sem sessao e aplica headers no-store/noindex/no-referrer', async () => {
    const { ctx, getHeaders } = createMockSsrContext({ resolvedUrl: '/gestao/usuarios' });
    const res = await requireAdminPageAuth(ctx, {
      requiredPermission: 'usuarios.manage',
      createClient: makeFakeSupabase({ userId: null }) as never,
    });

    expect(res.status).toBe('redirect');
    if (res.status === 'redirect') {
      expect(res.redirect.destination).toBe('/gestao/login?next=%2Fgestao%2Fusuarios');
    }
    expect(getHeaders()['cache-control']).toContain('no-store');
    expect(getHeaders()['x-robots-tag']).toContain('noindex');
    expect(getHeaders()['referrer-policy']).toBe('no-referrer');
  });

  it('[9] redireciona sessao expirada com motivo=sessao_expirada quando havia cookie sb-*', async () => {
    const { ctx } = createMockSsrContext({
      resolvedUrl: '/gestao/auditoria',
      cookies: { 'sb-projeto-auth-token': 'expirado' },
    });
    const res = await requireAdminPageAuth(ctx, {
      requiredPermission: 'auditoria.read',
      createClient: makeFakeSupabase({ userId: null }) as never,
    });

    expect(res.status).toBe('redirect');
    if (res.status === 'redirect') {
      expect(res.redirect.destination).toBe(
        '/gestao/login?motivo=sessao_expirada&next=%2Fgestao%2Fauditoria'
      );
    }
  });

  it('[2 & 3] bloqueia usuario desativado e usuario sem perfil administrativo', async () => {
    const m1 = createMockSsrContext();
    const inactive = await requireAdminPageAuth(m1.ctx, {
      createClient: makeFakeSupabase({
        userId: BASE_PROFILE.id,
        profile: { ...BASE_PROFILE, ativo: false },
      }) as never,
    });
    expect(inactive.status).toBe('redirect');
    if (inactive.status === 'redirect') {
      expect(inactive.redirect.destination).toBe('/gestao/login?motivo=acesso_indisponivel');
    }

    const m2 = createMockSsrContext();
    const noProfile = await requireAdminPageAuth(m2.ctx, {
      createClient: makeFakeSupabase({ userId: BASE_PROFILE.id, profile: null }) as never,
    });
    expect(noProfile.status).toBe('redirect');
    if (noProfile.status === 'redirect') {
      expect(noProfile.redirect.destination).toBe('/gestao/login?motivo=acesso_indisponivel');
    }
  });

  it('[4, 5, 6 & 7] constroi navegacao coerente para Admin Principal, gestor, auditor e usuario sem permissoes', () => {
    const adminNav = getAuthorizedNavigation({ isAdminPrincipal: true, permissions: [] }).map((i) => i.href);
    expect(adminNav).toEqual(['/gestao', '/gestao/usuarios', '/gestao/auditoria', '/gestao/minha-conta']);

    const gestorNav = getAuthorizedNavigation({
      isAdminPrincipal: false,
      permissions: ['usuarios.manage'],
    }).map((i) => i.href);
    expect(gestorNav).toEqual(['/gestao', '/gestao/usuarios', '/gestao/minha-conta']);

    const auditorNav = getAuthorizedNavigation({
      isAdminPrincipal: false,
      permissions: ['auditoria.read'],
    }).map((i) => i.href);
    expect(auditorNav).toEqual(['/gestao', '/gestao/auditoria', '/gestao/minha-conta']);

    const basicNav = getAuthorizedNavigation({ isAdminPrincipal: false, permissions: [] }).map((i) => i.href);
    expect(basicNav).toEqual(['/gestao', '/gestao/minha-conta']);
  });

  it('[8] retorna 403 forbidden no acesso direto a pagina sem permissao e preserva Set-Cookie de refresh', async () => {
    const { ctx, getStatusCode, getHeaders } = createMockSsrContext({
      resolvedUrl: '/gestao/auditoria',
    });
    const res = await requireAdminPageAuth(ctx, {
      requiredPermission: 'auditoria.read',
      createClient: makeFakeSupabase({
        userId: BASE_PROFILE.id,
        profile: BASE_PROFILE,
        permissions: ['usuarios.manage'],
        emitRefreshCookie: true,
      }) as never,
    });

    expect(res.status).toBe('forbidden');
    expect(getStatusCode()).toBe(403);
    expect(getHeaders()['set-cookie']).toBeDefined();
    expect(getHeaders()['cache-control']).toContain('no-store');
  });

  it('[14] preserva protecao do Admin Principal e bloqueia auto-alteracao nos controles de UI', () => {
    const adminViewer = { id: 'a1', isAdminPrincipal: true, permissions: ['usuarios.manage', 'auditoria.read'] as const };
    const gestorViewer = { id: 'g1', isAdminPrincipal: false, permissions: ['usuarios.manage'] as const };

    expect(canToggleUserStatus({ ...adminViewer, permissions: [...adminViewer.permissions] }, { id: 'a1', is_admin_principal: true })).toBe(false);
    expect(canToggleUserStatus({ ...gestorViewer, permissions: [...gestorViewer.permissions] }, { id: 'a1', is_admin_principal: true })).toBe(false);
    expect(canEditUserName({ ...gestorViewer, permissions: [...gestorViewer.permissions] }, { is_admin_principal: true })).toBe(false);
    expect(canManageUserPermissions(gestorViewer, { id: 'u2', is_admin_principal: false })).toBe(false);
    expect(canManageUserPermissions(adminViewer, { id: 'a2', is_admin_principal: true })).toBe(false);
    expect(canManageUserPermissions(adminViewer, { id: 'u2', is_admin_principal: false })).toBe(true);
  });

  it('[15] rejeita fragmentos com tokens, identifica erro otp_expired e valida cookie assinado de fluxo', () => {
    expect(inspectAuthHashFragment('#access_token=abc&refresh_token=def&type=invite')).toEqual({
      hasUnexpectedTokens: true,
      errorCode: null,
    });
    expect(inspectAuthHashFragment('#error=access_denied&error_code=otp_expired')).toEqual({
      hasUnexpectedTokens: false,
      errorCode: 'otp_expired',
    });

    process.env.SUPABASE_SECRET_KEY = 'sb_secret_unit_test_signing_key_only';
    const nowSec = Math.floor(Date.now() / 1000);
    const cookieVal = createPasswordFlowCookieValue(BASE_PROFILE.id, 'recovery', nowSec);

    const ok = verifyPasswordFlowCookie(
      { headers: { 'x-forwarded-proto': 'https' }, cookies: { '__Host-recriar_pwd_flow': cookieVal } },
      BASE_PROFILE.id,
      nowSec + 60
    );
    expect(ok).toEqual({ ok: true, flow: 'recovery', iat: nowSec });

    const wrongUser = verifyPasswordFlowCookie(
      { headers: { 'x-forwarded-proto': 'https' }, cookies: { '__Host-recriar_pwd_flow': cookieVal } },
      '99999999-9999-4999-8999-999999999999',
      nowSec + 60
    );
    expect(wrongUser).toEqual({ ok: false, reason: 'user_mismatch' });

    const tampered = verifyPasswordFlowCookie(
      { headers: { 'x-forwarded-proto': 'https' }, cookies: { '__Host-recriar_pwd_flow': cookieVal + 'x' } },
      BASE_PROFILE.id,
      nowSec + 60
    );
    expect(tampered).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});