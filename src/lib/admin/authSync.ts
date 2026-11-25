import { Redis } from '@upstash/redis';
import {
  createAdminServiceClient,
  HttpTimeoutError,
} from '../supabase/adminServiceClient';

export const AUTH_SYNC_DEFAULTS = {
  requestTimeoutMs: 15_000,
  leaseSeconds: 120,
  claimLimit: 5,
  concurrency: 5,
  scheduledTimeBudgetMs: 22_000,
  reconcileGraceSeconds: 60,
  reconcilePageSize: 25,
  reconcileConcurrency: 5,
  budgetSafetyMarginMs: 3_000,
  banDuration: '876000h',
  cursorRedisKey: 'recriar:auth_reconcile:cursor_after_id',
  cursorTtlSeconds: 60 * 60 * 24,
} as const;

export type AuthSyncOperation = 'ban_user' | 'unban';
export type AuthSyncErrorCode = 'auth_timeout' | 'auth_5xx' | 'auth_4xx';

export interface ClaimedAuthSyncJob {
  job_id: string;
  claim_token: string;
  target_user_id: string;
  target_versao: number;
  operacao: AuthSyncOperation;
  origem: string;
  tentativas: number;
  max_tentativas: number;
  lease_expires_at: string;
}

export interface ReconcileUserRow {
  user_id: string;
  ativo: boolean;
  estado_ativacao_versao: number;
}

export interface ReconcileCursorStore {
  getCursor(): Promise<string | null>;
  setCursor(afterId: string | null): Promise<void>;
}

export interface AuthSyncClientLike {
  rpc(
    fn: string,
    params?: Record<string, unknown>
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  auth: {
    admin: {
      updateUserById(
        uid: string,
        attributes: { ban_duration: string }
      ): Promise<{ data: unknown; error: { status?: number; message?: string; code?: string } | null }>;
      getUserById(
        uid: string
      ): Promise<{
        data: { user?: { id: string; banned_until?: string | null } | null } | null;
        error: { status?: number; message?: string; code?: string } | null;
      }>;
    };
  };
}

export interface DrainOutboxOptions {
  workerId: string;
  claimLimit?: number;
  concurrency?: number;
  leaseSeconds?: number;
  requestTimeoutMs?: number;
  timeBudgetMs?: number;
  maxBatches?: number;
  client?: AuthSyncClientLike;
  now?: () => number;
}

export interface DrainOutboxResult {
  claimed: number;
  succeeded: number;
  failedRetriable: number;
  failedPermanent: number;
  abortedStale: number;
  abortedInvalidClaim: number;
  staleReconcileEnqueued: number;
  staleClaimEnqueued: number;
  stoppedByBudget: boolean;
  elapsedMs: number;
}

export interface ReconcileDriftOptions {
  workerId: string;
  graceSeconds?: number;
  pageSize?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
  timeBudgetMs?: number;
  drainAfterReconcile?: boolean;
  cursorStore?: ReconcileCursorStore | null;
  client?: AuthSyncClientLike;
  now?: () => number;
}

export interface ReconcileDriftResult {
  usersChecked: number;
  pagesRead: number;
  driftEnqueued: number;
  inSync: number;
  versionSkipped: number;
  lookupErrors: number;
  completedFullPass: boolean;
  stoppedByBudget: boolean;
  cursorPersisted: boolean;
  nextAfterId: string | null;
  drainResult: DrainOutboxResult | null;
  elapsedMs: number;
}

export function isAuthUserBanned(
  bannedUntil: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!bannedUntil) return false;
  const parsed = Date.parse(bannedUntil);
  return Number.isFinite(parsed) && parsed > nowMs;
}

export function classifyAuthSyncError(err: unknown): AuthSyncErrorCode {
  if (err instanceof HttpTimeoutError) return 'auth_timeout';

  if (err && typeof err === 'object') {
    const rec = err as { name?: string; code?: string; status?: number; message?: string; cause?: unknown };
    if (
      rec.code === 'HTTP_TIMEOUT' ||
      rec.name === 'AbortError' ||
      rec.name === 'TimeoutError' ||
      rec.code === 'ABORT_ERR' ||
      rec.code === 'UND_ERR_HEADERS_TIMEOUT' ||
      rec.code === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return 'auth_timeout';
    }
    if (rec.cause && classifyAuthSyncError(rec.cause) === 'auth_timeout') {
      return 'auth_timeout';
    }
    if (typeof rec.status === 'number') {
      if (rec.status === 408 || rec.status === 504) return 'auth_timeout';
      if (rec.status >= 400 && rec.status < 500 && rec.status !== 429) return 'auth_4xx';
      return 'auth_5xx';
    }
    if (typeof rec.message === 'string' && /timeout|timed out|aborted/i.test(rec.message)) {
      return 'auth_timeout';
    }
  }

  return 'auth_5xx';
}

