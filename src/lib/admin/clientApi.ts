export interface ApiErrorPayload {
  code?: string;
  message?: string;
}

export interface ApiClientResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
  retryAfterSeconds?: number;
}

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function clearCsrfToken(): void {
  inMemoryCsrfToken = null;
}

export function getCachedCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function mapApiErrorMessage(
  status: number,
  error?: ApiErrorPayload,
  retryAfterSeconds?: number
): string {
  if (status === 401) {
    return error?.message || 'Sua sessão expirou ou não está autenticada. Faça login novamente.';
  }
  if (status === 403) {
    if (error?.code === 'INVALID_CSRF_TOKEN') {
      return 'Token de segurança expirado. Atualize a página e tente novamente.';
    }
    return error?.message || 'Você não possui permissão para realizar esta operação.';
  }
  if (status === 409) {
    return error?.message || 'A operação conflita com o estado atual do registro.';
  }
  if (status === 429) {
    const wait = retryAfterSeconds ? ` Aguarde cerca de ${retryAfterSeconds}s.` : '';
    return `Muitas solicitações em sequência.${wait}`;
  }
  if (status === 503) {
    return (
      error?.message ||
      'Serviço de proteção temporariamente indisponível. Tente novamente em instantes.'
    );
  }
  if (status === 502) {
    return (
      error?.message ||
      'Falha na comunicação com o serviço de autenticação. Nenhuma exclusão automática foi realizada.'
    );
  }
  return error?.message || 'Não foi possível concluir a operação. Tente novamente.';
}

export async function ensureCsrfToken(
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<string> {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;

  const res = await fetchImpl('/api/auth/csrf', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Não foi possível inicializar a proteção CSRF.');
  }

  const body = (await res.json()) as { csrfToken?: string };
  if (!body?.csrfToken) {
    throw new Error('Token CSRF ausente na resposta do servidor.');
  }

  inMemoryCsrfToken = body.csrfToken;
  return inMemoryCsrfToken;
}

export async function apiRequest<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ApiClientResult<T>> {
  const method = options.method ?? 'GET';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {};

  const isMutating = method !== 'GET';
  if (isMutating) {
    const token = await ensureCsrfToken(fetchImpl);
    headers['x-csrf-token'] = token;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'Não foi possível conectar ao servidor. Verifique sua conexão.',
    };
  }

  const retryHeader = res.headers.get('retry-after');
  const retryAfterSeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const payload = (parsed as { error?: ApiErrorPayload } | null)?.error;
    if (res.status === 403 && payload?.code === 'INVALID_CSRF_TOKEN') {
      clearCsrfToken();
    }
    return {
      ok: false,
      status: res.status,
      errorCode: payload?.code,
      errorMessage: mapApiErrorMessage(res.status, payload, retryAfterSeconds),
      retryAfterSeconds,
    };
  }

  // Atualiza token CSRF rotacionado (ex.: apos login)
  if (parsed && typeof parsed === 'object' && 'csrfToken' in parsed) {
    const nextToken = (parsed as { csrfToken?: unknown }).csrfToken;
    if (typeof nextToken === 'string' && nextToken.length >= 32) {
      setCsrfToken(nextToken);
    }
  }

  return {
    ok: true,
    status: res.status,
    data: parsed as T,
  };
}