import crypto from 'node:crypto';
import {
  appendSetCookie,
  isSecureRequest,
  serializeCookie,
  type ServerRequestLike,
  type ServerResponseLike,
} from './http';

export type PasswordSetupFlowType = 'invite' | 'recovery';

const FLOW_MAX_AGE_SECONDS = 15 * 60;
const FLOW_DOMAIN_LABEL = 'recriar:pwd-flow:v1';

export function getPasswordFlowCookieName(req: ServerRequestLike): string {
  return isSecureRequest(req) ? '__Host-recriar_pwd_flow' : 'recriar_pwd_flow_dev';
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

export function createPasswordFlowCookieValue(
  userId: string,
  flow: PasswordSetupFlowType,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const encoded = Buffer.from(
    JSON.stringify({ uid: userId, flow, iat: nowSeconds }),
    'utf8'
  ).toString('base64url');
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

export function issuePasswordFlowCookie(
  req: ServerRequestLike,
  res: ServerResponseLike,
  params: { userId: string; flow: PasswordSetupFlowType },
  nowSeconds: number = Math.floor(Date.now() / 1000)
): void {
  const value = createPasswordFlowCookieValue(params.userId, params.flow, nowSeconds);
  const cookieName = getPasswordFlowCookieName(req);
  const header = serializeCookie(cookieName, value, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: FLOW_MAX_AGE_SECONDS,
  });
  appendSetCookie(res, header);
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
  nowSeconds: number = Math.floor(Date.now() / 1000)
):
  | { ok: true; flow: PasswordSetupFlowType; iat: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid_signature' | 'user_mismatch' | 'expired' } {
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

  let payload: { uid?: unknown; flow?: unknown; iat?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      uid?: unknown;
      flow?: unknown;
      iat?: unknown;
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof payload.uid !== 'string' ||
    (payload.flow !== 'invite' && payload.flow !== 'recovery') ||
    typeof payload.iat !== 'number' ||
    !Number.isFinite(payload.iat)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.uid !== expectedUserId) {
    return { ok: false, reason: 'user_mismatch' };
  }

  if (nowSeconds - payload.iat > FLOW_MAX_AGE_SECONDS || payload.iat - nowSeconds > 60) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, flow: payload.flow, iat: payload.iat };
}