export function createUpstashCursorStore(): ReconcileCursorStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  return {
    async getCursor(): Promise<string | null> {
      const value = await redis.get<string>(AUTH_SYNC_DEFAULTS.cursorRedisKey);
      return typeof value === 'string' && value.length > 0 ? value : null;
    },
    async setCursor(afterId: string | null): Promise<void> {
      if (afterId === null) {
        await redis.del(AUTH_SYNC_DEFAULTS.cursorRedisKey);
      } else {
        await redis.set(AUTH_SYNC_DEFAULTS.cursorRedisKey, afterId, {
          ex: AUTH_SYNC_DEFAULTS.cursorTtlSeconds,
        });
      }
    },
  };
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const effective = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function loop() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: effective }, () => loop()));
}

async function processSingleClaimedJob(
  client: AuthSyncClientLike,
  job: ClaimedAuthSyncJob,
  counters: DrainOutboxResult
): Promise<void> {
  // 1. Checagem PRE-chamada externa (evita tocar no GoTrue se job ja ficou obsoleto ou lease expirou)
  const { data: verifyStatus, error: verifyErr } = await client.rpc('rpc_verify_auth_sync_job', {
    p_job_id: job.job_id,
    p_claim_token: job.claim_token,
  });

  if (verifyErr) {
    counters.abortedInvalidClaim += 1;
    return;
  }

  if (verifyStatus === 'abort_stale') {
    counters.abortedStale += 1;
    return;
  }

  if (verifyStatus !== 'valid') {
    counters.abortedInvalidClaim += 1;
    return;
  }

  // 2. Operacao externa idempotente no GoTrue (ban_user | unban exclusivamente via updateUserById)
  let ok = false;
  let erroCodigo: AuthSyncErrorCode | null = null;

  try {
    const banDuration = job.operacao === 'ban_user' ? AUTH_SYNC_DEFAULTS.banDuration : 'none';
    const { error: authError } = await client.auth.admin.updateUserById(job.target_user_id, {
      ban_duration: banDuration,
    });
    if (authError) {
      erroCodigo = classifyAuthSyncError(authError);
    } else {
      ok = true;
    }
  } catch (err) {
    erroCodigo = classifyAuthSyncError(err);
  }

  // 3. Confirmacao POS-chamada externa (protegida por claim_token + auto-reconciliacao de versao)
  const { data: completeStatus, error: completeErr } = await client.rpc(
    'rpc_complete_auth_sync_job',
    {
      p_job_id: job.job_id,
      p_claim_token: job.claim_token,
      p_sucesso: ok,
      p_erro_codigo: erroCodigo,
    }
  );

  if (completeErr) {
    // Falha entre operacao externa e confirmacao no banco:
    // lease expirara e sweep + reconciliador de drift garantem convergencia eventual
    return;
  }

  switch (completeStatus) {
    case 'succeeded':
      counters.succeeded += 1;
      break;
    case 'pending':
      counters.failedRetriable += 1;
      break;
    case 'failed_permanent':
      counters.failedPermanent += 1;
      break;
    case 'stale_reconcile_enqueued':
      counters.staleReconcileEnqueued += 1;
      break;
    case 'stale_claim_reconcile_enqueued':
      counters.staleClaimEnqueued += 1;
      break;
    default:
      break;
  }
}

