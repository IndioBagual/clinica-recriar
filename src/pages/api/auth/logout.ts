import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe } from '@/lib/admin/auth';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';
import { createUserServerClient } from '@/lib/supabase/userServerClient';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4kb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['POST'])) return;

  const csrf = validateCsrfAndOrigin(req, res);
  if (!csrf.ok) {
    await logSystemAuditSafe('ACCESS_DENIED', 'auth', 'negado', csrf.reason);
    return;
  }

  const supabase = createUserServerClient(req, res);
  const { data: userData } = await supabase.auth.getUser();

  if (userData?.user?.id) {
    try {
      await supabase.rpc('rpc_log_authenticated_event', {
        p_acao: 'AUTH_LOGOUT_REPORTED',
        p_recurso_entidade: 'auth',
      });
    } catch {
      // Logout sempre prossegue mesmo sem perfil administrativo
    }
  }

  await supabase.auth.signOut({ scope: 'global' }).catch(() => {});
  res.status(200).json({ ok: true });
}