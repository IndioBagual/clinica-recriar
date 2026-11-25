import { createClient } from '@supabase/supabase-js';

export class HttpTimeoutError extends Error {
  readonly code = 'HTTP_TIMEOUT';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Tempo limite HTTP excedido (${timeoutMs}ms).`);
    this.name = 'HttpTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Envolve o transporte fetch com timeout efetivo via AbortController.
 * Cancela a espera local no socket HTTP; NAO garante cancelamento remoto no servidor GoTrue.
 */
export function createTimedFetch(
  timeoutMs: number,
  baseFetch: typeof fetch = globalThis.fetch
): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs deve ser um número positivo.');
  }

  return async (input, init) => {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new HttpTimeoutError(timeoutMs));
    }, timeoutMs);

    const upstreamSignal = init?.signal;
    const onUpstreamAbort = () => {
      controller.abort(upstreamSignal?.reason);
    };

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        clearTimeout(timer);
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true });
      }
    }

    try {
      return await baseFetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        throw new HttpTimeoutError(timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener('abort', onUpstreamAbort);
      }
    }
  };
}

export interface AdminServiceClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  supabaseUrl?: string;
  secretKey?: string;
}

/**
 * Cliente privilegiado EXCLUSIVO DE BACKEND (SUPABASE_SECRET_KEY).
 * - Nunca pode ser importado no navegador.
 * - Nunca compartilha cookies ou sessoes de usuarios.
 * - Nao possui acesso direto as 6 tabelas administrativas (REVOKE ALL no banco).
 */
export function createAdminServiceClient(options?: AdminServiceClientOptions) {
  if (typeof window !== 'undefined') {
    throw new Error('adminServiceClient é restrito ao ambiente de servidor.');
  }

  const url = options?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = options?.secretKey ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error('Configuração privilegiada do Supabase ausente no servidor.');
  }

  const customFetch =
    typeof options?.timeoutMs === 'number'
      ? createTimedFetch(options.timeoutMs, options.fetchImpl ?? globalThis.fetch)
      : options?.fetchImpl;

  return createClient(url, secretKey, {
    ...(customFetch ? { global: { fetch: customFetch } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}