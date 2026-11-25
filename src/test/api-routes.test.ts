import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasswordFlowCookieValue } from '@/lib/security/passwordFlow';
import { resetDevRateLimitStore } from '@/lib/security/rateLimit';

const mockUserClient = {
  auth: {
    getUser: vi.fn(),
    getClaims: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

const mockEphemeralClient = {
  auth: {
    resetPasswordForEmail: vi.fn(),
    signInWithPassword: vi.fn(),
  },
};

const mockAdminClient = {
  auth: {
    admin: {
      inviteUserByEmail: vi.fn(),
      updateUserById: vi.fn(),
      listUsers: vi.fn(),
      getUserById: vi.fn(),
    },
  },
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase/userServerClient', () => ({
  createUserServerClient: () => mockUserClient,
  createEphemeralPublicAuthClient: () => mockEphemeralClient,
}));

vi.mock('@/lib/supabase/adminServiceClient', () => ({
  createAdminServiceClient: () => mockAdminClient,
}));

import loginHandler from '@/pages/api/auth/login';
import sessionHandler from '@/pages/api/auth/session';
import definirSenhaInicialHandler from '@/pages/api/auth/definir-senha-inicial';
import usuariosHandler from '@/pages/api/admin/usuarios/index';
import falhasSyncUsuariosHandler from '@/pages/api/admin/usuarios/falhas-sync';
import statusHandler from '@/pages/api/admin/usuarios/[id]/status';
import reenviarHandler from '@/pages/api/admin/usuarios/[id]/reenviar-acesso';
import permissoesHandler from '@/pages/api/admin/usuarios/[id]/permissoes';
import retrySyncHandler from '@/pages/api/admin/usuarios/[id]/retry-auth-sync';
import falhasSyncAuditHandler from '@/pages/api/admin/auth-sync/falhas';
import auditoriaHandler from '@/pages/api/admin/auditoria';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'c'.repeat(64);

