import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { setUserStatusSchema, uuidParamSchema } from '@/lib/admin/schemas';
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
    await logSystemAuditSafe('ACCESS_DENIED', 'usuarios_perfil', 'negado', csrf.reason);
    return;
  }

  const auth = await requireApiAuth(req, res, {
    permission: 'usuarios.manage',
    resource: 'usuarios_perfil',
  });
  if (!auth) return;

  const rl = await enforceRateLimit(res, 'adminSensitive', [auth.userId, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  const idParsed = uuidParamSchema.safeParse(req.query.id);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'ID de usuário inválido.' } });
    return;
  }

  if (idParsed.data === auth.userId) {
    res.status(403).json({
      error: { code: 'SELF_STATUS_CHANGE_FORBIDDEN', message: 'Não é permitido alterar a própria ativação.' },
    });
    return;
  }

  const bodyParsed = setUserStatusSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Campo ativo (booleano) é obrigatório.' } });
    return;
  }

  // Executa sob identidade autenticada; banco aplica advisory lock, trava do ultimo Admin Principal e outbox
  const { data, error } = await auth.supabase.rpc('rpc_admin_set_user_active', {
    p_target_user_id: idParsed.data,
    p_ativo: bodyParsed.data.ativo,
  });

  if (error) {
    if (error.code === 'CR001') {
      res.status(409).json({
        error: {
          code: 'LAST_ADMIN_PRINCIPAL_PROTECTED',
          message: 'Não é permitido desativar o último Administrador Principal ativo.',
        },
      });
      return;
    }
    if (error.code === '42501') {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Operação não autorizada para este alvo.' },
      });
      return;
    }
    if (error.code === '22023') {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'Usuário alvo não encontrado.' },
      });
      return;
    }
    res.status(500).json({
      error: { code: 'STATUS_UPDATE_FAILED', message: 'Falha ao atualizar status da conta.' },
    });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({
    ok: true,
    resultado: row?.resultado ?? 'updated',
    outboxJobId: row?.outbox_job_id ?? null,
    novaVersao: row?.nova_versao ?? null,
  });
}