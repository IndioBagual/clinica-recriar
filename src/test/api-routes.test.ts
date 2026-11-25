import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevRateLimitStore } from '@/lib/security/rateLimit';

const mockUserClient = {
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
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
import statusHandler from '@/pages/api/admin/usuarios/[id]/status';
import reenviarHandler from '@/pages/api/admin/usuarios/[id]/reenviar-acesso';
import permissoesHandler from '@/pages/api/admin/usuarios/[id]/permissoes';
import retrySyncHandler from '@/pages/api/admin/usuarios/[id]/retry-auth-sync';
import falhasSyncHandler from '@/pages/api/admin/auth-sync/falhas';
import auditoriaHandler from '@/pages/api/admin/auditoria';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'c'.repeat(64);

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

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

describe('integracao controlada das API Routes (Etapa 5 + correcoes 7.1, 7.2 e retry failed_permanent)', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetDevRateLimitStore();
    process.env.RATE_LIMIT_ALLOW_DEV_MEMORY = 'true';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
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

  it('[7.1 POSITIVO] POST /api/admin/usuarios recupera falha parcial quando ha carimbo confiavel em app_metadata e sem uso previo', async () => {
    setupAuthenticatedAdmin(true);

    // 1a tentativa: conta nao existe -> cria convite, carimba app_metadata, mas RPC falha -> 502
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
    expect(mockAdminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({
        app_metadata: expect.objectContaining({
          recriar_admin_provisioned: true,
          recriar_provisioning_actor_id: ADMIN_ID,
        }),
      })
    );

    // 2a tentativa: conta localizada com carimbo confiavel em app_metadata e nao confirmada -> 201
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

  it('[7.2 NEGATIVO e POSITIVO] /api/auth/definir-senha-inicial bloqueia sessao comum por password e aceita fluxo otp/recovery recente', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    setupAuthenticatedAdmin(true, ['usuarios.manage'], null);

    // Sessao comum autenticada via 'password' -> 403 (nao contorna /api/auth/alterar-senha)
    mockUserClient.auth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: makeFakeJwt({ amr: [{ method: 'password', timestamp: nowSec - 60 }] }) } },
    });
    const blocked = createReqRes({ body: { newPassword: 'NovaSenha@2026!' } });
    await definirSenhaInicialHandler(blocked.req, blocked.res);
    expect(blocked.getStatus()).toBe(403);
    expect(mockUserClient.auth.updateUser).not.toHaveBeenCalled();

    // Sessao com link OTP expirado (>15 min) -> 403
    mockUserClient.auth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: makeFakeJwt({ amr: [{ method: 'otp', timestamp: nowSec - 1200 }] }) } },
    });
    const expired = createReqRes({ body: { newPassword: 'NovaSenha@2026!' } });
    await definirSenhaInicialHandler(expired.req, expired.res);
    expect(expired.getStatus()).toBe(403);

    // Sessao recente de convite ('otp') com primeiro_acesso_observado_em=null -> 200 initial_setup
    mockUserClient.auth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: makeFakeJwt({ amr: [{ method: 'otp', timestamp: nowSec - 30 }] }) } },
    });
    mockUserClient.auth.updateUser.mockResolvedValueOnce({ data: {}, error: null });
    mockUserClient.rpc.mockResolvedValueOnce({ data: 'reported', error: null });

    const allowed = createReqRes({ body: { newPassword: 'NovaSenha@2026!' } });
    await definirSenhaInicialHandler(allowed.req, allowed.res);
    expect(allowed.getStatus()).toBe(200);
    expect(allowed.getBody()).toEqual({
      ok: true,
      flow: 'initial_setup',
      initialSetupReportState: 'reported',
    });
  });

  it('[15] recuperacao manual de falha permanente via /retry-auth-sync e consulta de falhas em /api/admin/auth-sync/falhas', async () => {
    setupAuthenticatedAdmin(true, ['usuarios.manage', 'auditoria.read']);

    mockUserClient.rpc.mockResolvedValueOnce({
      data: '44444444-4444-4444-8444-444444444444',
      error: null,
    });
    const retryOk = createReqRes({ query: { id: TARGET_ID } });
    await retrySyncHandler(retryOk.req, retryOk.res);
    expect(retryOk.getStatus()).toBe(202);

    // Conflito quando ja existe job pendente/processing (CR021 -> 409)
    mockUserClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'CR021', message: 'ja existe sync ativa' },
    });
    const retryDup = createReqRes({ query: { id: TARGET_ID } });
    await retrySyncHandler(retryDup.req, retryDup.res);
    expect(retryDup.getStatus()).toBe(409);

    // Consulta administrativa de falhas (exige auditoria.read)
    const falhasRes = createReqRes({ method: 'GET', query: { pagina: '1', limite: '20' } });
    await falhasSyncHandler(falhasRes.req, falhasRes.res);
    expect(falhasRes.getStatus()).toBe(200);
    expect((falhasRes.getBody() as { total: number }).total).toBe(1);
  });

  it('POST /api/admin/usuarios/[id]/reenviar-acesso escolhe definicao_senha quando email ja esta confirmado no Auth', async () => {
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