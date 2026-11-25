import http from 'node:http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AuthSyncClientLike,
  type ClaimedAuthSyncJob,
  drainAuthSyncOutbox,
  type ReconcileCursorStore,
  reconcileAuthDrift,
  runScheduledAuthSync,
} from '@/lib/admin/authSync';
import { createAdminServiceClient } from '@/lib/supabase/adminServiceClient';
import internalSyncHandler from '@/pages/api/internal/auth-sync';

/**
 * Simulador in-memory fiel a maquina de estados SQL da outbox e do GoTrue
 * para testes de integracao simulada (distinto de testes contra servicos externos reais).
 */
class SimulatedAuthAndOutbox {
  users = new Map<
    string,
    { ativo: boolean; versao: number; bannedUntil: string | null }
  >();
  jobs = new Map<
    string,
    {
      id: string;
      target_user_id: string;
      target_versao: number;
      operacao: 'ban_user' | 'unban';
      origem: string;
      status: string;
      claim_token: string | null;
      lease_expires_at: number | null;
      tentativas: number;
      max_tentativas: number;
      ultimo_erro_codigo: string | null;
      concluido_em: number | null;
    }
  >();
  auditEvents: Array<{ acao: string; motivo: string | null }> = [];
  clockMs = 1_700_000_000_000;
  private seq = 1;

  addUser(id: string, ativo: boolean, versao = 1, bannedUntil: string | null = null) {
    this.users.set(id, { ativo, versao, bannedUntil });
  }

  enqueueJob(
    targetUserId: string,
    operacao: 'ban_user' | 'unban',
    origem = 'status_change',
    maxTentativas = 5
  ) {
    const u = this.users.get(targetUserId)!;
    // Superseded nos pendentes antigos
    for (const j of this.jobs.values()) {
      if (j.target_user_id === targetUserId && j.status === 'pending') {
        j.status = 'superseded';
        j.concluido_em = this.clockMs;
      }
    }
    const id = `00000000-0000-4000-8000-${String(this.seq++).padStart(12, '0')}`;
    this.jobs.set(id, {
      id,
      target_user_id: targetUserId,
      target_versao: u.versao,
      operacao,
      origem,
      status: 'pending',
      claim_token: null,
      lease_expires_at: null,
      tentativas: 0,
      max_tentativas: maxTentativas,
      ultimo_erro_codigo: null,
      concluido_em: null,
    });
    return id;
  }

  setUserActive(targetUserId: string, ativo: boolean) {
    const u = this.users.get(targetUserId)!;
    u.ativo = ativo;
    u.versao += 1;
    return this.enqueueJob(targetUserId, ativo ? 'unban' : 'ban_user', 'status_change');
  }

  sweepExpired() {
    for (const j of this.jobs.values()) {
      const u = this.users.get(j.target_user_id)!;
      if (j.status === 'processing' && (j.lease_expires_at ?? 0) <= this.clockMs) {
        if (j.target_versao < u.versao) {
          j.status = 'expired_stale';
          j.claim_token = null;
          j.lease_expires_at = null;
          j.concluido_em = this.clockMs;
        } else if (j.tentativas >= j.max_tentativas) {
          j.status = 'failed_permanent';
          j.ultimo_erro_codigo = 'lease_expirado_max_tentativas';
          j.claim_token = null;
          j.lease_expires_at = null;
          j.concluido_em = this.clockMs;
          this.auditEvents.push({ acao: 'AUTH_SYNC_LEASE_EXHAUSTED', motivo: j.ultimo_erro_codigo });
        }
      }
    }
  }

