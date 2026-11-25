import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe } from '@/lib/admin/auth';
import { passwordResetRequestSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getCanonicalSiteOrigin,
  getTrustedClientIp,
  requireJsonContentType,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rateLimit';
import { createEphemeralPublicAuthClient } from '@/lib/supabase/userServerClient';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['POST'])) return;
  if (!requireJsonContentType(req, res)) return;

  const csrf = validateCsrfAndOrigin(req, res);
  if (!csrf.ok) {
    await logSystemAuditSafe('ACCESS_DENIED', 'auth', 'negado', csrf.reason);
    return;
  }

  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_INPUT', message: 'Informe um e-mail válido.' },
    });
    return;
  }

  const clientIp = getTrustedClientIp(req);
  const rl = await enforceRateLimit(res, 'passwordReset', [clientIp, parsed.data.email]);
  if (!rl.allowed) {
    if (!rl.unavailable) {
      await logSystemAuditSafe('AUTH_PASSWORD_RESET_REQUEST', 'auth', 'negado', 'rate_limited');
    }
    return;
  }

  const redirectTo = `${getCanonicalSiteOrigin()}/gestao/atualizar-senha`;
  const authClient = createEphemeralPublicAuthClient();
  await authClient.auth.resetPasswordForEmail(parsed.data.email, { redirectTo }).catch(() => {});

  await logSystemAuditSafe('AUTH_PASSWORD_RESET_REQUEST', 'auth', 'sucesso', null);

  // Resposta neutra: nao enumera se o e-mail existe ou esta ativo
  res.status(200).json({
    ok: true,
    message: 'Se o e-mail estiver cadastrado e autorizado, enviaremos instruções de redefinição.',
  });
}