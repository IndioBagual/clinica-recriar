import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe } from '@/lib/admin/auth';
import { loginSchema } from '@/lib/admin/schemas';
import { issueCsrfCookie, validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getTrustedClientIp,
  requireJsonContentType,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimits } from '@/lib/security/rateLimit';
import { createUserServerClient } from '@/lib/supabase/userServerClient';

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

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_INPUT', message: 'Credenciais em formato inv?lido.' },
    });
    return;
  }

  const clientIp = getTrustedClientIp(req);
  const rl = await enforceRateLimits(res, [
    { bucket: 'login', rawParts: [clientIp, parsed.data.email] },
    { bucket: 'loginIp', rawParts: [clientIp] },
    { bucket: 'loginEmail', rawParts: [parsed.data.email] },
  ]);
  if (!rl.allowed) {
    if (!rl.unavailable) {
      await logSystemAuditSafe('AUTH_LOGIN_FAILED', 'auth', 'negado', 'rate_limited');
    }
    return;
  }

  const supabase = createUserServerClient(req, res);
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (signInError) {
    await logSystemAuditSafe('AUTH_LOGIN_FAILED', 'auth', 'negado', 'credenciais_invalidas');
    res.status(401).json({
      error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inv?lidos.' },
    });
    return;
  }

  const { data: loginState, error: rpcError } = await supabase.rpc('rpc_record_my_login');
  if (rpcError || loginState === 'no_profile' || loginState === 'inactive' || loginState === 'no_auth_user') {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    if (loginState === 'no_profile') {
      await logSystemAuditSafe('ACCESS_DENIED', 'auth', 'negado', 'sem_perfil');
    }
    res.status(403).json({
      error: { code: 'ACCESS_DENIED', message: 'Conta n?o autorizada ou desativada.' },
    });
    return;
  }

  // Rotaciona token CSRF apos autenticacao bem-sucedida
  const csrfToken = issueCsrfCookie(req, res);
  res.status(200).json({ ok: true, loginState, csrfToken });
}