export async function drainAuthSyncOutbox(
  options: DrainOutboxOptions
): Promise<DrainOutboxResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const requestTimeoutMs = options.requestTimeoutMs ?? AUTH_SYNC_DEFAULTS.requestTimeoutMs;
  const leaseSeconds = Math.max(
    60,
    Math.min(300, options.leaseSeconds ?? AUTH_SYNC_DEFAULTS.leaseSeconds)
  );
  const claimLimit = Math.max(1, Math.min(10, options.claimLimit ?? AUTH_SYNC_DEFAULTS.claimLimit));
  const concurrency = Math.max(
    1,
    Math.min(claimLimit, options.concurrency ?? AUTH_SYNC_DEFAULTS.concurrency)
  );
  const timeBudgetMs = options.timeBudgetMs ?? AUTH_SYNC_DEFAULTS.scheduledTimeBudgetMs;
  const maxBatches = Math.max(1, options.maxBatches ?? 3);

  // Garante compatibilidade: lease deve exceder timeout individual com margem segura (>= 4x)
  if (leaseSeconds * 1000 < requestTimeoutMs * 2) {
    throw new Error('leaseSeconds incompatível com requestTimeoutMs.');
  }

  const client: AuthSyncClientLike =
    options.client ??
    (createAdminServiceClient({ timeoutMs: requestTimeoutMs }) as unknown as AuthSyncClientLike);

  const result: DrainOutboxResult = {
    claimed: 0,
    succeeded: 0,
    failedRetriable: 0,
    failedPermanent: 0,
    abortedStale: 0,
    abortedInvalidClaim: 0,
    staleReconcileEnqueued: 0,
    staleClaimEnqueued: 0,
    stoppedByBudget: false,
    elapsedMs: 0,
  };

  // Nao reclama jobs se o orcamento disponivel nao comporta um ciclo seguro de timeout + confirmacao
  const minBudgetForBatchMs = requestTimeoutMs + AUTH_SYNC_DEFAULTS.budgetSafetyMarginMs;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const remainingMs = timeBudgetMs - (now() - startedAt);
    if (remainingMs < minBudgetForBatchMs) {
      result.stoppedByBudget = true;
      break;
    }

    const { data, error } = await client.rpc('rpc_claim_auth_sync_jobs', {
      p_worker_id: options.workerId,
      p_limit: claimLimit,
      p_lease_seconds: leaseSeconds,
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      break;
    }

    const jobs = data as ClaimedAuthSyncJob[];
    result.claimed += jobs.length;

    await runWithConcurrency(jobs, concurrency, (job) =>
      processSingleClaimedJob(client, job, result)
    );

    if (jobs.length < claimLimit) {
      break;
    }
  }

  result.elapsedMs = now() - startedAt;
  return result;
}

