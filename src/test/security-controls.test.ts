import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, describe, expect, it } from 'vitest';
import { canRequestAccessLink, deriveAccountLifecycleStatus } from '@/lib/admin/accountLifecycle';
import {
  auditQuerySchema,
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  permissionMutationSchema,
} from '@/lib/admin/schemas';
import {
  CSRF_HEADER_NAME,
  getCsrfCookieName,
  issueCsrfCookie,
  validateCsrfAndOrigin,
} from '@/lib/security/csrf';
import {
  appendSetCookie,
  getTrustedClientIp,
  sanitizeInternalRedirect,
} from '@/lib/security/http';
import { checkRateLimit, resetDevRateLimitStore } from '@/lib/security/rateLimit';

function createMockRes() {
  const headers: Record<string, string | string[]> = {};
  let statusCode = 200;
  let body: unknown = null;

  const res = {
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  } as unknown as NextApiResponse;

  return { res, getStatus: () => statusCode, getBody: () => body, getHeaders: () => headers };
}

describe('controles de seguranca HTTP, CSRF, Origin, Rate Limit e Zod v4', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    resetDevRateLimitStore();
  });

  it('usa __Host-recriar_csrf com Secure/HttpOnly/SameSite=Lax em HTTPS e preserva multiplos Set-Cookie', () => {
    const req = { headers: { 'x-forwarded-proto': 'https' }, cookies: {} } as unknown as NextApiRequest;
    const mock = createMockRes();

    appendSetCookie(mock.res, 'sb-session=abc; Path=/; HttpOnly; Secure');
    const token = issueCsrfCookie(req, mock.res);

    expect(getCsrfCookieName(req)).toBe('__Host-recriar_csrf');
    const setCookies = mock.getHeaders()['set-cookie'] as string[];
    expect(Array.isArray(setCookies)).toBe(true);
    expect(setCookies).toHaveLength(2);
    expect(setCookies[1]).toContain(`__Host-recriar_csrf=${token}`);
    expect(setCookies[1]).toContain('HttpOnly');
    expect(setCookies[1]).toContain('Secure');
    expect(setCookies[1]).toContain('SameSite=Lax');
    expect(setCookies[1]).toContain('Path=/');
  });

  it('valida Origin por allowlist exata e rejeita CSRF ausente ou divergente', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://clinicarecriar.com.br';
    const validToken = 'a'.repeat(64);

    // Origem externa maliciosa
    const badOriginReq = {
      headers: {
        'x-forwarded-proto': 'https',
        origin: 'https://clinicarecriar.com.br.evil.test',
        [CSRF_HEADER_NAME]: validToken,
      },
      cookies: { '__Host-recriar_csrf': validToken },
    } as unknown as NextApiRequest;
    const res1 = createMockRes();
    expect(validateCsrfAndOrigin(badOriginReq, res1.res)).toEqual({ ok: false, reason: 'origem_invalida' });
    expect(res1.getStatus()).toBe(403);

    // Token divergente
    const badCsrfReq = {
      headers: {
        'x-forwarded-proto': 'https',
        origin: 'https://clinicarecriar.com.br',
        [CSRF_HEADER_NAME]: 'b'.repeat(64),
      },
      cookies: { '__Host-recriar_csrf': validToken },
    } as unknown as NextApiRequest;
    const res2 = createMockRes();
    expect(validateCsrfAndOrigin(badCsrfReq, res2.res)).toEqual({ ok: false, reason: 'csrf_invalido' });
    expect(res2.getStatus()).toBe(403);

    // Origem e token validos
    const okReq = {
      headers: {
        'x-forwarded-proto': 'https',
        origin: 'https://clinicarecriar.com.br',
        [CSRF_HEADER_NAME]: validToken,
      },
      cookies: { '__Host-recriar_csrf': validToken },
    } as unknown as NextApiRequest;
    const res3 = createMockRes();
    expect(validateCsrfAndOrigin(okReq, res3.res)).toEqual({ ok: true });
  });

  it('ignora x-forwarded-for arbitrario do cliente e prioriza x-nf-client-connection-ip', () => {
    const reqSpoofed = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as NextApiRequest;
    expect(getTrustedClientIp(reqSpoofed)).toBe('127.0.0.1');

    const reqNetlify = {
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-nf-client-connection-ip': '203.0.113.10' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as NextApiRequest;
    expect(getTrustedClientIp(reqNetlify)).toBe('203.0.113.10');
  });

  it('bloqueia open redirects fora de /gestao', () => {
    expect(sanitizeInternalRedirect('/gestao/usuarios')).toBe('/gestao/usuarios');
    expect(sanitizeInternalRedirect('https://evil.test')).toBe('/gestao');
    expect(sanitizeInternalRedirect('//evil.test/gestao')).toBe('/gestao');
    expect(sanitizeInternalRedirect('/gestao\\..\\admin')).toBe('/gestao');
    expect(sanitizeInternalRedirect('/admin')).toBe('/gestao');
  });

  it('aplica rate limiting fail-closed quando Redis nao esta disponivel e limita em memoria apenas com flag dev explicita', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.RATE_LIMIT_ALLOW_DEV_MEMORY;

    // Sem Upstash e sem flag dev explicita -> fail-closed (unavailable=true)
    const closed = await checkRateLimit('login', ['127.0.0.1', 'teste@clinica.local']);
    expect(closed.allowed).toBe(false);
    expect(closed.unavailable).toBe(true);

    // Em producao, mesmo com flag dev, continua fail-closed
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.RATE_LIMIT_ALLOW_DEV_MEMORY = 'true';
    const prodClosed = await checkRateLimit('login', ['127.0.0.1', 'teste@clinica.local']);
    expect(prodClosed.allowed).toBe(false);
    expect(prodClosed.unavailable).toBe(true);

    // Em dev com flag explicita -> aplica limite de 5 tentativas no bucket login
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    for (let i = 0; i < 5; i += 1) {
      const r = await checkRateLimit('login', ['127.0.0.1', 'teste@clinica.local']);
      expect(r.allowed).toBe(true);
    }
    const sixth = await checkRateLimit('login', ['127.0.0.1', 'teste@clinica.local']);
    expect(sixth.allowed).toBe(false);
    expect(sixth.unavailable).toBe(false);
  });

  it('valida entradas com Zod v4 rejeitando campos extras e permissoes fora da Fase 2', () => {
    expect(loginSchema.safeParse({ email: ' Admin@Clinica.br ', password: '123' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'invalido', password: '123' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.br', password: '123', extra: true }).success).toBe(false);

    expect(createUserSchema.safeParse({ nome: 'Maria Silva', email: 'maria@clinica.br' }).success).toBe(true);
    expect(permissionMutationSchema.safeParse({ permissao: 'usuarios.manage' }).success).toBe(true);
    expect(permissionMutationSchema.safeParse({ permissao: 'escuta.read' }).success).toBe(false);

    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'Password@1234',
        newPassword: 'Password@1234',
      }).success
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'OldPassword@1234',
        newPassword: 'NewPassword@5678',
      }).success
    ).toBe(true);

    expect(auditQuerySchema.safeParse({ pagina: '1', limite: '20', filtro_acao: 'USER_DEACTIVATED' }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ pagina: '1', limite: '20', filtro_acao: 'joao@clinica.br' }).success).toBe(false);
  });

  it('diferencia configuracao_inicial_reportada_em de primeiro_acesso_observado_em nas regras de reenvio', () => {
    const reportedOnly = {
      ativo: true,
      convite_solicitado_em: '2026-11-25T10:00:00Z',
      email_confirmado_em: '2026-11-25T10:05:00Z',
      configuracao_inicial_reportada_em: '2026-11-25T10:06:00Z',
      primeiro_acesso_observado_em: null,
      ultimo_acesso_auth_em: null,
    };
    expect(deriveAccountLifecycleStatus(reportedOnly)).toBe('configuracao_inicial_reportada');
    // Reenvio continua permitido porque primeiro_acesso_observado_em ainda e null
    expect(canRequestAccessLink(reportedOnly)).toBe(true);

    const loggedIn = {
      ...reportedOnly,
      primeiro_acesso_observado_em: '2026-11-25T10:10:00Z',
      ultimo_acesso_auth_em: '2026-11-25T10:10:00Z',
    };
    expect(deriveAccountLifecycleStatus(loggedIn)).toBe('ativa_acesso_observado');
    expect(canRequestAccessLink(loggedIn)).toBe(false);
  });
});