import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { NextApiResponse } from 'next';
import { hashIdentifier, isProductionRuntime } from './http';

export type RateLimitBucket =
  | 'login'
  | 'loginIp'
  | 'loginEmail'
  | 'passwordReset'
  | 'passwordResetIp'
  | 'adminSensitive'
  | 'inviteLink';

interface BucketConfig {
  limit: number;
  windowMs: number;
  upstashWindow: `${number} s` | `${number} m`;
  prefix: string;
}

export const RATE_LIMIT_BUCKETS: Record<RateLimitBucket, BucketConfig> = {
  login: { limit: 5, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:login' },
  loginIp: { limit: 20, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:login:ip' },
  loginEmail: { limit: 10, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:login:email' },
  passwordReset: { limit: 3, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:reset' },
  passwordResetIp: { limit: 10, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:reset:ip' },
  adminSensitive: { limit: 30, windowMs: 60_000, upstashWindow: '1 m', prefix: 'recriar:rl:admin' },
  inviteLink: { limit: 10, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:invite' },
};

export interface RateLimitCheckSpec {
  bucket: RateLimitBucket;
  rawParts: readonly string[];
}

export interface RateLimitResult {
  allowed: boolean;
  unavailable: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const devMemoryStore = new Map<string, number[]>();
const upstashLimiters = new Map<string, Ratelimit>();

export function resetDevRateLimitStore(): void {
  devMemoryStore.clear();
  upstashLimiters.clear();
}

export function normalizeRateLimitPart(part: string): string {
  return part.trim().toLowerCase();
}

function getUpstashLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const cacheKey = `${bucket}:${url}:${hashIdentifier(token)}`;
  const existing = upstashLimiters.get(cacheKey);
  if (existing) return existing;

  const cfg = RATE_LIMIT_BUCKETS[bucket];
  const redis = new Redis({ url, token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.upstashWindow),
    prefix: cfg.prefix,
    analytics: false,
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

function checkDevMemoryLimiter(bucket: RateLimitBucket, hashedKey: string): RateLimitResult {
  const cfg = RATE_LIMIT_BUCKETS[bucket];
  const storeKey = `${cfg.prefix}:${hashedKey}`;
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const timestamps = (devMemoryStore.get(storeKey) ?? []).filter((ts) => ts > cutoff);

  if (timestamps.length >= cfg.limit) {
    const oldest = timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + cfg.windowMs - now) / 1000));
    devMemoryStore.set(storeKey, timestamps);
    return { allowed: false, unavailable: false, remaining: 0, retryAfterSeconds };
  }

  timestamps.push(now);
  devMemoryStore.set(storeKey, timestamps);
  return {
    allowed: true,
    unavailable: false,
    remaining: Math.max(0, cfg.limit - timestamps.length),
    retryAfterSeconds: 0,
  };
}

/**
 * Politica fail-closed:
 * - Se UPSTASH_REDIS_REST_URL/TOKEN estiverem configurados, usa Upstash; falha retorna unavailable=true (503).
 * - Sem Upstash: NUNCA faz bypass silencioso. Em producao retorna unavailable=true (503).
 *   Fora de producao, somente usa limitador em memoria se RATE_LIMIT_ALLOW_DEV_MEMORY=true estiver explicito.
 * - Identificadores sao normalizados (trim + lowercase) e passam por SHA-256 (zero e-mails/IPs em texto aberto).
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  rawParts: readonly string[]
): Promise<RateLimitResult> {
  const normalized = rawParts.map(normalizeRateLimitPart).join('|');
  const hashedKey = hashIdentifier(normalized);
  const upstash = getUpstashLimiter(bucket);

  if (upstash) {
    try {
      const result = await upstash.limit(hashedKey);
      const retryAfterSeconds = result.success
        ? 0
        : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return {
        allowed: result.success,
        unavailable: false,
        remaining: result.remaining,
        retryAfterSeconds,
      };
    } catch {
      return { allowed: false, unavailable: true, remaining: 0, retryAfterSeconds: 60 };
    }
  }

  if (!isProductionRuntime() && process.env.RATE_LIMIT_ALLOW_DEV_MEMORY === 'true') {
    return checkDevMemoryLimiter(bucket, hashedKey);
  }

  return { allowed: false, unavailable: true, remaining: 0, retryAfterSeconds: 60 };
}

export async function checkRateLimits(
  checks: readonly RateLimitCheckSpec[]
): Promise<RateLimitResult> {
  if (checks.length === 0) {
    return { allowed: true, unavailable: false, remaining: 0, retryAfterSeconds: 0 };
  }

  const results = await Promise.all(
    checks.map((spec) => checkRateLimit(spec.bucket, spec.rawParts))
  );

  const unavailableResults = results.filter((r) => r.unavailable);
  if (unavailableResults.length > 0) {
    return {
      allowed: false,
      unavailable: true,
      remaining: 0,
      retryAfterSeconds: Math.max(...unavailableResults.map((r) => r.retryAfterSeconds)),
    };
  }

  const blockedResults = results.filter((r) => !r.allowed);
  if (blockedResults.length > 0) {
    return {
      allowed: false,
      unavailable: false,
      remaining: 0,
      retryAfterSeconds: Math.max(...blockedResults.map((r) => r.retryAfterSeconds)),
    };
  }

  return {
    allowed: true,
    unavailable: false,
    remaining: Math.min(...results.map((r) => r.remaining)),
    retryAfterSeconds: 0,
  };
}

function sendRateLimitResponse(res: NextApiResponse, result: RateLimitResult): void {
  if (result.unavailable) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(503).json({
      error: {
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'Servi?o de prote??o temporariamente indispon?vel. Tente novamente em instantes.',
      },
    });
    return;
  }

  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Muitas tentativas em sequ?ncia. Aguarde antes de tentar novamente.',
      },
    });
  }
}

export async function enforceRateLimit(
  res: NextApiResponse,
  bucket: RateLimitBucket,
  rawParts: readonly string[]
): Promise<RateLimitResult> {
  const result = await checkRateLimit(bucket, rawParts);
  sendRateLimitResponse(res, result);
  return result;
}

export async function enforceRateLimits(
  res: NextApiResponse,
  checks: readonly RateLimitCheckSpec[]
): Promise<RateLimitResult> {
  const result = await checkRateLimits(checks);
  sendRateLimitResponse(res, result);
  return result;
}
