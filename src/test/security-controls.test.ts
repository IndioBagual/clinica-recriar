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
  getAllowedOrigins,
  getCsrfCookieName,
  issueCsrfCookie,
  validateCsrfAndOrigin,
} from '@/lib/security/csrf';
import {
  appendSetCookie,
  getCanonicalSiteOrigin,
  getTrustedClientIp,
  sanitizeInternalRedirect,
} from '@/lib/security/http';
import { consumePasswordFlowNonce, createPasswordFlowCookieValue, registerPasswordFlowNonce, resetDevPasswordFlowStore, verifyPasswordFlowCookie } from '@/lib/security/passwordFlow';
import { checkRateLimit, checkRateLimits, resetDevRateLimitStore } from '@/lib/security/rateLimit';

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
    resetDevPasswordFlowStore();
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

  it('[9B] restringe allowlist CSRF exclusivamente a DEPLOY_PRIME_URL em deploy-preview', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.CONTEXT = 'deploy-preview';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://clinicarecriar.com.br';
    process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-2--clinicarecriarrg.netlify.app';

    const allowed = getAllowedOrigins();
    expect(allowed.has('https://deploy-preview-2--clinicarecriarrg.netlify.app')).toBe(true);
    expect(allowed.has('https://clinicarecriar.com.br')).toBe(false);
  });

  it('[9A] prioriza DEPLOY_PRIME_URL como origem canonica em deploy-preview mesmo com NEXT_PUBLIC_SITE_URL de producao', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.CONTEXT = 'deploy-preview';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://clinicarecriar.com.br';
    process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-42--clinicarecriar.netlify.app';
    expect(getCanonicalSiteOrigin()).toBe('https://deploy-preview-42--clinicarecriar.netlify.app');

    process.env.CONTEXT = 'production';
    expect(getCanonicalSiteOrigin()).toBe('https://clinicarecriar.com.br');
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

  it('[8C.1 7.1] aplica buckets complementares de login (IP+email, IP, email) e reset (IP+email, IP) com normalizacao', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.RATE_LIMIT_ALLOW_DEV_MEMORY = 'true';

    // 20 tentativas alternando e-mails a partir do mesmo IP sao aceitas; 21a bloqueia via loginIp
    for (let i = 0; i < 20; i += 1) {
      const email = `User${Math.floor(i / 5)}@Clinica.LOCAL `;
      const r = await checkRateLimits([
        { bucket: 'login', rawParts: ['10.0.0.1', email] },
        { bucket: 'loginIp', rawParts: ['10.0.0.1'] },
        { bucket: 'loginEmail', rawParts: [email] },
      ]);
      expect(r.allowed).toBe(true);
    }
    const blockedByIp = await checkRateLimits([
      { bucket: 'login', rawParts: ['10.0.0.1', 'novo@clinica.local'] },
      { bucket: 'loginIp', rawParts: ['10.0.0.1'] },
      { bucket: 'loginEmail', rawParts: ['novo@clinica.local'] },
    ]);
    expect(blockedByIp.allowed).toBe(false);
    expect(blockedByIp.unavailable).toBe(false);

    // Mesmo e-mail com IPs distintos bloqueia na 11a tentativa via loginEmail (10/15m)
    for (let i = 0; i < 10; i += 1) {
      const ip = `10.1.0.${Math.floor(i / 2) + 1}`;
      const r = await checkRateLimits([
        { bucket: 'login', rawParts: [ip, ' Alvo@Clinica.Local '] },
        { bucket: 'loginIp', rawParts: [ip] },
        { bucket: 'loginEmail', rawParts: ['alvo@clinica.local'] },
      ]);
      expect(r.allowed).toBe(true);
    }
    const blockedByEmail = await checkRateLimits([
      { bucket: 'login', rawParts: ['10.1.99.1', 'alvo@clinica.local'] },
      { bucket: 'loginIp', rawParts: ['10.1.99.1'] },
      { bucket: 'loginEmail', rawParts: ['alvo@clinica.local'] },
    ]);
    expect(blockedByEmail.allowed).toBe(false);

    // Recuperacao por IP isolado: 10 tentativas alternando e-mails aceitas, 11a bloqueada
    for (let i = 0; i < 10; i += 1) {
      const email = `reset${Math.floor(i / 3)}@clinica.local`;
      const r = await checkRateLimits([
        { bucket: 'passwordReset', rawParts: ['10.2.0.1', email] },
        { bucket: 'passwordResetIp', rawParts: ['10.2.0.1'] },
      ]);
      expect(r.allowed).toBe(true);
    }
    const resetBlockedByIp = await checkRateLimits([
      { bucket: 'passwordReset', rawParts: ['10.2.0.1', 'outro@clinica.local'] },
      { bucket: 'passwordResetIp', rawParts: ['10.2.0.1'] },
    ]);
    expect(resetBlockedByIp.allowed).toBe(false);
  });

  it('[8C.1 7.2] valida cookie assinado com session_id, consumo atomico unico e fail-closed sem Redis', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.RATE_LIMIT_ALLOW_DEV_MEMORY;
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_unit_test_signing_key_only';

    const nowSec = Math.floor(Date.now() / 1000);
    const created = createPasswordFlowCookieValue('u1', 'sess-1', 'recovery', nowSec);

    // Sem Redis e sem flag dev -> fail-closed
    const regClosed = await registerPasswordFlowNonce({
      flowId: created.flowId,
      userId: 'u1',
      sessionId: 'sess-1',
      flow: 'recovery',
      nowSeconds: nowSec,
    });
    expect(regClosed).toEqual({ ok: false, reason: 'store_unavailable' });

    // Com flag dev explicita -> registra e permite consumo atomico apenas uma vez
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.RATE_LIMIT_ALLOW_DEV_MEMORY = 'true';
    const regOk = await registerPasswordFlowNonce({
      flowId: created.flowId,
      userId: 'u1',
      sessionId: 'sess-1',
      flow: 'recovery',
      nowSeconds: nowSec,
    });
    expect(regOk).toEqual({ ok: true });

    // Vinculo de session_id rejeita outra sessao
    const badSess = verifyPasswordFlowCookie(
      { headers: { 'x-forwarded-proto': 'https' }, cookies: { '__Host-recriar_pwd_flow': created.value } },
      'u1',
      'sess-2',
      nowSec + 10
    );
    expect(badSess).toEqual({ ok: false, reason: 'session_mismatch' });

    // Dois consumos concorrentes -> exatamente 1 sucesso e 1 rejeicao
    const [c1, c2] = await Promise.all([
      consumePasswordFlowNonce({ flowId: created.flowId, userId: 'u1', sessionId: 'sess-1', flow: 'recovery', nowSeconds: nowSec + 10 }),
      consumePasswordFlowNonce({ flowId: created.flowId, userId: 'u1', sessionId: 'sess-1', flow: 'recovery', nowSeconds: nowSec + 10 }),
    ]);
    expect([c1.ok, c2.ok].filter(Boolean)).toHaveLength(1);
    expect([c1.ok, c2.ok].filter((v) => !v)).toHaveLength(1);
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