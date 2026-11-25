import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { updateUserNameSchema, uuidParamSchema } from '@/lib/admin/schemas';
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
  if (!requireMethod(req, res, ['PATCH'])) return;
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

  const bodyParsed = updateUserNameSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: bodyParsed.error.issues[0]?.message ?? 'Nome inválido.',
      },
    });
    return;
  }

  // UPDATE somente na coluna (nome) com a identidade do operador (RLS + GRANT UPDATE (nome) + trigger)
  const { data, error } = await auth.supabase
    .from('usuarios_perfil')
    .update({ nome: bodyParsed.data.nome })
    .eq('id', idParsed.data)
    .select('id, nome, atualizado_em')
    .maybeSingle();

  if (error) {
    res.status(403).json({
      error: { code: 'UPDATE_DENIED', message: 'Não foi possível atualizar o perfil solicitado.' },
    });
    return;
  }

  if (!data) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND_OR_FORBIDDEN', message: 'Usuário não encontrado ou sem permissão de edição.' },
    });
    return;
  }

  res.status(200).json({ ok: true, usuario: data });
}