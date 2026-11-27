import crypto from 'node:crypto';
import { Redis } from '@upstash/redis';
import {
  appendSetCookie,
  hashIdentifier,
  isProductionRuntime,
  isSecureRequest,
  serializeCookie,
  type ServerRequestLike,
  type ServerResponseLike,
} from './http';

export type PasswordSetupFlowType = 'invite' | 'recovery';

export const FLOW_MAX_AGE_SECONDS = 15 * 60;
const FLOW_DOMAIN_LABEL = 'recriar:pwd-flow:v2';
const FLOW_REDIS_PREFIX = 'recriar:pwd-flow:v2:';

const devNonceStore = new Map<string, { binding: string; expiresAtMs: number }>();
let cachedRedisKey = '';
let cachedRedisClient: Redis | null = null;

export function resetDevPasswordFlowStore(): void {
  devNonceStore.clear();
  cachedRedisKey = '';
  cachedRedisClient = null;
}

export function getPasswordFlowCookieName(req: ServerRequestLike): string {
  return isSecureRequest(req) ? '__Host-recriar_pwd_flow' : 'recriar_pwd_flow_dev';
}

function getUpstashRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const cacheKey = `${url}:${hashIdentifier(token)}`;
  if (cachedRedisClient && cachedRedisKey === cacheKey) {
    return cachedRedisClient;
  }

  cachedRedisClient = new Redis({ url, token });
  cachedRedisKey = cacheKey;
  return cachedRedisClient;
}

function canUseDevMemoryStore(): boolean {
  return !isProductionRuntime() && process.env.RATE_LIMIT_ALLOW_DEV_MEMORY === 'true';
}

function deriveSigningKey(): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret || secret.length < 16) {
    throw new Error('SUPABASE_SECRET_KEY ausente para assinatura de fluxo de senha.');
  }
  return crypto.createHmac('sha256', secret).update(FLOW_DOMAIN_LABEL).digest();
}

function signPayload(encodedPayload: string): string {
  return crypto.createHmac('sha256', deriveSigningKey()).update(encodedPayload).digest('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buildRedisKey(flowId: string): string {
  return `${FLOW_REDIS_PREFIX}${hashIdentifier(flowId)}`;
}

function buildBindingDigest(params: {
  userId: string;
  sessionId: string;
  flow: PasswordSetupFlowType;
}): string {
  return hashIdentifier(`${params.userId}|${params.sessionId}|${params.flow}`);
}

export function createPasswordFlowCookieValue(
  userId: string,
  sessionId: string,
  flow: PasswordSetupFlowType,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  flowId: string = crypto.randomUUID()
): { value: string; flowId: string; iat: number } {
  const encoded = Buffer.from(
    JSON.stringify({ uid: userId, sid: sessionId, flow, fid: flowId, iat: nowSeconds }),
    'utf8'
  ).toString('base64url');
  const sig = signPayload(encoded);
  return { value: `${encoded}.${sig}`, flowId, iat: nowSeconds };
}

export async function registerPasswordFlowNonce(params: {
  flowId: string;
  userId: string;
  sessionId: string;
  flow: PasswordSetupFlowType;
  nowSeconds?: number;
}): Promise<{ ok: true } | { ok: false; reason: 'store_unavailable' }> {
  const redisKey = buildRedisKey(params.flowId);
  const binding = buildBindingDigest(params);
  const redis = getUpstashRedis();

  if (redis) {
    try {
      await redis.set(redisKey, binding, { ex: FLOW_MAX_AGE_SECONDS });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'store_unavailable' };
    }
  }

  if (canUseDevMemoryStore()) {
    const nowMs = (params.nowSeconds ?? Math.floor(Date.now() / 1000)) * 1000;
    devNonceStore.set(redisKey, {
      binding,
      expiresAtMs: nowMs + FLOW_MAX_AGE_SECONDS * 1000,
    });
    return { ok: true };
  }

  return { ok: false, reason: 'store_unavailable' };
}

export async function isPasswordFlowNonceActive(params: {
  flowId: string;
  userId: string;
  sessionId: string;
  flow: PasswordSetupFlowType;
  nowSeconds?: number;
}): Promise<{ active: boolean; unavailable: boolean }> {
  const redisKey = buildRedisKey(params.flowId);
  const expectedBinding = buildBindingDigest(params);
  const redis = getUpstashRedis();

  if (redis) {
    try {
      const stored = await redis.get<string>(redisKey);
      if (typeof stored !== 'string') return { active: false, unavailable: false };
      return { active: constantTimeEquals(stored, expectedBinding), unavailable: false };
    } catch {
      return { active: false, unavailable: true };
    }
  }

  if (canUseDevMemoryStore()) {
    const entry = devNonceStore.get(redisKey);
    const nowMs = (params.nowSeconds ?? Math.floor(Date.now() / 1000)) * 1000;
    if (!entry || entry.expiresAtMs <= nowMs) {
      devNonceStore.delete(redisKey);
      return { active: false, unavailable: false };
    }
    return { active: constantTimeEquals(entry.binding, expectedBinding), unavailable: false };
  }

  return { active: false, unavailable: true };
}