  createClient(overrides?: {
    updateUserById?: AuthSyncClientLike['auth']['admin']['updateUserById'];
    onBeforeComplete?: () => Promise<void> | void;
  }): AuthSyncClientLike {
    return {
      rpc: async (fn, params = {}) => {
        if (fn === 'rpc_claim_auth_sync_jobs') {
          this.sweepExpired();
          const limit = Number(params.p_limit ?? 10);
          const leaseSec = Number(params.p_lease_seconds ?? 120);
          const claimed: ClaimedAuthSyncJob[] = [];

          for (const j of this.jobs.values()) {
            if (claimed.length >= limit) break;
            const u = this.users.get(j.target_user_id)!;
            if (j.status === 'pending' && j.target_versao < u.versao) {
              j.status = 'superseded';
              j.concluido_em = this.clockMs;
              continue;
            }
            const claimable =
              j.target_versao === u.versao &&
              j.tentativas < j.max_tentativas &&
              (j.status === 'pending' ||
                (j.status === 'processing' && (j.lease_expires_at ?? 0) <= this.clockMs));
            if (claimable) {
              j.status = 'processing';
              j.claim_token = `tok-${this.seq++}`;
              j.lease_expires_at = this.clockMs + leaseSec * 1000;
              j.tentativas += 1;
              claimed.push({
                job_id: j.id,
                claim_token: j.claim_token,
                target_user_id: j.target_user_id,
                target_versao: j.target_versao,
                operacao: j.operacao,
                origem: j.origem,
                tentativas: j.tentativas,
                max_tentativas: j.max_tentativas,
                lease_expires_at: new Date(j.lease_expires_at).toISOString(),
              });
            }
          }
          return { data: claimed, error: null };
        }

        if (fn === 'rpc_verify_auth_sync_job') {
          const j = this.jobs.get(String(params.p_job_id));
          if (
            !j ||
            j.status !== 'processing' ||
            j.claim_token !== params.p_claim_token ||
            (j.lease_expires_at ?? 0) <= this.clockMs
          ) {
            return { data: 'claim_invalid', error: null };
          }
          const u = this.users.get(j.target_user_id)!;
          if (j.target_versao < u.versao) {
            j.status = 'superseded';
            j.claim_token = null;
            j.lease_expires_at = null;
            j.concluido_em = this.clockMs;
            return { data: 'abort_stale', error: null };
          }
          return { data: 'valid', error: null };
        }

        if (fn === 'rpc_complete_auth_sync_job') {
          if (overrides?.onBeforeComplete) await overrides.onBeforeComplete();
          const j = this.jobs.get(String(params.p_job_id));
          if (!j) return { data: null, error: { code: '22023', message: 'not found' } };
          const u = this.users.get(j.target_user_id)!;
          const opVigente: 'ban_user' | 'unban' = u.ativo ? 'unban' : 'ban_user';

          if (j.status !== 'processing' || j.claim_token !== params.p_claim_token) {
            const hasActive = [...this.jobs.values()].some(
              (x) =>
                x.target_user_id === j.target_user_id &&
                x.target_versao === u.versao &&
                (x.status === 'pending' || x.status === 'processing')
            );
            if (!hasActive) this.enqueueJob(j.target_user_id, opVigente, 'stale_claim_recovery');
            this.auditEvents.push({
              acao: 'AUTH_SYNC_STALE_CLAIM_DETECTED',
              motivo: 'claim_expirado_reconciliacao_enfileirada',
            });
            return { data: 'stale_claim_reconcile_enqueued', error: null };
          }

          if (j.target_versao < u.versao) {
            j.status = 'stale_after_external_call';
            j.claim_token = null;
            j.lease_expires_at = null;
            j.concluido_em = this.clockMs;
            const hasActive = [...this.jobs.values()].some(
              (x) =>
                x.target_user_id === j.target_user_id &&
                x.target_versao === u.versao &&
                (x.status === 'pending' || x.status === 'processing')
            );
            if (!hasActive) this.enqueueJob(j.target_user_id, opVigente, 'stale_claim_recovery');
            this.auditEvents.push({ acao: 'AUTH_SYNC_STALE_RECONCILE_ENQUEUED', motivo: null });
            return { data: 'stale_reconcile_enqueued', error: null };
          }

          if (params.p_sucesso) {
            j.status = 'succeeded';
            j.claim_token = null;
            j.lease_expires_at = null;
            j.concluido_em = this.clockMs;
            if (j.origem === 'drift_reconciler') {
              this.auditEvents.push({ acao: 'AUTH_DRIFT_CORRECTION_REPORTED', motivo: null });
            }
            return { data: 'succeeded', error: null };
          }

          if (j.tentativas >= j.max_tentativas) {
            j.status = 'failed_permanent';
            j.ultimo_erro_codigo = String(params.p_erro_codigo ?? 'max_tentativas_excedido');
            j.concluido_em = this.clockMs;
          } else {
            j.status = 'pending';
            j.ultimo_erro_codigo = String(params.p_erro_codigo ?? 'auth_5xx');
          }
          j.claim_token = null;
          j.lease_expires_at = null;
          this.auditEvents.push({ acao: 'AUTH_SYNC_FAILURE_REPORTED', motivo: j.ultimo_erro_codigo });
          return { data: j.status, error: null };
        }

        if (fn === 'rpc_list_users_for_auth_reconcile') {
          this.sweepExpired();
          const graceMs = Number(params.p_grace_seconds ?? 60) * 1000;
          const limit = Number(params.p_limit ?? 100);
          const afterId = params.p_after_id ? String(params.p_after_id) : null;

          const ids = [...this.users.keys()].sort();
          const rows = [];
          for (const id of ids) {
            if (afterId && id <= afterId) continue;
            const u = this.users.get(id)!;
            const blocked = [...this.jobs.values()].some(
              (j) =>
                j.target_user_id === id &&
                j.target_versao === u.versao &&
                (['pending', 'processing', 'failed_permanent'].includes(j.status) ||
                  (j.status === 'succeeded' &&
                    j.concluido_em !== null &&
                    j.concluido_em > this.clockMs - graceMs))
            );
            if (!blocked) {
              rows.push({ user_id: id, ativo: u.ativo, estado_ativacao_versao: u.versao });
              if (rows.length >= limit) break;
            }
          }
          return { data: rows, error: null };
        }

        if (fn === 'rpc_report_auth_drift_and_enqueue') {
          const id = String(params.p_target_user_id);
          const expected = Number(params.p_expected_versao);
          const banned = Boolean(params.p_auth_currently_banned);
          const u = this.users.get(id);
          if (!u) return { data: 'not_found', error: null };
          if (u.versao !== expected) return { data: 'version_changed_skip', error: null };
          const div = (u.ativo && banned) || (!u.ativo && !banned);
          if (!div) return { data: 'in_sync', error: null };
          const hasActive = [...this.jobs.values()].some(
            (j) =>
              j.target_user_id === id &&
              j.target_versao === u.versao &&
              (j.status === 'pending' || j.status === 'processing')
          );
          if (hasActive) return { data: 'already_enqueued', error: null };
          this.enqueueJob(id, u.ativo ? 'unban' : 'ban_user', 'drift_reconciler');
          this.auditEvents.push({ acao: 'AUTH_DRIFT_REPORTED', motivo: 'estado_auth_divergente' });
          return { data: 'drift_enqueued', error: null };
        }

        return { data: null, error: { message: `RPC desconhecida: ${fn}` } };
      },
      auth: {
        admin: {
          updateUserById: async (uid, attrs) => {
            if (overrides?.updateUserById) {
              return overrides.updateUserById(uid, attrs);
            }
            const u = this.users.get(uid);
            if (!u) return { data: null, error: { status: 404, message: 'not found' } };
            u.bannedUntil = attrs.ban_duration === 'none' ? null : new Date(this.clockMs + 3.6e12).toISOString();
            return { data: { user: { id: uid, banned_until: u.bannedUntil } }, error: null };
          },
          getUserById: async (uid) => {
            const u = this.users.get(uid);
            if (!u) return { data: null, error: { status: 404, message: 'not found' } };
            return { data: { user: { id: uid, banned_until: u.bannedUntil } }, error: null };
          },
        },
      },
    };
  }
}

