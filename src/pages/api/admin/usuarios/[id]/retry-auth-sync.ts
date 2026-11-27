import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { uuidParamSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getTrustedClientIp,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rateLimit';

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
    await logSystemAuditSafe('ACCESS_DENIED', 'usuarios_perfil', 'negado', csrf.reason);
    return;
  }

  const auth = await requireApiAuth(req, res, {
    permission: 'usuarios.manage',
    resource: 'usuarios_perfil',
  });
  if (!auth) return;

  const idParsed = uuidParamSchema.safeParse(req.query.id);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'ID de usuário inválido.' } });
    return;
  }

  const rl = await enforceRateLimit(res, 'adminSensitive', [auth.userId, idParsed.data, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  // Reenfileira sincronizacao manual via RPC autorizada sob identidade autenticada
  const { data: jobId, error } = await auth.supabase.rpc('rpc_admin_retry_auth_sync', {
    p_target_user_id: idParsed.data,
  });

  if (error) {
    if (error.code === 'CR021') {
      res.status(409).json({
        error: {
          code: 'SYNC_ALREADY_ACTIVE',
          message: 'Já existe sincronização pendente ou em andamento para a versão atual deste usuário.',
        },
      });
      return;
    }
    if (error.code === '42501') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Permissão insuficiente.' } });
      return;
    }
    if (error.code === '22023') {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' } });
      return;
    }
    res.status(500).json({
      error: { code: 'RETRY_ENQUEUE_FAILED', message: 'Falha ao solicitar nova sincronização.' },
    });
    return;
  }

  res.status(202).json({
    ok: true,
    outboxJobId: jobId ?? null,
  });
}