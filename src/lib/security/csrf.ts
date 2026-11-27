import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  appendSetCookie,
  isProductionRuntime,
  isSecureRequest,
  serializeCookie,
} from './http';

export const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_BYTES = 32;

export function getCsrfCookieName(req: NextApiRequest): string {
  return isSecureRequest(req) ? '__Host-recriar_csrf' : 'recriar_csrf_dev';
}

export function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const isPreviewContext =
    process.env.CONTEXT === 'deploy-preview' || process.env.CONTEXT === 'branch-deploy';
  const envUrls =
    isPreviewContext && process.env.DEPLOY_PRIME_URL
      ? [process.env.DEPLOY_PRIME_URL]
      : [
          process.env.NEXT_PUBLIC_SITE_URL,
          process.env.DEPLOY_PRIME_URL,
          process.env.URL,
        ];

  for (const raw of envUrls) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // ignora valor malformado
    }
  }

  if (!isProductionRuntime()) {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return origins;
}

export function validateOriginHeader(req: NextApiRequest): { ok: boolean; reason?: 'origem_invalida' } {
  const originHeader = req.headers.origin;
  if (typeof originHeader !== 'string' || originHeader.trim() === '') {
    return { ok: false, reason: 'origem_invalida' };
  }

  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(originHeader).origin;
  } catch {
    return { ok: false, reason: 'origem_invalida' };
  }

  const allowed = getAllowedOrigins();
  if (!allowed.has(parsedOrigin)) {
    return { ok: false, reason: 'origem_invalida' };
  }

  return { ok: true };
}

export function issueCsrfCookie(req: NextApiRequest, res: NextApiResponse): string {
  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');
  const cookieName = getCsrfCookieName(req);
  const secure = isSecureRequest(req);

  const header = serializeCookie(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  appendSetCookie(res, header);
  return token;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function validateCsrfAndOrigin(
  req: NextApiRequest,
  res: NextApiResponse
): { ok: true } | { ok: false; reason: 'origem_invalida' | 'csrf_invalido' } {
  const originCheck = validateOriginHeader(req);
  if (!originCheck.ok) {
    res.status(403).json({
      error: { code: 'FORBIDDEN_ORIGIN', message: 'Origem da requisição não autorizada.' },
    });
    return { ok: false, reason: 'origem_invalida' };
  }

  const cookieName = getCsrfCookieName(req);
  const cookieToken = req.cookies?.[cookieName];
  const headerRaw = req.headers[CSRF_HEADER_NAME];
  const headerToken = typeof headerRaw === 'string' ? headerRaw.trim() : '';

  if (
    typeof cookieToken !== 'string' ||
    cookieToken.length < 32 ||
    headerToken.length < 32 ||
    !constantTimeEquals(cookieToken, headerToken)
  ) {
    res.status(403).json({
      error: { code: 'INVALID_CSRF_TOKEN', message: 'Token CSRF ausente ou inválido.' },
    });
    return { ok: false, reason: 'csrf_invalido' };
  }

  return { ok: true };
}