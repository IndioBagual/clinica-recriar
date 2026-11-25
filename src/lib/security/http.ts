import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none' | boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}

export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.CONTEXT === 'production'
  );
}

export function isSecureRequest(req: NextApiRequest): boolean {
  if (isProductionRuntime()) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return false;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);

  if (typeof options.maxAge === 'number' && Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.expires instanceof Date) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }

  const sameSite = options.sameSite ?? 'lax';
  if (sameSite === true || sameSite === 'strict') {
    parts.push('SameSite=Strict');
  } else if (sameSite === 'none') {
    parts.push('SameSite=None');
  } else if (sameSite === 'lax') {
    parts.push('SameSite=Lax');
  }

  return parts.join('; ');
}

export function appendSetCookie(res: NextApiResponse, cookieHeader: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieHeader]);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing.map(String), cookieHeader]);
    return;
  }
  res.setHeader('Set-Cookie', [String(existing), cookieHeader]);
}

export function applyNoStoreHeaders(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

export function requireMethod(
  req: NextApiRequest,
  res: NextApiResponse,
  allowed: readonly string[]
): boolean {
  if (!req.method || !allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Método HTTP não permitido.' } });
    return false;
  }
  return true;
}

export function requireJsonContentType(req: NextApiRequest, res: NextApiResponse): boolean {
  const raw = req.headers['content-type'];
  if (typeof raw !== 'string') {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type application/json é obrigatório.' } });
    return false;
  }
  const mime = raw.split(';')[0].trim().toLowerCase();
  if (mime !== 'application/json') {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type application/json é obrigatório.' } });
    return false;
  }
  return true;
}

/**
 * Extrai IP sem confiar em X-Forwarded-For arbitrario do cliente.
 * Prioriza cabecalho injetado pela plataforma Netlify (x-nf-client-connection-ip)
 * e cai para req.socket.remoteAddress em ambiente local.
 */
export function getTrustedClientIp(req: NextApiRequest): string {
  const nfIp = req.headers['x-nf-client-connection-ip'];
  if (typeof nfIp === 'string' && nfIp.trim().length > 0 && nfIp.trim().length <= 64) {
    return nfIp.trim();
  }
  const sockIp = req.socket?.remoteAddress;
  if (typeof sockIp === 'string' && sockIp.trim().length > 0) {
    return sockIp.trim();
  }
  return 'unknown';
}

export function hashIdentifier(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/**
 * Protecao contra redirecionamento aberto: aceita apenas rotas internas sob /gestao.
 */
export function sanitizeInternalRedirect(raw: unknown, fallback = '/gestao'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/gestao')) return fallback;
  if (trimmed.startsWith('//') || trimmed.includes('\\') || /[\r\n\0]/.test(trimmed)) {
    return fallback;
  }
  if (trimmed.length > 200) return fallback;
  return trimmed;
}

export function getCanonicalSiteOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.URL,
    !isProductionRuntime() ? 'http://localhost:3000' : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' || (!isProductionRuntime() && parsed.protocol === 'http:')) {
        return parsed.origin;
      }
    } catch {
      continue;
    }
  }
  throw new Error('Origem canônica do site não configurada (NEXT_PUBLIC_SITE_URL).');
}