function createReqRes(overrides: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const resHeaders: Record<string, string | string[]> = {};
  let statusCode = 200;
  let jsonBody: unknown = null;

  const req = {
    method: overrides.method ?? 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'x-csrf-token': CSRF_TOKEN,
      ...(overrides.headers ?? {}),
    },
    cookies: {
      recriar_csrf_dev: CSRF_TOKEN,
      ...(overrides.cookies ?? {}),
    },
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;

  const res = {
    setHeader(name: string, value: string | string[]) {
      resHeaders[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return resHeaders[name.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      jsonBody = payload;
      return res;
    },
  } as unknown as NextApiResponse;

  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody, getHeaders: () => resHeaders };
}

function setupAuthenticatedAdmin(
  isAdminPrincipal = true,
  permissions: string[] = ['usuarios.manage'],
  primeiroAcessoObservadoEm: string | null = '2026-11-25T10:05:00Z'
) {
  mockUserClient.auth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_ID, email: 'admin@clinica.local' } },
    error: null,
  });

  mockUserClient.from.mockImplementation((table: string) => {
    if (table === 'usuarios_perfil') {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              if (val === ADMIN_ID) {
                return {
                  data: {
                    id: ADMIN_ID,
                    nome: 'Admin Teste',
                    email: 'admin@clinica.local',
                    is_admin_principal: isAdminPrincipal,
                    ativo: true,
                    estado_ativacao_versao: 1,
                    convite_solicitado_em: null,
                    email_confirmado_em: '2026-11-25T10:00:00Z',
                    configuracao_inicial_reportada_em: null,
                    primeiro_acesso_observado_em: primeiroAcessoObservadoEm,
                    ultimo_acesso_auth_em: primeiroAcessoObservadoEm,
                    desativado_em: null,
                    criado_em: '2026-11-25T09:00:00Z',
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
          }),
        }),
      };
    }
    if (table === 'usuario_permissoes') {
      return {
        select: () => ({
          eq: async () => ({
            data: permissions.map((permissao) => ({ permissao })),
            error: null,
          }),
        }),
      };
    }
    if (table === 'audit_logs') {
      return {
        select: () => ({
          in: () => ({
            order: () => ({
              range: async () => ({
                data: [
                  {
                    id: '33333333-3333-4333-8333-333333333333',
                    acao: 'AUTH_SYNC_FAILURE_REPORTED',
                    codigo_motivo: 'max_tentativas_excedido',
                  },
                ],
                count: 1,
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    return {};
  });
}

describe('integracao controlada das API Routes (Etapas 5, 6 e 8B.2)', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetDevRateLimitStore();
    process.env.RATE_LIMIT_ALLOW_DEV_MEMORY = 'true';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_unit_test_signing_key_only';
    mockAdminClient.rpc.mockResolvedValue({ data: null, error: null });
    mockAdminClient.auth.admin.updateUserById.mockResolvedValue({ data: {}, error: null });
    mockUserClient.rpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('bloqueia chamada direta a /api/auth/login sem CSRF/Origin, metodo invalido e Content-Type invalido', async () => {
    const m1 = createReqRes({ method: 'GET' });
    await loginHandler(m1.req, m1.res);
    expect(m1.getStatus()).toBe(405);
    expect(m1.getHeaders()['cache-control']).toContain('no-store');
    expect(m1.getHeaders()['referrer-policy']).toBe('no-referrer');

    const m2 = createReqRes({ headers: { 'content-type': 'text/plain' } });
    await loginHandler(m2.req, m2.res);
    expect(m2.getStatus()).toBe(415);

    const m3 = createReqRes({ headers: { origin: 'https://atacante.test' } });
    await loginHandler(m3.req, m3.res);
    expect(m3.getStatus()).toBe(403);
  });

  it('GET /api/auth/session retorna authenticated=false sem sessao e nao muta estado', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const m = createReqRes({ method: 'GET' });
    await sessionHandler(m.req, m.res);
    expect(m.getStatus()).toBe(200);
    expect(m.getBody()).toEqual({ authenticated: false });
  });

  it('POST /api/admin/usuarios/[id]/status bloqueia auto-desativacao e retorna 409 CR001 para ultimo admin', async () => {
    setupAuthenticatedAdmin(true);

    const selfReq = createReqRes({ query: { id: ADMIN_ID }, body: { ativo: false } });
    await statusHandler(selfReq.req, selfReq.res);
    expect(selfReq.getStatus()).toBe(403);

    mockUserClient.rpc.mockResolvedValueOnce({ data: null, error: { code: 'CR001', message: 'ultimo admin' } });
    const lastAdminReq = createReqRes({ query: { id: TARGET_ID }, body: { ativo: false } });
    await statusHandler(lastAdminReq.req, lastAdminReq.res);
    expect(lastAdminReq.getStatus()).toBe(409);
  });

  it('[7.1 NEGATIVO] POST /api/admin/usuarios bloqueia vinculacao de conta preexistente sem procedencia em app_metadata', async () => {
    setupAuthenticatedAdmin(true);

    mockAdminClient.auth.admin.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          {
            id: TARGET_ID,
            email: 'preexistente@clinica.local',
            email_confirmed_at: null,
            last_sign_in_at: null,
            app_metadata: {},
          },
        ],
      },
      error: null,
    });

    const m = createReqRes({ body: { nome: 'Conta Externa', email: 'preexistente@clinica.local' } });
    await usuariosHandler(m.req, m.res);
    expect(m.getStatus()).toBe(409);
    expect((m.getBody() as { error: { code: string } }).error.code).toBe(
      'AUTH_ACCOUNT_PREEXISTING_CONFLICT'
    );
    expect(mockUserClient.rpc).not.toHaveBeenCalled();
  });

  it('[7.1 POSITIVO] POST /api/admin/usuarios recupera falha parcial com carimbo confiavel em app_metadata', async () => {
    setupAuthenticatedAdmin(true);

    mockAdminClient.auth.admin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
    mockAdminClient.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: TARGET_ID } },
      error: null,
    });
    mockUserClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });

    const first = createReqRes({ body: { nome: 'Nova Gestora', email: 'nova@clinica.local' } });
    await usuariosHandler(first.req, first.res);
    expect(first.getStatus()).toBe(502);

    mockAdminClient.auth.admin.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          {
            id: TARGET_ID,
            email: 'nova@clinica.local',
            email_confirmed_at: null,
            last_sign_in_at: null,
            app_metadata: {
              recriar_admin_provisioned: true,
              recriar_provisioning_actor_id: ADMIN_ID,
            },
          },
        ],
      },
      error: null,
    });
    mockUserClient.rpc.mockResolvedValueOnce({ data: TARGET_ID, error: null });

    const second = createReqRes({ body: { nome: 'Nova Gestora', email: 'nova@clinica.local' } });
    await usuariosHandler(second.req, second.res);
    expect(second.getStatus()).toBe(201);
    expect(second.getBody()).toEqual({
      ok: true,
      userId: TARGET_ID,
      conviteSolicitado: false,
      recoveredExistingAuthUser: true,
    });
  });

  it('[8B.2 getClaims + flow cookie] /api/auth/definir-senha-inicial exige AMBOS getClaims valido e cookie assinado do fluxo', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    setupAuthenticatedAdmin(true, ['usuarios.manage'], null);

    // 1. Sem cookie assinado de fluxo -> bloqueia imediatamente com 403 antes de chamar getClaims
    const noFlowCookie = createReqRes({ body: { newPassword: 'NovaSenha@2026!' } });
    await definirSenhaInicialHandler(noFlowCookie.req, noFlowCookie.res);
    expect(noFlowCookie.getStatus()).toBe(403);
    expect(mockUserClient.auth.getClaims).not.toHaveBeenCalled();

    // 2. Com cookie assinado mas claims.sub divergente -> 403
    const validInviteCookie = createPasswordFlowCookieValue(ADMIN_ID, 'invite', nowSec - 10);
    mockUserClient.auth.getClaims.mockResolvedValueOnce({
      data: {
        claims: {
          sub: TARGET_ID,
          exp: nowSec + 600,
          session_id: 'sess-1',
          amr: [{ method: 'invite', timestamp: nowSec - 10 }],
        },
      },
      error: null,
    });
    const wrongSub = createReqRes({
      cookies: { recriar_pwd_flow_dev: validInviteCookie },
      body: { newPassword: 'NovaSenha@2026!' },
    });
    await definirSenhaInicialHandler(wrongSub.req, wrongSub.res);
    expect(wrongSub.getStatus()).toBe(403);

    // 3. Com cookie assinado mas sessao com amr 'password' -> 403
    mockUserClient.auth.getClaims.mockResolvedValueOnce({
      data: {
        claims: {
          sub: ADMIN_ID,
          exp: nowSec + 600,
          session_id: 'sess-1',
          amr: [{ method: 'password', timestamp: nowSec - 5 }],
        },
      },
      error: null,
    });
    const pwdAmr = createReqRes({
      cookies: { recriar_pwd_flow_dev: validInviteCookie },
      body: { newPassword: 'NovaSenha@2026!' },
    });
    await definirSenhaInicialHandler(pwdAmr.req, pwdAmr.res);
    expect(pwdAmr.getStatus()).toBe(403);

    // 4. Fluxo invite valido (cookie assinado + getClaims ok) -> 200 e limpa cookie (Max-Age=0)
    mockUserClient.auth.getClaims.mockResolvedValueOnce({
      data: {
        claims: {
          sub: ADMIN_ID,
          exp: nowSec + 600,
          session_id: 'sess-1',
          amr: [{ method: 'invite', timestamp: nowSec - 10 }],
        },
      },
      error: null,
    });
    mockUserClient.auth.updateUser.mockResolvedValueOnce({ data: {}, error: null });
    mockUserClient.rpc.mockResolvedValueOnce({ data: 'reported', error: null });

    const okInvite = createReqRes({
      cookies: { recriar_pwd_flow_dev: validInviteCookie },
      body: { newPassword: 'NovaSenha@2026!' },
    });
    await definirSenhaInicialHandler(okInvite.req, okInvite.res);
    expect(okInvite.getStatus()).toBe(200);
    expect(okInvite.getBody()).toEqual({
      ok: true,
      flow: 'initial_setup',
      initialSetupReportState: 'reported',
    });
    const setCookies = okInvite.getHeaders()['set-cookie'] as string[];
    expect(setCookies.some((c) => c.includes('recriar_pwd_flow_dev=') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('[8B.2 Migração 4 UI API] GET /api/admin/usuarios/falhas-sync respeita usuarios.manage e paginacao', async () => {
    // Auditor (sem usuarios.manage) -> 403
    setupAuthenticatedAdmin(false, ['auditoria.read']);
    const denied = createReqRes({ method: 'GET', query: { limit: '1' } });
    await falhasSyncUsuariosHandler(denied.req, denied.res);
    expect(denied.getStatus()).toBe(403);

    // Gestor (usuarios.manage) -> 200 com hasMore=true quando RPC retorna limit+1
    setupAuthenticatedAdmin(false, ['usuarios.manage']);
    mockUserClient.rpc.mockResolvedValueOnce({
      data: [
        {
          job_id: 'aaaa',
          target_user_id: TARGET_ID,
          target_versao: 2,
          operacao: 'ban_user',
          tentativas: 5,
          max_tentativas: 5,
          ultimo_erro_codigo: 'auth_5xx',
          concluido_em: '2026-11-25T10:00:00Z',
        },
        {
          job_id: 'bbbb',
          target_user_id: '33333333-3333-4333-8333-333333333333',
          target_versao: 2,
          operacao: 'unban',
          tentativas: 5,
          max_tentativas: 5,
          ultimo_erro_codigo: 'auth_timeout',
          concluido_em: '2026-11-25T10:05:00Z',
        },
      ],
      error: null,
    });
    const allowed = createReqRes({ method: 'GET', query: { limit: '1' } });
    await falhasSyncUsuariosHandler(allowed.req, allowed.res);
    expect(allowed.getStatus()).toBe(200);
    expect(allowed.getBody()).toEqual({
      falhas: [expect.objectContaining({ target_user_id: TARGET_ID })],
      hasMore: true,
      nextAfterUserId: TARGET_ID,
    });
  });

  it('[15] recuperacao manual via /retry-auth-sync e consulta historica /api/admin/auth-sync/falhas', async () => {
    setupAuthenticatedAdmin(true, ['usuarios.manage', 'auditoria.read']);

    mockUserClient.rpc.mockResolvedValueOnce({
      data: '44444444-4444-4444-8444-444444444444',
      error: null,
    });
    const retryOk = createReqRes({ query: { id: TARGET_ID } });
    await retrySyncHandler(retryOk.req, retryOk.res);
    expect(retryOk.getStatus()).toBe(202);

    mockUserClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'CR021', message: 'ja existe sync ativa' },
    });
    const retryDup = createReqRes({ query: { id: TARGET_ID } });
    await retrySyncHandler(retryDup.req, retryDup.res);
    expect(retryDup.getStatus()).toBe(409);

    const falhasRes = createReqRes({ method: 'GET', query: { pagina: '1', limite: '20' } });
    await falhasSyncAuditHandler(falhasRes.req, falhasRes.res);
    expect(falhasRes.getStatus()).toBe(200);
  });

  it('POST /api/admin/usuarios/[id]/reenviar-acesso escolhe definicao_senha quando email confirmado', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: ADMIN_ID, email: 'admin@clinica.local' } },
      error: null,
    });
    mockUserClient.from.mockImplementation((table: string) => {
      if (table === 'usuarios_perfil') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () =>
                val === ADMIN_ID
                  ? {
                      data: {
                        id: ADMIN_ID,
                        nome: 'Admin',
                        email: 'admin@clinica.local',
                        is_admin_principal: true,
                        ativo: true,
                        estado_ativacao_versao: 1,
                        convite_solicitado_em: null,
                        email_confirmado_em: '2026-11-25T10:00:00Z',
                        configuracao_inicial_reportada_em: null,
                        primeiro_acesso_observado_em: '2026-11-25T10:05:00Z',
                        ultimo_acesso_auth_em: '2026-11-25T10:05:00Z',
                        desativado_em: null,
                        criado_em: '2026-11-25T09:00:00Z',
                      },
                      error: null,
                    }
                  : {
                      data: {
                        id: TARGET_ID,
                        email: 'alvo@clinica.local',
                        ativo: true,
                        primeiro_acesso_observado_em: null,
                      },
                      error: null,
                    },
            }),
          }),
        };
      }
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    });

    mockAdminClient.auth.admin.getUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: TARGET_ID,
          email: 'alvo@clinica.local',
          email_confirmed_at: '2026-11-25T10:15:00Z',
        },
      },
      error: null,
    });
    mockEphemeralClient.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
    mockUserClient.rpc.mockResolvedValueOnce({ data: null, error: null });

    const m = createReqRes({ query: { id: TARGET_ID } });
    await reenviarHandler(m.req, m.res);
    expect(m.getStatus()).toBe(200);
    expect(m.getBody()).toEqual({ ok: true, fluxo: 'definicao_senha' });
  });

  it('bloqueia gestor comum em /permissoes e usuario sem auditoria.read em /auditoria', async () => {
    setupAuthenticatedAdmin(false, ['usuarios.manage']);

    const permReq = createReqRes({ query: { id: TARGET_ID }, body: { permissao: 'auditoria.read' } });
    await permissoesHandler(permReq.req, permReq.res);
    expect(permReq.getStatus()).toBe(403);

    const audReq = createReqRes({ method: 'GET', query: { pagina: '1', limite: '20' } });
    await auditoriaHandler(audReq.req, audReq.res);
    expect(audReq.getStatus()).toBe(403);
  });
});