import crypto from 'node:crypto';
import {
  AUTH_SYNC_DEFAULTS,
  type AuthSyncClientLike,
  type ReconcileCursorStore,
  runAuthSyncCycle,
} from '../../src/lib/admin/authSync';

/**
 * Netlify Scheduled Function (periodicidade de 15 minutos, teto fixo de 30s na Netlify).
 * - KILL-SWITCH OBRIGATORIO: permanece 100% inativa (no-op seguro, sem efeitos sobre contas)
 *   enquanto AUTH_SYNC_SCHEDULE_ENABLED !== 'true'.
 * - Executa com orcamento de 22s (margem de 8s abaixo do teto de 30s), lote de 5 jobs em paralelo
 *   com timeout HTTP efetivo de 15s e lease de 120s.
 * - Nao retorna credenciais, tokens ou dados sensiveis em logs.
 */
export const config = {
  schedule: '*/15 * * * *',
};

export async function runScheduledAuthSync(deps?: {
  env?: NodeJS.ProcessEnv;
  client?: AuthSyncClientLike;
  cursorStore?: ReconcileCursorStore | null;
  now?: () => number;
}): Promise<{ executed: boolean; reason?: string; status: number }> {
  const env = deps?.env ?? process.env;

  if (env.AUTH_SYNC_SCHEDULE_ENABLED !== 'true') {
    return { executed: false, reason: 'schedule_disabled_by_kill_switch', status: 204 };
  }

  await runAuthSyncCycle({
    workerId: `netlify-sched-${crypto.randomUUID().slice(0, 8)}`,
    timeBudgetMs: AUTH_SYNC_DEFAULTS.scheduledTimeBudgetMs,
    requestTimeoutMs: AUTH_SYNC_DEFAULTS.requestTimeoutMs,
    client: deps?.client,
    cursorStore: deps?.cursorStore,
    now: deps?.now,
  });

  return { executed: true, status: 200 };
}

export default async function handler(): Promise<Response> {
  const outcome = await runScheduledAuthSync();
  return new Response(null, { status: outcome.status });
}