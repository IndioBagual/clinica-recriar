import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { AUTH_SYNC_DEFAULTS, runAuthSyncCycle } from '@/lib/admin/authSync';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4kb',
    },
  },
};

const FORBIDDEN_QUERY_KEYS = new Set(['secret', 'token', 'key', 'apikey', 'authorization']);

function verifyBearerSecret(authHeader: string | undefined, expectedSecret: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice('Bearer '.length).trim();
  if (provided.length < 32 || expectedSecret.length < 32) return false;

  const bufA = Buffer.from(provided, 'utf8');
  const bufB = Buffer.from(expectedSecret, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Endpoint interno para execucao controlada do ciclo de sincronizacao.
 * - Exige POST + Authorization: Bearer <AUTH_SYNC_INTERNAL_SECRET> (timingSafeEqual).
 * - Recusa credenciais em query string/URL.
 * - Fail-closed (503) quando AUTH_SYNC_INTERNAL_SECRET nao estiver configurado.
 * - Respeita limite real da funcao sincrona (padrao 10s -> orcamento 8s, ou 22s apenas quando
 *   NETLIFY_SYNC_FUNCTION_TIMEOUT_SECONDS >= 26 estiver explicitamente confirmado).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['POST'])) return;

  // Proibe passagem de credenciais na URL / query string
  for (const key of Object.keys(req.query ?? {})) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) {
      res.status(400).json({
        error: { code: 'CREDENTIALS_IN_URL_FORBIDDEN', message: 'Credenciais não são permitidas na URL.' },
      });
      return;
    }
  }

  const configuredSecret = process.env.AUTH_SYNC_INTERNAL_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    res.status(503).json({
      error: { code: 'INTERNAL_SYNC_NOT_CONFIGURED', message: 'Endpoint interno indisponível.' },
    });
    return;
  }

  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
  if (!verifyBearerSecret(authHeader, configuredSecret)) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Credencial interna inválida.' },
    });
    return;
  }

  const fnTimeoutSec = Number(process.env.NETLIFY_SYNC_FUNCTION_TIMEOUT_SECONDS || '10');
  const timeBudgetMs = fnTimeoutSec >= 26 ? AUTH_SYNC_DEFAULTS.scheduledTimeBudgetMs : 8_000;

  // Se o plano nao comporta timeout de 15s + margem na rota sincrona, nao reclama jobs para nao violar o teto
  if (timeBudgetMs < AUTH_SYNC_DEFAULTS.requestTimeoutMs + AUTH_SYNC_DEFAULTS.budgetSafetyMarginMs) {
    res.status(409).json({
      error: {
        code: 'SYNC_FUNCTION_TIMEOUT_INSUFFICIENT',
        message:
          'Rota síncrona com teto inferior a 26s não comporta timeout HTTP de 15s; utilize a Netlify Scheduled Function (30s).',
      },
    });
    return;
  }

  const summary = await runAuthSyncCycle({
    workerId: `internal-api-${crypto.randomUUID().slice(0, 8)}`,
    timeBudgetMs,
    requestTimeoutMs: AUTH_SYNC_DEFAULTS.requestTimeoutMs,
  });

  res.status(200).json({
    ok: true,
    drain: summary.drain,
    reconcile: summary.reconcile,
    totalElapsedMs: summary.totalElapsedMs,
  });
}