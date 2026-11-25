import type { NextApiRequest, NextApiResponse } from 'next';
import { type AdminProfileRow, logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { uuidParamSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getCanonicalSiteOrigin,
  getTrustedClientIp,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rateLimit';
import { createAdminServiceClient } from '@/lib/supabase/adminServiceClient';
import { createEphemeralPublicAuthClient } from '@/lib/supabase/userServerClient';

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

  const rl = await enforceRateLimit(res, 'inviteLink', [auth.userId, idParsed.data, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  // 1. Consulta perfil alvo via identidade autenticada do operador
  const { data: target, error: targetErr } = await auth.supabase
    .from('usuarios_perfil')
    .select('id, email, ativo, primeiro_acesso_observado_em')
    .eq('id', idParsed.data)
    .maybeSingle<Pick<AdminProfileRow, 'id' | 'email' | 'ativo' | 'primeiro_acesso_observado_em'>>();

  if (targetErr || !target) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' } });
    return;
  }

  if (!target.ativo) {
    res.status(409).json({
      error: { code: 'USER_INACTIVE', message: 'Conta desativada não pode receber link de acesso.' },
    });
    return;
  }

  if (target.primeiro_acesso_observado_em !== null) {
    res.status(409).json({
      error: {
        code: 'FIRST_ACCESS_ALREADY_OBSERVED',
        message: 'Esta conta já realizou primeiro acesso. Utilize o fluxo de recuperação de senha.',
      },
    });
    return;
  }

  // 2. Verifica estado real do usuario no Supabase Auth (nao confia apenas em campo local)
  const admin = createAdminServiceClient();
  const { data: authData, error: authErr } = await admin.auth.admin.getUserById(target.id);
  const authUser = authData?.user;

  if (authErr || !authUser || typeof authUser.email !== 'string') {
    res.status(409).json({
      error: { code: 'AUTH_USER_INVALID', message: 'Usuário ausente ou sem e-mail válido no serviço de autenticação.' },
    });
    return;
  }

  if (authUser.email.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
    res.status(409).json({
      error: { code: 'AUTH_EMAIL_MISMATCH', message: 'Divergência de e-mail entre perfil e autenticação.' },
    });
    return;
  }

  const redirectTo = `${getCanonicalSiteOrigin()}/gestao/atualizar-senha`;
  let fluxo: 'convite' | 'definicao_senha';

  // 3. Ramificacao obrigatoria: conta nao confirmada -> convite; ja confirmada -> definicao_senha
  if (!authUser.email_confirmed_at) {
    fluxo = 'convite';
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(target.email, { redirectTo });
    if (invErr) {
      res.status(502).json({
        error: { code: 'INVITE_SEND_FAILED', message: 'Falha ao solicitar reenvio do convite.' },
      });
      return;
    }
  } else {
    fluxo = 'definicao_senha';
    const pubClient = createEphemeralPublicAuthClient();
    const { error: recErr } = await pubClient.auth.resetPasswordForEmail(target.email, { redirectTo });
    if (recErr) {
      res.status(502).json({
        error: { code: 'PASSWORD_LINK_FAILED', message: 'Falha ao solicitar link de definição de senha.' },
      });
      return;
    }
  }

  // 4. Registra solicitacao sob a identidade do operador autenticado
  const { error: markErr } = await auth.supabase.rpc('rpc_admin_mark_access_link_requested', {
    p_target_user_id: target.id,
    p_fluxo: fluxo,
  });

  if (markErr) {
    res.status(500).json({
      error: { code: 'MARK_LINK_FAILED', message: 'Link solicitado, mas houve falha ao registrar o histórico.' },
    });
    return;
  }

  res.status(200).json({ ok: true, fluxo });
}