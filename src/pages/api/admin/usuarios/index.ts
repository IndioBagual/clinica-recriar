import type { NextApiRequest, NextApiResponse } from 'next';
import { canRequestAccessLink, deriveAccountLifecycleStatus } from '@/lib/admin/accountLifecycle';
import { type AdminProfileRow, logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { createUserSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getCanonicalSiteOrigin,
  getTrustedClientIp,
  requireJsonContentType,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rateLimit';
import { createAdminServiceClient } from '@/lib/supabase/adminServiceClient';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};

async function findActiveAuthUserByEmail(
  admin: ReturnType<typeof createAdminServiceClient>,
  normalizedEmail: string
): Promise<{ id: string; emailConfirmedAt: string | null } | null> {
  const maxPages = 20;
  const perPage = 200;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;

    const match = data.users.find(
      (u) =>
        typeof u.email === 'string' &&
        u.email.trim().toLowerCase() === normalizedEmail
    );
    if (match) {
      return { id: match.id, emailConfirmedAt: match.email_confirmed_at ?? null };
    }
    if (data.users.length < perPage) return null;
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    const auth = await requireApiAuth(req, res, {
      permission: 'usuarios.manage',
      resource: 'usuarios_perfil',
    });
    if (!auth) return;

    const { data: profiles, error: profilesErr } = await auth.supabase
      .from('usuarios_perfil')
      .select(
        'id, nome, email, is_admin_principal, ativo, estado_ativacao_versao, convite_solicitado_em, email_confirmado_em, configuracao_inicial_reportada_em, primeiro_acesso_observado_em, ultimo_acesso_auth_em, desativado_em, criado_em'
      )
      .order('criado_em', { ascending: false });

    if (profilesErr) {
      res.status(500).json({ error: { code: 'LIST_USERS_FAILED', message: 'Erro ao listar usuários.' } });
      return;
    }

    const { data: perms, error: permsErr } = await auth.supabase
      .from('usuario_permissoes')
      .select('usuario_id, permissao');

    if (permsErr) {
      res.status(500).json({ error: { code: 'LIST_PERMS_FAILED', message: 'Erro ao listar permissões.' } });
      return;
    }

    const permMap = new Map<string, string[]>();
    for (const row of perms ?? []) {
      const list = permMap.get(row.usuario_id) ?? [];
      list.push(row.permissao);
      permMap.set(row.usuario_id, list);
    }

    const usuarios = ((profiles ?? []) as AdminProfileRow[]).map((p) => ({
      ...p,
      permissoes: permMap.get(p.id) ?? [],
      lifecycleStatus: deriveAccountLifecycleStatus(p),
      podeReenviarAcesso: canRequestAccessLink(p),
    }));

    res.status(200).json({ usuarios });
    return;
  }

  // POST — Criacao/convite de usuario administrativo com recuperacao idempotente de falha parcial
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

  const rl = await enforceRateLimit(res, 'inviteLink', [auth.userId, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'Dados de usuário inválidos.',
      },
    });
    return;
  }

  const { nome, email } = parsed.data;

  // 1. Verifica se perfil ja existe (usando sessao autenticada do operador sob RLS)
  const { data: existingProfile, error: existingErr } = await auth.supabase
    .from('usuarios_perfil')
    .select('id, ativo')
    .eq('email', email)
    .maybeSingle();

  if (existingErr) {
    res.status(500).json({ error: { code: 'CHECK_EXISTING_FAILED', message: 'Falha ao verificar e-mail.' } });
    return;
  }

  if (existingProfile) {
    res.status(409).json({
      error: {
        code: 'PROFILE_ALREADY_EXISTS',
        message: existingProfile.ativo
          ? 'Já existe uma conta administrativa ativa para este e-mail.'
          : 'Já existe uma conta administrativa desativada para este e-mail. Utilize a reativação.',
      },
    });
    return;
  }

  // 2. Interage com Supabase Auth Admin API somente APOS autorizacao validada no servidor
  const admin = createAdminServiceClient();
  const redirectTo = `${getCanonicalSiteOrigin()}/gestao/atualizar-senha`;

  let targetUserId: string | null = null;
  let conviteSolicitado = false;
  let recoveredExistingAuthUser = false;

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (!inviteError && inviteData?.user?.id) {
    targetUserId = inviteData.user.id;
    conviteSolicitado = true;
  } else {
    // Recuperacao idempotente: timeout anterior ou usuario ja existente no Auth sem perfil local
    const existingAuth = await findActiveAuthUserByEmail(admin, email);
    if (existingAuth) {
      targetUserId = existingAuth.id;
      conviteSolicitado = false;
      recoveredExistingAuthUser = true;
    } else {
      res.status(502).json({
        error: {
          code: 'AUTH_INVITE_FAILED',
          message: 'Não foi possível criar ou localizar a conta no serviço de autenticação.',
        },
      });
      return;
    }
  }

  // 3. Cria perfil usando a identidade do operador autenticado (auth.uid() + RPC autorizada)
  const { error: rpcError } = await auth.supabase.rpc('rpc_admin_create_invited_profile', {
    p_user_id: targetUserId,
    p_nome: nome,
    p_email: email,
    p_convite_solicitado: conviteSolicitado,
  });

  if (rpcError) {
    if (rpcError.code === '23505') {
      res.status(409).json({
        error: { code: 'PROFILE_ALREADY_EXISTS', message: 'Perfil administrativo já criado.' },
      });
      return;
    }

    // Nao executa exclusao automatica insegura no Auth; reenvio do mesmo POST completa de forma idempotente
    res.status(502).json({
      error: {
        code: 'PARTIAL_CREATION_RECOVERY_REQUIRED',
        message:
          'A conta foi criada no serviço de autenticação, mas o perfil não pôde ser concluído. Reenvie a solicitação para concluir o vínculo de forma segura.',
      },
    });
    return;
  }

  res.status(201).json({
    ok: true,
    userId: targetUserId,
    conviteSolicitado,
    recoveredExistingAuthUser,
  });
}