export async function reconcileAuthDrift(
  options: ReconcileDriftOptions
): Promise<ReconcileDriftResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const requestTimeoutMs = options.requestTimeoutMs ?? AUTH_SYNC_DEFAULTS.requestTimeoutMs;
  const graceSeconds = options.graceSeconds ?? AUTH_SYNC_DEFAULTS.reconcileGraceSeconds;
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? AUTH_SYNC_DEFAULTS.reconcilePageSize));
  const concurrency = Math.max(
    1,
    Math.min(pageSize, options.concurrency ?? AUTH_SYNC_DEFAULTS.reconcileConcurrency)
  );
  const timeBudgetMs = options.timeBudgetMs ?? AUTH_SYNC_DEFAULTS.scheduledTimeBudgetMs;
  const drainAfterReconcile = options.drainAfterReconcile ?? true;

  const client: AuthSyncClientLike =
    options.client ??
    (createAdminServiceClient({ timeoutMs: requestTimeoutMs }) as unknown as AuthSyncClientLike);

  const cursorStore =
    options.cursorStore !== undefined ? options.cursorStore : createUpstashCursorStore();

  let afterId: string | null = null;
  let cursorPersisted = false;

  if (cursorStore) {
    try {
      afterId = await cursorStore.getCursor();
    } catch {
      afterId = null;
    }
  }

  const result: ReconcileDriftResult = {
    usersChecked: 0,
    pagesRead: 0,
    driftEnqueued: 0,
    inSync: 0,
    versionSkipped: 0,
    lookupErrors: 0,
    completedFullPass: false,
    stoppedByBudget: false,
    cursorPersisted: false,
    nextAfterId: afterId,
    drainResult: null,
    elapsedMs: 0,
  };

  const reserveForDrainMs = drainAfterReconcile ? Math.min(6_000, Math.floor(timeBudgetMs * 0.3)) : 2_000;
  let wrappedOnce = false;

  while (true) {
    const remainingMs = timeBudgetMs - (now() - startedAt);
    if (remainingMs <= reserveForDrainMs) {
      result.stoppedByBudget = true;
      break;
    }

    const { data, error } = await client.rpc('rpc_list_users_for_auth_reconcile', {
      p_grace_seconds: graceSeconds,
      p_limit: pageSize,
      p_after_id: afterId,
    });

    if (error || !Array.isArray(data)) {
      result.lookupErrors += 1;
      break;
    }

    const rows = data as ReconcileUserRow[];
    result.pagesRead += 1;

    if (rows.length === 0) {
      if (afterId !== null && !wrappedOnce) {
        // Cursor anterior estava no ultimo usuario da lista: reinicia ciclo completo
        afterId = null;
        wrappedOnce = true;
        result.nextAfterId = null;
        continue;
      }
      result.completedFullPass = true;
      afterId = null;
      result.nextAfterId = null;
      break;
    }

    let lastProcessedId: string | null = afterId;

    for (let i = 0; i < rows.length; i += concurrency) {
      const rem = timeBudgetMs - (now() - startedAt);
      if (rem <= reserveForDrainMs) {
        result.stoppedByBudget = true;
        break;
      }

      const slice = rows.slice(i, i + concurrency);
      await Promise.all(
        slice.map(async (row) => {
          try {
            const { data: userData, error: userErr } = await client.auth.admin.getUserById(
              row.user_id
            );
            if (userErr || !userData?.user) {
              result.lookupErrors += 1;
              return;
            }

            result.usersChecked += 1;
            const currentlyBanned = isAuthUserBanned(userData.user.banned_until, now());

            // Divergencia: ativo=true mas banido no Auth, ou ativo=false mas nao banido no Auth
            if (row.ativo === currentlyBanned) {
              const { data: driftStatus } = await client.rpc('rpc_report_auth_drift_and_enqueue', {
                p_target_user_id: row.user_id,
                p_expected_versao: row.estado_ativacao_versao,
                p_auth_currently_banned: currentlyBanned,
              });
              if (driftStatus === 'drift_enqueued') result.driftEnqueued += 1;
              else if (driftStatus === 'version_changed_skip') result.versionSkipped += 1;
              else if (driftStatus === 'in_sync') result.inSync += 1;
            } else {
              result.inSync += 1;
            }
          } catch {
            result.lookupErrors += 1;
          }
        })
      );

      // Como os IDs sao ordenados por user_id ASC, o ultimo item do slice marca progresso seguro
      lastProcessedId = slice[slice.length - 1].user_id;
    }

    afterId = lastProcessedId;
    result.nextAfterId = afterId;

    if (result.stoppedByBudget) {
      break;
    }

    if (rows.length < pageSize) {
      result.completedFullPass = true;
      afterId = null;
      result.nextAfterId = null;
      break;
    }
  }

  if (cursorStore) {
    try {
      await cursorStore.setCursor(result.completedFullPass ? null : result.nextAfterId);
      cursorPersisted = true;
    } catch {
      cursorPersisted = false;
    }
  }
  result.cursorPersisted = cursorPersisted;

  if (drainAfterReconcile) {
    const remainingForDrain = timeBudgetMs - (now() - startedAt);
    if (remainingForDrain >= requestTimeoutMs + AUTH_SYNC_DEFAULTS.budgetSafetyMarginMs) {
      result.drainResult = await drainAuthSyncOutbox({
        workerId: `${options.workerId}-drain`,
        requestTimeoutMs,
        timeBudgetMs: remainingForDrain,
        maxBatches: 1,
        client,
        now,
      });
    }
  }

  result.elapsedMs = now() - startedAt;
  return result;
}

export async function runAuthSyncCycle(options: {
  workerId: string;
  timeBudgetMs?: number;
  requestTimeoutMs?: number;
  cursorStore?: ReconcileCursorStore | null;
  client?: AuthSyncClientLike;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const timeBudgetMs = options.timeBudgetMs ?? AUTH_SYNC_DEFAULTS.scheduledTimeBudgetMs;
  const requestTimeoutMs = options.requestTimeoutMs ?? AUTH_SYNC_DEFAULTS.requestTimeoutMs;

  // 1. Drena fila pendente primeiro
  const drain = await drainAuthSyncOutbox({
    workerId: `${options.workerId}-outbox`,
    requestTimeoutMs,
    timeBudgetMs,
    maxBatches: 1,
    client: options.client,
    now,
  });

  // 2. Com o orcamento restante, executa reconciliacao paginada
  const remainingMs = timeBudgetMs - (now() - startedAt);
  let reconcile: ReconcileDriftResult | null = null;
  if (remainingMs > 4_000) {
    reconcile = await reconcileAuthDrift({
      workerId: `${options.workerId}-reconcile`,
      requestTimeoutMs,
      timeBudgetMs: remainingMs,
      drainAfterReconcile: true,
      cursorStore: options.cursorStore,
      client: options.client,
      now,
    });
  }

  return {
    drain,
    reconcile,
    totalElapsedMs: now() - startedAt,
  };
}