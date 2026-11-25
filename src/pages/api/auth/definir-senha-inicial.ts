import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { initialPasswordSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getTrustedClientIp,
  requireJsonContentType,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rateLimit';

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

  const parsed = initialPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PASSWORD',
        message: parsed.error.issues[0]?.message ?? 'Senha não atende aos requisitos mínimos.',
      },
    });
    return;
  }

  // Alteracao efetiva de senha realizada no Supabase Auth
  const { error: updateError } = await auth.supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateError) {
    res.status(400).json({
      error: { code: 'PASSWORD_UPDATE_FAILED', message: 'Não foi possível definir a senha.' },
    });
    return;
  }

  // Registro reportado pela aplicacao (nao usado como prova independente de seguranca)
  const { data: reportState } = await auth.supabase.rpc('rpc_report_initial_setup_completed');
  res.status(200).json({
    ok: true,
    initialSetupReportState: reportState ?? 'reported',
  });
}