/**
 * Consumo atomico de uso unico no servidor (GETDEL no Upstash Redis):
 * - No maximo UMA requisicao concorrente obtem o valor e remove a chave atomicamente.
 * - Politica fail-closed: se Redis estiver indisponivel, retorna store_unavailable (503).
 * - Apos o consumo, o nonce NAO deve ser reabilitado automaticamente se a chamada externa
 *   ao GoTrue falhar ou atingir timeout (resultado remoto incerto).
 */
export async function consumePasswordFlowNonce(params: {
  flowId: string;
  userId: string;
  sessionId: string;
  flow: PasswordSetupFlowType;
  nowSeconds?: number;
}): Promise<
  | { ok: true }
  | { ok: false; reason: 'already_consumed_or_expired' | 'binding_mismatch' | 'store_unavailable' }
> {
  const redisKey = buildRedisKey(params.flowId);
  const expectedBinding = buildBindingDigest(params);
  const redis = getUpstashRedis();

  if (redis) {
    try {
      const stored = await redis.getdel<string>(redisKey);
      if (typeof stored !== 'string' || stored.length === 0) {
        return { ok: false, reason: 'already_consumed_or_expired' };
      }
      if (!constantTimeEquals(stored, expectedBinding)) {
        return { ok: false, reason: 'binding_mismatch' };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'store_unavailable' };
    }
  }

  if (canUseDevMemoryStore()) {
    const entry = devNonceStore.get(redisKey);
    devNonceStore.delete(redisKey);
    const nowMs = (params.nowSeconds ?? Math.floor(Date.now() / 1000)) * 1000;
    if (!entry || entry.expiresAtMs <= nowMs) {
      return { ok: false, reason: 'already_consumed_or_expired' };
    }
    if (!constantTimeEquals(entry.binding, expectedBinding)) {
      return { ok: false, reason: 'binding_mismatch' };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'store_unavailable' };
}

export async function issuePasswordFlowCookie(
  req: ServerRequestLike,
  res: ServerResponseLike,
  params: { userId: string; sessionId: string; flow: PasswordSetupFlowType },
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ ok: true; flowId: string } | { ok: false; reason: 'store_unavailable' }> {
  const created = createPasswordFlowCookieValue(
    params.userId,
    params.sessionId,
    params.flow,
    nowSeconds
  );

  const registered = await registerPasswordFlowNonce({
    flowId: created.flowId,
    userId: params.userId,
    sessionId: params.sessionId,
    flow: params.flow,
    nowSeconds,
  });

  if (!registered.ok) {
    return registered;
  }

  const cookieName = getPasswordFlowCookieName(req);
  const header = serializeCookie(cookieName, created.value, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: FLOW_MAX_AGE_SECONDS,
  });
  appendSetCookie(res, header);
  return { ok: true, flowId: created.flowId };
}

export function clearPasswordFlowCookie(
  req: ServerRequestLike,
  res: ServerResponseLike
): void {
  const cookieName = getPasswordFlowCookieName(req);
  const header = serializeCookie(cookieName, '', {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  appendSetCookie(res, header);
}

export function verifyPasswordFlowCookie(
  req: ServerRequestLike,
  expectedUserId: string,
  expectedSessionId?: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
):
  | { ok: true; flow: PasswordSetupFlowType; iat: number; sid: string; fid: string }
  | {
      ok: false;
      reason:
        | 'missing'
        | 'malformed'
        | 'invalid_signature'
        | 'user_mismatch'
        | 'session_mismatch'
        | 'expired';
    } {
  const cookieName = getPasswordFlowCookieName(req);
  const raw = req.cookies?.[cookieName];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'missing' };
  }

  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed' };
  }

  let expectedSig: string;
  try {
    expectedSig = signPayload(parts[0]);
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (!constantTimeEquals(parts[1], expectedSig)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let payload: {
    uid?: unknown;
    sid?: unknown;
    flow?: unknown;
    fid?: unknown;
    iat?: unknown;
  };
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      uid?: unknown;
      sid?: unknown;
      flow?: unknown;
      fid?: unknown;
      iat?: unknown;
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof payload.uid !== 'string' ||
    typeof payload.sid !== 'string' ||
    payload.sid.trim().length === 0 ||
    typeof payload.fid !== 'string' ||
    payload.fid.trim().length < 8 ||
    (payload.flow !== 'invite' && payload.flow !== 'recovery') ||
    typeof payload.iat !== 'number' ||
    !Number.isFinite(payload.iat)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.uid !== expectedUserId) {
    return { ok: false, reason: 'user_mismatch' };
  }

  if (expectedSessionId !== undefined && payload.sid !== expectedSessionId) {
    return { ok: false, reason: 'session_mismatch' };
  }

  if (nowSeconds - payload.iat > FLOW_MAX_AGE_SECONDS || payload.iat - nowSeconds > 60) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    flow: payload.flow,
    iat: payload.iat,
    sid: payload.sid,
    fid: payload.fid,
  };
}
