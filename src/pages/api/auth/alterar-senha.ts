import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { changePasswordSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
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

  const auth = await requireApiAuth(req, res, { resource: 'auth' });
  if (!auth) return;

  const rl = await enforceRateLimit(res, 'adminSensitive', [auth.userId, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'Dados inválidos para alteração de senha.',
      },
    });
    return;
  }

  // Reautenticacao da senha atual em cliente efemero (sem sobrescrever cookies da sessao)
  const verifier = createEphemeralPublicAuthClient();
  const { error: verifyErr } = await verifier.auth.signInWithPassword({
    email: auth.profile.email,
    password: parsed.data.currentPassword,
  });
  if (verifyErr) {
    res.status(401).json({
      error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Senha atual incorreta.' },
    });
    return;
  }

  const { error: updateErr } = await auth.supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });
  if (updateErr) {
    res.status(400).json({
      error: { code: 'PASSWORD_UPDATE_FAILED', message: 'Não foi possível alterar a senha.' },
    });
    return;
  }

  await auth.supabase.rpc('rpc_log_authenticated_event', {
    p_acao: 'AUTH_PASSWORD_UPDATE_REPORTED',
    p_recurso_entidade: 'auth',
  });

  res.status(200).json({ ok: true });
}