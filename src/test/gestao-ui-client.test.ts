import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, clearCsrfToken, getCachedCsrfToken } from '@/lib/admin/clientApi';

function mockJsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Etapa 7 — Client API CSRF, codigos HTTP (401/403/409/429/503) e isolamento de bundle', () => {
  afterEach(() => {
    clearCsrfToken();
  });

  it('[10] obtem token CSRF, envia x-csrf-token em mutacoes e rotaciona token apos login', async () => {
    const initialToken = 'a'.repeat(64);
    const rotatedToken = 'b'.repeat(64);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockJsonResponse(200, { csrfToken: initialToken }))
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true, csrfToken: rotatedToken }));

    const result = await apiRequest<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@clinica.local', password: 'SenhaSegura@2026' },
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const postInit = fetchMock.mock.calls[1][1];
    expect((postInit?.headers as Record<string, string>)['x-csrf-token']).toBe(initialToken);
    expect(getCachedCsrfToken()).toBe(rotatedToken);
  });

  it('[11, 12 & 13] trata respostas 401, 403 (incluindo limpeza de CSRF), 409, 429 (Retry-After) e 503', async () => {
    const token = 'c'.repeat(64);

    // 401
    const f401 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockJsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Sessão expirada.' } }));
    const r401 = await apiRequest('/api/admin/usuarios', { method: 'GET', fetchImpl: f401 });
    expect(r401.ok).toBe(false);
    expect(r401.status).toBe(401);

    // 403 INVALID_CSRF_TOKEN limpa cache
    const f403 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockJsonResponse(200, { csrfToken: token }))
      .mockResolvedValueOnce(mockJsonResponse(403, { error: { code: 'INVALID_CSRF_TOKEN' } }));
    const r403 = await apiRequest('/api/admin/usuarios', {
      method: 'POST',
      body: { nome: 'Teste', email: 't@clinica.local' },
      fetchImpl: f403,
    });
    expect(r403.status).toBe(403);
    expect(getCachedCsrfToken()).toBeNull();

    // 409 ultimo Admin Principal
    const f409 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockJsonResponse(200, { csrfToken: token }))
      .mockResolvedValueOnce(
        mockJsonResponse(409, {
          error: { code: 'LAST_ADMIN_PRINCIPAL_PROTECTED', message: 'Último Admin Principal protegido.' },
        })
      );
    const r409 = await apiRequest('/api/admin/usuarios/1/status', {
      method: 'POST',
      body: { ativo: false },
      fetchImpl: f409,
    });
    expect(r409.status).toBe(409);
    expect(r409.errorCode).toBe('LAST_ADMIN_PRINCIPAL_PROTECTED');

    // 429 com Retry-After
    const f429 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockJsonResponse(429, { error: { code: 'RATE_LIMITED' } }, { 'retry-after': '45' }));
    const r429 = await apiRequest('/api/admin/usuarios', { method: 'GET', fetchImpl: f429 });
    expect(r429.status).toBe(429);
    expect(r429.retryAfterSeconds).toBe(45);
    expect(r429.errorMessage).toContain('45s');

    // 503 indisponibilidade temporaria (fail-closed)
    const f503 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockJsonResponse(503, { error: { code: 'RATE_LIMIT_UNAVAILABLE' } }));
    const r503 = await apiRequest('/api/admin/auditoria', { method: 'GET', fetchImpl: f503 });
    expect(r503.status).toBe(503);
    expect(r503.errorMessage).toContain('temporariamente indisponível');
  });

  it('[16 & 17] garante que nenhum componente/pagina de /gestao importa adminServiceClient ou SUPABASE_SECRET_KEY', () => {
    const dirs = [
      path.resolve(process.cwd(), 'src/components/gestao'),
      path.resolve(process.cwd(), 'src/pages/gestao'),
    ];
    const files: string[] = [];
    for (const dir of dirs) {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          files.push(path.join(dir, entry));
        }
      }
    }
    expect(files.length).toBeGreaterThanOrEqual(10);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/adminServiceClient|SUPABASE_SECRET_KEY|sb_secret_|authSync/);
    }
  });
});