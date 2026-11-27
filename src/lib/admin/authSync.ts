import crypto from 'node:crypto';
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

export interface ReconcileCursorState {
  epoch: number;
  afterId: string | null;
}

export interface ReconcileCursorSetOptions {
  expectedEpoch?: number;
  expectedCursor?: string | null;
  wrapped?: boolean;
  completedFullPass?: boolean;
}

export interface ReconcileCursorStore {
  getCursor(): Promise<string | null>;
  getCursorState?(): Promise<ReconcileCursorState>;
  setCursor(afterId: string | null, options?: ReconcileCursorSetOptions): Promise<boolean | void>;
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
        attributes: { ban_duration?: string; password?: string }
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
    const rec = err as {
      name?: string;
      code?: string;
      status?: number;
      message?: string;
      cause?: unknown;
      originalError?: unknown;
    };

    // 1. Verifica timeout/abort ANTES de status (AuthRetryableFetchError usa status=0)
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
    if (rec.originalError && classifyAuthSyncError(rec.originalError) === 'auth_timeout') {
      return 'auth_timeout';
    }
    if (
      typeof rec.message === 'string' &&
      /HTTP_TIMEOUT|timeout|timed out|tempo limite|aborted/i.test(rec.message)
    ) {
      return 'auth_timeout';
    }

    // 2. Classificacao por status HTTP real (> 0)
    if (typeof rec.status === 'number' && rec.status > 0) {
      if (rec.status === 408 || rec.status === 504) return 'auth_timeout';
      if (rec.status >= 400 && rec.status < 500 && rec.status !== 429) return 'auth_4xx';
      return 'auth_5xx';
    }
  }

  return 'auth_5xx';
}

/**
 * Gera senha criptograficamente aleatoria (descartada imediatamente) para acionar
 * a revogacao global nativa de sessoes/refresh tokens do GoTrue via updateUserById.
 */
export function generateRevocationPassword(): string {
  return `Rev!9aA#${crypto.randomBytes(24).toString('base64url')}`;
}

export function parseCursorState(raw: string | null | undefined): ReconcileCursorState {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { epoch: 0, afterId: null };
  }
  const sep = raw.indexOf('|');
  if (sep > 0) {
    const parsedEpoch = Number(raw.slice(0, sep));
    if (Number.isInteger(parsedEpoch) && parsedEpoch >= 0) {
      const suffix = raw.slice(sep + 1);
      return { epoch: parsedEpoch, afterId: suffix.length > 0 ? suffix : null };
    }
  }
  // Compatibilidade defensiva com valor legado sem prefixo de epoch
  return { epoch: 0, afterId: raw };
}

/**
 * Atualizacao atomica do cursor com epoch monotonico ("<epoch>|<afterId>"):
 * - 'complete': avanca epoch -> expectedEpoch + 1 e limpa afterId apenas se curEpoch == expectedEpoch.
 *   Mantem o epoch persistido para bloquear workers atrasados da volta anterior.
 * - 'progress': avanca afterId monotonico apenas dentro do mesmo epoch (curEpoch == expectedEpoch).
 * - 'wrapped': transiciona expectedEpoch -> expectedEpoch + 1 (ou avanca dentro de expectedEpoch + 1).
 * - Chave ausente/expirada: somente aceita expectedEpoch == 0 (impede ressurreicao por worker antigo).
 */
const LUA_EPOCH_CURSOR_UPDATE = `
local raw = redis.call('GET', KEYS[1])
local nextAfter = ARGV[1]
local ttl = tonumber(ARGV[2])
local expectedEpoch = tonumber(ARGV[3])
local mode = ARGV[4]

local curEpoch = nil
local curAfter = ''

if not raw then
  if expectedEpoch ~= 0 then
    return 0
  end
  curEpoch = 0
  curAfter = ''
else
  local sep = string.find(raw, '|', 1, true)
  if sep then
    curEpoch = tonumber(string.sub(raw, 1, sep - 1))
    curAfter = string.sub(raw, sep + 1)
  else
    curEpoch = 0
    curAfter = raw
  end
  if curEpoch == nil then
    if expectedEpoch ~= 0 then
      return 0
    end
    curEpoch = 0
    curAfter = ''
  end
end

if mode == 'complete' then
  if curEpoch == expectedEpoch then
    redis.call('SET', KEYS[1], tostring(expectedEpoch + 1) .. '|', 'EX', ttl)
    return 1
  end
  return 0
end

if mode == 'progress' then
  if curEpoch == expectedEpoch and nextAfter ~= '' and (curAfter == '' or nextAfter > curAfter) then
    redis.call('SET', KEYS[1], tostring(expectedEpoch) .. '|' .. nextAfter, 'EX', ttl)
    return 1
  end
  return 0
end

if mode == 'wrapped' then
  local nextEpoch = expectedEpoch + 1
  if nextAfter ~= '' and (curEpoch == expectedEpoch or (curEpoch == nextEpoch and (curAfter == '' or nextAfter > curAfter))) then
    redis.call('SET', KEYS[1], tostring(nextEpoch) .. '|' .. nextAfter, 'EX', ttl)
    return 1
  end
  return 0
end

return 0
`;

