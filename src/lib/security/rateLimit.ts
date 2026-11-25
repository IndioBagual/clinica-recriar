import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { NextApiResponse } from 'next';
import { hashIdentifier, isProductionRuntime } from './http';

export type RateLimitBucket = 'login' | 'passwordReset' | 'adminSensitive' | 'inviteLink';

interface BucketConfig {
  limit: number;
  windowMs: number;
  upstashWindow: `${number} s` | `${number} m`;
  prefix: string;
}

const BUCKETS: Record<RateLimitBucket, BucketConfig> = {
  login: { limit: 5, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:login' },
  passwordReset: { limit: 3, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:reset' },
  adminSensitive: { limit: 30, windowMs: 60_000, upstashWindow: '1 m', prefix: 'recriar:rl:admin' },
  inviteLink: { limit: 10, windowMs: 15 * 60_000, upstashWindow: '15 m', prefix: 'recriar:rl:invite' },
};

export interface RateLimitResult {
  allowed: boolean;
  unavailable: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const devMemoryStore = new Map<string, number[]>();
const upstashLimiters = new Map<RateLimitBucket, Ratelimit>();

export function resetDevRateLimitStore(): void {
  devMemoryStore.clear();
}

function getUpstashLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const existing = upstashLimiters.get(bucket);
  if (existing) return existing;

  const cfg = BUCKETS[bucket];
  const redis = new Redis({ url, token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.upstashWindow),
    prefix: cfg.prefix,
    analytics: false,
  });
  upstashLimiters.set(bucket, limiter);
  return limiter;
}

function checkDevMemoryLimiter(bucket: RateLimitBucket, hashedKey: string): RateLimitResult {
  const cfg = BUCKETS[bucket];
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
 * - Se UPSTASH_REDIS_REST_URL/TOKEN estiverem configurados, usa Upstash; falha do Redis retorna unavailable=true (503).
 * - Sem Upstash: NUNCA faz bypass silencioso. Em producao retorna unavailable=true (503).
 *   Fora de producao, somente usa limitador em memoria se RATE_LIMIT_ALLOW_DEV_MEMORY=true estiver explicito.
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  rawParts: readonly string[]
): Promise<RateLimitResult> {
  const hashedKey = hashIdentifier(rawParts.join('|'));
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

export async function enforceRateLimit(
  res: NextApiResponse,
  bucket: RateLimitBucket,
  rawParts: readonly string[]
): Promise<RateLimitResult> {
  const result = await checkRateLimit(bucket, rawParts);

  if (result.unavailable) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(503).json({
      error: {
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'Serviço de proteção temporariamente indisponível. Tente novamente em instantes.',
      },
    });
    return result;
  }

  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Muitas tentativas em sequência. Aguarde antes de tentar novamente.',
      },
    });
    return result;
  }

  return result;
}