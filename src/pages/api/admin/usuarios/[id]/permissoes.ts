import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { permissionMutationSchema, uuidParamSchema } from '@/lib/admin/schemas';
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
  if (!requireMethod(req, res, ['POST', 'DELETE'])) return;
  if (!requireJsonContentType(req, res)) return;

  const csrf = validateCsrfAndOrigin(req, res);
  if (!csrf.ok) {
    await logSystemAuditSafe('ACCESS_DENIED', 'usuario_permissoes', 'negado', csrf.reason);
    return;
  }

  // Na Fase 2, usuarios.manage e auditoria.read sao nao delegaveis (apenas Admin Principal)
  const auth = await requireApiAuth(req, res, {
    requireAdminPrincipal: true,
    resource: 'usuario_permissoes',
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
      error: { code: 'SELF_PERMISSION_MUTATION_FORBIDDEN', message: 'Não é permitido alterar as próprias permissões.' },
    });
    return;
  }

  const bodyParsed = permissionMutationSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: { code: 'INVALID_PERMISSION', message: 'Permissão fora do catálogo da Fase 2.' } });
    return;
  }

  const { permissao } = bodyParsed.data;

  if (req.method === 'POST') {
    const { error } = await auth.supabase
      .from('usuario_permissoes')
      .insert({ usuario_id: idParsed.data, permissao });

    if (error) {
      if (error.code === '23505') {
        res.status(200).json({ ok: true, alreadyGranted: true, permissao });
        return;
      }
      if (error.code === '42501') {
        res.status(403).json({
          error: { code: 'PERMISSION_GRANT_DENIED', message: 'Operação bloqueada pela política de segurança.' },
        });
        return;
      }
      res.status(400).json({
        error: { code: 'PERMISSION_GRANT_FAILED', message: 'Não foi possível conceder a permissão.' },
      });
      return;
    }

    res.status(201).json({ ok: true, permissao });
    return;
  }

  // DELETE
  const { error } = await auth.supabase
    .from('usuario_permissoes')
    .delete()
    .eq('usuario_id', idParsed.data)
    .eq('permissao', permissao);

  if (error) {
    res.status(403).json({
      error: { code: 'PERMISSION_REVOKE_DENIED', message: 'Não foi possível revogar a permissão.' },
    });
    return;
  }

  res.status(200).json({ ok: true, revoked: permissao });
}