export function createUpstashCursorStore(): ReconcileCursorStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  return {
    async getCursorState(): Promise<ReconcileCursorState> {
      const value = await redis.get<string>(AUTH_SYNC_DEFAULTS.cursorRedisKey);
      return parseCursorState(value);
    },
    async getCursor(): Promise<string | null> {
      const value = await redis.get<string>(AUTH_SYNC_DEFAULTS.cursorRedisKey);
      return parseCursorState(value).afterId;
    },
    async setCursor(
      afterId: string | null,
      options?: ReconcileCursorSetOptions
    ): Promise<boolean> {
      if (afterId === null && options === undefined) {
        await redis.del(AUTH_SYNC_DEFAULTS.cursorRedisKey);
        return true;
      }

      const expectedEpoch = Math.max(0, Math.floor(options?.expectedEpoch ?? 0));
      const mode =
        options?.completedFullPass || afterId === null
          ? 'complete'
          : options?.wrapped
            ? 'wrapped'
            : 'progress';
      const nextAfter = mode === 'complete' ? '' : (afterId ?? '');

      const written = await redis.eval(
        LUA_EPOCH_CURSOR_UPDATE,
        [AUTH_SYNC_DEFAULTS.cursorRedisKey],
        [nextAfter, String(AUTH_SYNC_DEFAULTS.cursorTtlSeconds), String(expectedEpoch), mode]
      );
      return Number(written) === 1;
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

  let ok = false;
  let erroCodigo: AuthSyncErrorCode | null = null;

  try {
    if (job.operacao === 'ban_user') {
      // Banimento + rotacao de senha aleatoria: aciona revogacao global nativa de
      // sessoes e refresh tokens no GoTrue (sem armazenar JWTs ou alterar auth.*).
      const { error: authError } = await client.auth.admin.updateUserById(job.target_user_id, {
        ban_duration: AUTH_SYNC_DEFAULTS.banDuration,
        password: generateRevocationPassword(),
      });
      if (authError) {
        erroCodigo = classifyAuthSyncError(authError);
      } else {
        ok = true;
      }
    } else {
      // Reativacao (unban): revoga globalmente quaisquer sessoes/refresh tokens residuais
      // ANTES de remover o banimento. Em caso de falha na etapa 1, o unban NAO e aplicado.
      const { error: revokeError } = await client.auth.admin.updateUserById(job.target_user_id, {
        password: generateRevocationPassword(),
      });
      if (revokeError) {
        erroCodigo = classifyAuthSyncError(revokeError);
      } else {
        // Revalida claim e versao vigente entre etapa 1 (password) e etapa 2 (unban)
        const { data: verifyBeforeUnban, error: verifyBeforeUnbanErr } = await client.rpc(
          'rpc_verify_auth_sync_job',
          {
            p_job_id: job.job_id,
            p_claim_token: job.claim_token,
          }
        );
        if (verifyBeforeUnbanErr) {
          counters.abortedInvalidClaim += 1;
          return;
        }
        if (verifyBeforeUnban === 'abort_stale') {
          counters.abortedStale += 1;
          return;
        }
        if (verifyBeforeUnban !== 'valid') {
          counters.abortedInvalidClaim += 1;
          return;
        }

        const { error: unbanError } = await client.auth.admin.updateUserById(job.target_user_id, {
          ban_duration: 'none',
        });
        if (unbanError) {
          erroCodigo = classifyAuthSyncError(unbanError);
        } else {
          ok = true;
        }
      }
    }
  } catch (err) {
    erroCodigo = classifyAuthSyncError(err);
  }

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
  let initialAfterId: string | null = null;
  let initialEpoch = 0;
  let cursorPersisted = false;

  if (cursorStore) {
    try {
      if (cursorStore.getCursorState) {
        const state = await cursorStore.getCursorState();
        afterId = state.afterId;
        initialAfterId = state.afterId;
        initialEpoch = state.epoch;
      } else {
        afterId = await cursorStore.getCursor();
        initialAfterId = afterId;
        initialEpoch = 0;
      }
    } catch {
      afterId = null;
      initialAfterId = null;
      initialEpoch = 0;
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
      const updated = await cursorStore.setCursor(
        result.completedFullPass ? null : result.nextAfterId,
        {
          expectedEpoch: initialEpoch,
          expectedCursor: initialAfterId,
          wrapped: wrappedOnce,
          completedFullPass: result.completedFullPass,
        }
      );
      cursorPersisted = updated !== false;
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

  const drain = await drainAuthSyncOutbox({
    workerId: `${options.workerId}-outbox`,
    requestTimeoutMs,
    timeBudgetMs,
    maxBatches: 1,
    client: options.client,
    now,
  });

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