function createMockApiReqRes(overrides: {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const headers: Record<string, string | string[]> = {};
  let status = 200;
  let body: unknown = null;
  const req = {
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
  const res = {
    setHeader(k: string, v: string | string[]) {
      headers[k.toLowerCase()] = v;
      return res;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    status(c: number) {
      status = c;
      return res;
    },
    json(p: unknown) {
      body = p;
      return res;
    },
  } as unknown as NextApiResponse;
  return { req, res, getStatus: () => status, getBody: () => body };
}

describe('Etapa 6 â€” Worker Outbox, Timeout HTTP Real, Reconciliacao e Netlify (17 cenarios)', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('[1 & 7] processa job com sucesso e suporta reprocessamento idempotente', async () => {
    const sim = new SimulatedAuthAndOutbox();
    const uid = '11111111-1111-4111-8111-111111111111';
    this.addUser(uid, false, 2, null);
    const jobId = this.enqueueJob(uid, 'ban_user');
    const client = this.createClient();

    const r1 = await drainAuthSyncOutbox({ workerId: 'w-ok', client, now: () => this.clockMs });
    expect(r1.succeeded).toBe(1);
    expect(this.jobs.get(jobId)?.status).toBe('succeeded');
    expect(this.users.get(uid)?.bannedUntil).not.toBeNull();

    // Reprocessamento idempotente do mesmo estado (manual_retry)
    this.enqueueJob(uid, 'ban_user', 'manual_retry');
    const r2 = await drainAuthSyncOutbox({ workerId: 'w-ok-2', client, now: () => this.clockMs });
    expect(r2.succeeded).toBe(1);
    expect(this.users.get(uid)?.bannedUntil).not.toBeNull();
  });

  it('[2, 3 & 14] trata falha HTTP temporaria (5xx), erro 4xx e esgotamento de tentativas (failed_permanent)', async () => {
    const sim = new SimulatedAuthAndOutbox();
    const uid = '11111111-1111-4111-8111-111111111112';
    this.addUser(uid, false, 2, null);
    const jobId = this.enqueueJob(uid, 'ban_user', 'status_change', 2);

    const client503 = this.createClient({
      updateUserById: async () => ({ data: null, error: { status: 503, message: 'unavailable' } }),
    });
    const r1 = await drainAuthSyncOutbox({ workerId: 'w-err', client: client503, now: () => this.clockMs, maxBatches: 1 });
    expect(r1.failedRetriable).toBe(1);
    expect(this.jobs.get(jobId)?.status).toBe('pending');
    expect(this.jobs.get(jobId)?.ultimo_erro_codigo).toBe('auth_5xx');

    // 2a tentativa falha com 400 e atinge max_tentativas=2 -> failed_permanent (sem loop infinito)
    const client400 = this.createClient({
      updateUserById: async () => ({ data: null, error: { status: 400, message: 'bad request' } }),
    });
    const r2 = await drainAuthSyncOutbox({ workerId: 'w-err', client: client400, now: () => this.clockMs, maxBatches: 1 });
    expect(r2.failedPermanent).toBe(1);
    expect(this.jobs.get(jobId)?.status).toBe('failed_permanent');
    expect(this.jobs.get(jobId)?.ultimo_erro_codigo).toBe('auth_4xx');

    // Nao e mais reivindicado automaticamente
    const r3 = await drainAuthSyncOutbox({ workerId: 'w-err', client: client400, now: () => this.clockMs });
    expect(r3.claimed).toBe(0);
  });

  it('[4] comprova timeout HTTP real no transporte usado pelo SDK @supabase/supabase-js', async () => {
    // Servidor HTTP local real que atrasa a resposta por 400ms
    const server = http.createServer((_req, res) => {
      const t = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }));
      }, 400);
      res.on('close', () => clearTimeout(t));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const sdkClient = createAdminServiceClient({
        supabaseUrl: `http://127.0.0.1:${port}`,
        secretKey: 'sb_secret_test_only_local_socket',
        timeoutMs: 80,
      });

      const sim = new SimulatedAuthAndOutbox();
      const uid = '11111111-1111-4111-8111-111111111113';
      this.addUser(uid, false, 2, null);
      const jobId = this.enqueueJob(uid, 'ban_user');

      // Usa o transporte real do SDK para updateUserById contra o servidor local lento
      const hybridClient = this.createClient({
        updateUserById: (id, attrs) => sdkClient.auth.admin.updateUserById(id, attrs),
      });

      const t0 = Date.now();
      const out = await drainAuthSyncOutbox({
        workerId: 'w-timeout',
        client: hybridClient,
        requestTimeoutMs: 80,
        leaseSeconds: 60,
        timeBudgetMs: 5_000,
        maxBatches: 1,
      });
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(350); // Abortou bem antes dos 400ms do servidor
      expect(out.failedRetriable).toBe(1);
      expect(this.jobs.get(jobId)?.ultimo_erro_codigo).toBe('auth_timeout');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('[5 & 6] trata lease expirado e claim_token obsoleto antes e depois da chamada externa', async () => {
    const sim = new SimulatedAuthAndOutbox();
    const uid = '11111111-1111-4111-8111-111111111114';
    this.addUser(uid, false, 2, null);
    const jobId = this.enqueueJob(uid, 'ban_user');
    const client = this.createClient();

    // Worker A reivindica
    const { data: claimed } = await client.rpc('rpc_claim_auth_sync_jobs', {
      p_worker_id: 'worker-A',
      p_limit: 5,
      p_lease_seconds: 60,
    });
    const jobA = (claimed as ClaimedAuthSyncJob[])[0];

    // Lease de A expira -> Worker B reivindica recebendo novo claim_token
    this.clockMs += 61_000;
    const { data: verifyA } = await client.rpc('rpc_verify_auth_sync_job', {
      p_job_id: jobA.job_id,
      p_claim_token: jobA.claim_token,
    });
    expect(verifyA).toBe('claim_invalid');

    const rB = await drainAuthSyncOutbox({ workerId: 'worker-B', client, now: () => this.clockMs });
    expect(rB.succeeded).toBe(1);

    // A tenta concluir tarde demais com claim_token antigo -> detectado e reconciliacao enfileirada
    const { data: lateComplete } = await client.rpc('rpc_complete_auth_sync_job', {
      p_job_id: jobId,
      p_claim_token: jobA.claim_token,
      p_sucesso: true,
      p_erro_codigo: null,
    });
    expect(lateComplete).toBe('stale_claim_reconcile_enqueued');
    expect(this.auditEvents.some((e) => e.acao === 'AUTH_SYNC_STALE_CLAIM_DETECTED')).toBe(true);
  });

  it('[8 & 9] alternancia rapida: desativacao->reativacao e reativacao->desativacao abortam job obsoleto', async () => {
    const sim = new SimulatedAuthAndOutbox();
    const uid = '11111111-1111-4111-8111-111111111115';
    this.addUser(uid, true, 1, null);

    // Desativa (v2) e imediatamente reativa (v3)
    const j2 = this.setUserActive(uid, false);
    const j3 = this.setUserActive(uid, true);
    expect(this.jobs.get(j2)?.status).toBe('superseded');

    const client = this.createClient();
    const r1 = await drainAuthSyncOutbox({ workerId: 'w-flip', client, now: () => this.clockMs });
    expect(r1.succeeded).toBe(1);
    expect(this.jobs.get(j3)?.status).toBe('succeeded');
    expect(this.users.get(uid)?.bannedUntil).toBeNull();

    // Reativa -> Desativa (v4)
    const j4 = this.setUserActive(uid, false);
    const r2 = await drainAuthSyncOutbox({ workerId: 'w-flip', client, now: () => this.clockMs });
    expect(r2.succeeded).toBe(1);
    expect(this.jobs.get(j4)?.status).toBe('succeeded');
    expect(this.users.get(uid)?.bannedUntil).not.toBeNull();
  });

  it('[10, 11 & 12] resposta externa antiga apos operacao nova + morte do worker antes de complete + convergencia via reconciliador', async () => {
    const sim = new SimulatedAuthAndOutbox();
    const uid = '11111111-1111-4111-8111-111111111116';
    this.addUser(uid, true, 1, null);

    // 1. Admin desativa (v2) e Worker A reivindica job v2
    const jobV2Id = this.setUserActive(uid, false);
    const client = this.createClient();
    const { data: claimedA } = await client.rpc('rpc_claim_auth_sync_jobs', {
      p_worker_id: 'worker-A',
      p_limit: 5,
      p_lease_seconds: 120,
    });
    expect((claimedA as ClaimedAuthSyncJob[])[0].job_id).toBe(jobV2Id);

    // 2. Admin reativa (v3) e Worker B executa unban v3 e conclui succeeded
    this.setUserActive(uid, true);
    const rB = await drainAuthSyncOutbox({ workerId: 'worker-B', client, now: () => this.clockMs });
    expect(rB.succeeded).toBe(1);
    expect(this.users.get(uid)?.bannedUntil).toBeNull();

    // 3. Worker A atrasado altera o GoTrue (ban) DEPOIS de B e MORRE sem chamar rpc_complete_auth_sync_job!
    await client.auth.admin.updateUserById(uid, { ban_duration: '876000h' });
    expect(this.users.get(uid)?.bannedUntil).not.toBeNull(); // Divergente! (banco ativo=true, GoTrue banned)

    // 4. Passa tempo (lease de A expira + janela de graca de 60s de B expira)
    this.clockMs += 130_000;

    // 5. Reconciliador faz sweep de A (expired_stale), nao exclui o usuario, detecta drift e drena correcao
    const rec = await reconcileAuthDrift({
      workerId: 'reconciler-1',
      client,
      cursorStore: null,
      now: () => this.clockMs,
    });

    expect(this.jobs.get(jobV2Id)?.status).toBe('expired_stale');
    expect(rec.driftEnqueued).toBe(1);
    expect(rec.drainResult?.succeeded).toBe(1);
    expect(this.users.get(uid)?.bannedUntil).toBeNull(); // Estado final convergido para ativo/unban!
    expect(this.auditEvents.some((e) => e.acao === 'AUTH_DRIFT_REPORTED')).toBe(true);
    expect(this.auditEvents.some((e) => e.acao === 'AUTH_DRIFT_CORRECTION_REPORTED')).toBe(true);
  });

  it('[13 & 16] paginacao com interrupcao por orcamento temporal e retomada sem excluir usuarios', async () => {
    const sim = new SimulatedAuthAndOutbox();
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
    ];
    // Usuario 5 (ultima pagina) tem divergencia
    for (const id of ids) this.addUser(id, true, 1, null);
    this.users.get(ids[4])!.bannedUntil = new Date(this.clockMs + 3.6e12).toISOString();

    let savedCursor: string | null = null;
    const cursorStore: ReconcileCursorStore = {
      async getCursor() {
        return savedCursor;
      },
      async setCursor(v) {
        savedCursor = v;
      },
    };

    // Cada getUserById consome 1.500ms no relogio simulado; budget=5.000ms interrompe apos 1a pagina (2 usuarios)
    const baseClient = this.createClient();
    const timedClient: AuthSyncClientLike = {
      rpc: baseClient.rpc.bind(baseClient),
      auth: {
        admin: {
          updateUserById: baseClient.auth.admin.updateUserById.bind(baseClient.auth.admin),
          getUserById: async (uid) => {
            this.clockMs += 1_500;
            return baseClient.auth.admin.getUserById(uid);
          },
        },
      },
    };

    const run1 = await reconcileAuthDrift({
      workerId: 'rec-part1',
      pageSize: 2,
      concurrency: 1,
      timeBudgetMs: 5_000,
      drainAfterReconcile: false,
      cursorStore,
      client: timedClient,
      now: () => this.clockMs,
    });
    expect(run1.stoppedByBudget).toBe(true);
    expect(run1.completedFullPass).toBe(false);
    expect(run1.cursorPersisted).toBe(true);
    expect(savedCursor).toBe(ids[1]);

    // Execucao 2 retoma exatamente do cursor salvo e encontra o drift no usuario 5
    const run2 = await reconcileAuthDrift({
      workerId: 'rec-part2',
      pageSize: 2,
      concurrency: 1,
      timeBudgetMs: 30_000,
      drainAfterReconcile: false,
      cursorStore,
      client: timedClient,
      now: () => this.clockMs,
    });
    expect(run2.completedFullPass).toBe(true);
    expect(run2.driftEnqueued).toBe(1);
    expect(savedCursor).toBeNull(); // Cursor resetado ao concluir ciclo inteiro

    // Orcamento insuficiente no worker impede claim inseguro
    const noClaim = await drainAuthSyncOutbox({
      workerId: 'w-tight',
      requestTimeoutMs: 15_000,
      timeBudgetMs: 10_000,
      client: baseClient,
      now: () => this.clockMs,
    });
    expect(noClaim.claimed).toBe(0);
    expect(noClaim.stoppedByBudget).toBe(true);
  });

  it('[17] bloqueia acionamento externo nao autorizado em /api/internal/auth-sync e respeita kill-switch Netlify', async () => {
    // Kill-switch da Netlify Scheduled Function (inativa por padrao)
    delete process.env.AUTH_SYNC_SCHEDULE_ENABLED;
    const schedDisabled = await runScheduledAuthSync({ env: process.env });
    expect(schedDisabled.executed).toBe(false);
    expect(schedDisabled.status).toBe(204);

    // Endpoint interno: metodo invalido (GET -> 405)
    const mGet = createMockApiReqRes({ method: 'GET' });
    await internalSyncHandler(mGet.req, mGet.res);
    expect(mGet.getStatus()).toBe(405);

    // Credencial em query string -> 400
    const mQuery = createMockApiReqRes({ query: { secret: 'x'.repeat(40) } });
    await internalSyncHandler(mQuery.req, mQuery.res);
    expect(mQuery.getStatus()).toBe(400);

    // Sem AUTH_SYNC_INTERNAL_SECRET configurado -> fail-closed 503
    delete process.env.AUTH_SYNC_INTERNAL_SECRET;
    const mUnconf = createMockApiReqRes({ headers: { authorization: `Bearer ${'x'.repeat(40)}` } });
    await internalSyncHandler(mUnconf.req, mUnconf.res);
    expect(mUnconf.getStatus()).toBe(503);

    // Segredo divergente -> 401
    process.env.AUTH_SYNC_INTERNAL_SECRET = 's'.repeat(40);
    const mWrong = createMockApiReqRes({ headers: { authorization: `Bearer ${'z'.repeat(40)}` } });
    await internalSyncHandler(mWrong.req, mWrong.res);
    expect(mWrong.getStatus()).toBe(401);

    // Segredo valido mas rota sincrona com teto padrao de 10s -> 409 (nao viola teto)
    delete process.env.NETLIFY_SYNC_FUNCTION_TIMEOUT_SECONDS;
    const mShort = createMockApiReqRes({ headers: { authorization: `Bearer ${'s'.repeat(40)}` } });
    await internalSyncHandler(mShort.req, mShort.res);
    expect(mShort.getStatus()).toBe(409);
  });
});