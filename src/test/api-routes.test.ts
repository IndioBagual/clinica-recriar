import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevRateLimitStore } from '@/lib/security/rateLimit';

const mockUserClient = {
  auth: {
    getUser: vi.fn(),
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
import usuariosHandler from '@/pages/api/admin/usuarios/index';
import statusHandler from '@/pages/api/admin/usuarios/[id]/status';
import reenviarHandler from '@/pages/api/admin/usuarios/[id]/reenviar-acesso';
import permissoesHandler from '@/pages/api/admin/usuarios/[id]/permissoes';
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

function setupAuthenticatedAdmin(isAdminPrincipal = true, permissions: string[] = ['usuarios.manage']) {
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
                    primeiro_acesso_observado_em: '2026-11-25T10:05:00Z',
                    ultimo_acesso_auth_em: '2026-11-25T10:05:00Z',
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
    return {};
  });
}

describe('integracao controlada das API Routes (chamadas diretas, CSRF, auth e falhas parciais)', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetDevRateLimitStore();
    process.env.RATE_LIMIT_ALLOW_DEV_MEMORY = 'true';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    mockAdminClient.rpc.mockResolvedValue({ data: null, error: null });
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
    expect(m.getHeaders()['cache-control']).toContain('no-store');
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

  it('POST /api/admin/usuarios trata falha parcial sem deletar Auth e recupera idempotentemente em nova tentativa', async () => {
    setupAuthenticatedAdmin(true);

    // 1a tentativa: Auth cria usuario mas RPC falha -> 502 PARTIAL_CREATION_RECOVERY_REQUIRED
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
    expect((first.getBody() as { error: { code: string } }).error.code).toBe(
      'PARTIAL_CREATION_RECOVERY_REQUIRED'
    );

    // 2a tentativa (recuperacao): Auth informa existente -> localiza via listUsers e conclui RPC
    mockAdminClient.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered' },
    });
    mockAdminClient.auth.admin.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: TARGET_ID, email: 'nova@clinica.local', email_confirmed_at: null }] },
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
    expect(mockAdminClient.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mockEphemeralClient.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('bloqueia gestor comum em /api/admin/usuarios/[id]/permissoes e usuario sem auditoria.read em /api/admin/auditoria', async () => {
    setupAuthenticatedAdmin(false, ['usuarios.manage']);

    const permReq = createReqRes({
      query: { id: TARGET_ID },
      body: { permissao: 'auditoria.read' },
    });
    await permissoesHandler(permReq.req, permReq.res);
    expect(permReq.getStatus()).toBe(403);

    const audReq = createReqRes({ method: 'GET', query: { pagina: '1', limite: '20' } });
    await auditoriaHandler(audReq.req, audReq.res);
    expect(audReq.getStatus()).toBe(403);
  });
});